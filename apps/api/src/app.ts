import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  exportPayloadSchema,
  healthSchema,
  searchRequestSchema,
  type SyncProgressPhase,
  type SyncSummary,
  updateGitHubSettingsSchema,
  updateLmStudioSettingsSchema,
} from '@github-stars-ai-search/shared';
import { loadConfig } from './config.js';
import { createDatabase } from './lib/db.js';
import { EncryptionService } from './lib/crypto.js';
import { GitHubClient } from './lib/github.js';
import { registerLocalWebApp } from './lib/localWebApp.js';
import { LMStudioClient } from './lib/lmStudio.js';
import { CatalogService } from './services/catalogService.js';
import { SearchService } from './services/searchService.js';
import { SettingsService } from './services/settingsService.js';
import { SyncService } from './services/syncService.js';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  return 'Unknown error.';
}

async function streamSyncEvents(
  request: FastifyRequest,
  reply: FastifyReply,
  run: (callbacks: {
    signal: AbortSignal;
    onProgress: (current: number, total: number, repository: string, phase: SyncProgressPhase) => void;
  }) => Promise<SyncSummary>,
) {
  const heartbeatIntervalMs = 10_000;
  const abortController = new AbortController();
  const abortOnDisconnect = () => {
    if (!reply.raw.writableEnded) {
      abortController.abort();
    }
  };

  request.raw.on('aborted', abortOnDisconnect);
  reply.raw.on('close', abortOnDisconnect);
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const heartbeatId = setInterval(() => {
    if (!reply.raw.writableEnded) {
      reply.raw.write(': keep-alive\n\n');
    }
  }, heartbeatIntervalMs);

  const send = (event: string, data: unknown) => {
    if (!reply.raw.writableEnded) {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  try {
    const summary = await run({
      signal: abortController.signal,
      onProgress: (current, total, repository, phase) => {
        send('progress', { type: 'progress', current, total, repository, phase });
      },
    });

    if (abortController.signal.aborted) {
      send('cancelled', { type: 'cancelled', summary });
    } else {
      send('complete', { type: 'complete', summary });
    }
  } catch (error) {
    if (!abortController.signal.aborted) {
      send('error', { type: 'error', message: getErrorMessage(error) });
    }
  } finally {
    clearInterval(heartbeatId);
    request.raw.off('aborted', abortOnDisconnect);
    reply.raw.off('close', abortOnDisconnect);
    if (!reply.raw.writableEnded) {
      reply.raw.end();
    }
  }
}

export async function buildApp(masterKey: Buffer) {
  const config = loadConfig();
  const app = Fastify({
    logger: true,
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || config.allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin not allowed.'), false);
    },
  });

  app.addHook('onRequest', async (request, reply) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      return;
    }
    const origin = request.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) {
      reply.code(403).send({ message: 'Cross-site requests are not allowed for mutating endpoints.' });
    }
  });

  const db = createDatabase(config);
  const encryptionService = new EncryptionService(masterKey);
  const settingsService = new SettingsService(db, encryptionService);
  const catalogService = new CatalogService(db);
  const syncService = new SyncService(settingsService, catalogService);
  const searchService = new SearchService(catalogService);

  app.get('/api/health', async () => healthSchema.parse({
    status: 'ok',
    version: '0.1.0',
    databasePath: config.databasePath,
  }));

  app.get('/api/settings', async () => settingsService.getPublicSettings());

  app.post('/api/settings/github/test', async (request) => {
    const body = updateGitHubSettingsSchema.parse(request.body);
    const client = new GitHubClient(body.token);
    await client.validateToken();
    return { ok: true };
  });

  app.put('/api/settings/github', async (request) => {
    const body = updateGitHubSettingsSchema.parse(request.body);
    const client = new GitHubClient(body.token);
    await client.validateToken();
    settingsService.saveGitHubToken(body.token);
    return settingsService.getPublicSettings();
  });

  app.post('/api/settings/lm-studio/test', async (request) => {
    const body = updateLmStudioSettingsSchema.parse(request.body);
    const client = new LMStudioClient(body);
    return client.testBoth();
  });

  app.get('/api/lm-studio/models', async (request) => {
    const query = request.query as { baseUrl?: string; apiKey?: string };
    if (!query.baseUrl) {
      throw new Error('baseUrl query parameter is required.');
    }
    return LMStudioClient.listModels(query.baseUrl, query.apiKey);
  });

  app.get('/api/system/hardware', async () => {
    let gpu: { name: string; vramMb: number } | null = null;

    // 1. Try NVIDIA GPU via nvidia-smi
    try {
      const output = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', {
        timeout: 5000,
        encoding: 'utf-8',
      }).trim();
      const [name, vramStr] = output.split(',').map((s) => s.trim());
      if (name && vramStr) {
        gpu = { name, vramMb: Number.parseInt(vramStr, 10) };
      }
    } catch {
      // nvidia-smi not available or no GPU
    }

    // 2. Try AMD GPU via rocm-smi
    if (!gpu) {
      try {
        const rocmOutput = execSync('rocm-smi --showproductname --showmeminfo vram --json', {
          timeout: 5000,
          encoding: 'utf-8',
        }).trim();
        const rocmData = JSON.parse(rocmOutput);
        // rocm-smi JSON keys vary: try common shapes
        for (const key of Object.keys(rocmData)) {
          const card = rocmData[key];
          if (card && typeof card === 'object') {
            const name =
              card['Card Series'] ??
              card['Card series'] ??
              card['Product Name'] ??
              card['card_series'] ??
              'AMD GPU';
            const vramTotal =
              card['VRAM Total Memory (B)'] ??
              card['vram_total'] ??
              card['VRAM Total'] ??
              null;
            if (vramTotal !== null) {
              gpu = { name: String(name), vramMb: Math.round(Number(vramTotal) / (1024 * 1024)) };
              break;
            }
          }
        }
      } catch {
        // rocm-smi not available
      }
    }

    // 3. Try AMD GPU via sysfs (AMDGPU kernel driver without ROCm)
    if (!gpu) {
      try {
        const drmDir = '/sys/class/drm';
        const entries = fs.readdirSync(drmDir);
        for (const entry of entries) {
          if (!/^card\d+$/.test(entry)) continue;
          const vramPath = path.join(drmDir, entry, 'device', 'mem_info_vram_total');
          if (!fs.existsSync(vramPath)) continue;
          const vramBytes = Number(fs.readFileSync(vramPath, 'utf-8').trim());
          let name = 'AMD GPU';
          try {
            const prodPath = path.join(drmDir, entry, 'device', 'product_name');
            name = fs.readFileSync(prodPath, 'utf-8').trim() || name;
          } catch {
            // product_name not available
          }
          if (vramBytes > 0) {
            gpu = { name, vramMb: Math.round(vramBytes / (1024 * 1024)) };
            break;
          }
        }
      } catch {
        // sysfs not available
      }
    }

    return {
      gpu,
      ramMb: Math.round(os.totalmem() / (1024 * 1024)),
      cpuCores: os.cpus().length,
    };
  });

  app.put('/api/settings/lm-studio', async (request) => {
    const body = updateLmStudioSettingsSchema.parse(request.body);
    const client = new LMStudioClient(body);
    await client.testConnection();
    settingsService.saveLmStudioConfig(body);
    return settingsService.getPublicSettings();
  });

  app.post('/api/sync/full', async (request, reply) => {
    await streamSyncEvents(request, reply, ({ signal, onProgress }) =>
      syncService.syncFullCatalog({ signal, onProgress }),
    );
  });

  app.post('/api/sync/rebuild-all', async (request, reply) => {
    await streamSyncEvents(request, reply, ({ signal, onProgress }) =>
      syncService.syncFullCatalog({ signal, onProgress }, { forceReindex: true }),
    );
  });

  app.post('/api/sync/analyze-remaining', async (request, reply) => {
    await streamSyncEvents(request, reply, ({ signal, onProgress }) => {
      const repositoryIds = catalogService.getUnanalyzedRepositoryIds();
      return syncService.analyzeRepositories(repositoryIds, { signal, onProgress });
    });
  });

  app.post('/api/sync/analyze-all', async (request, reply) => {
    await streamSyncEvents(request, reply, ({ signal, onProgress }) => {
      const repositoryIds = catalogService.getAllRepositoryIds();
      catalogService.resetAnalysisForRepositories(repositoryIds);
      return syncService.analyzeRepositories(repositoryIds, { signal, onProgress });
    });
  });

  app.get('/api/stats', async () => {
    return catalogService.getStats();
  });

  app.get('/api/repositories', async () => ({
    repositories: catalogService.listRepositories(),
  }));

  app.patch<{ Params: { id: string } }>('/api/repositories/:id/watch-releases', async (request) => {
    const repositoryId = Number.parseInt(request.params.id, 10);
    const body = request.body as { watchReleases?: boolean };
    catalogService.setWatchReleases(repositoryId, !!body.watchReleases);
    return { ok: true };
  });

  app.post('/api/search', async (request) => {
    const body = searchRequestSchema.parse(request.body);
    const lmStudioConfig = settingsService.getLmStudioConfig();
    return searchService.search(body.query, body.limit, lmStudioConfig);
  });

  app.get('/api/releases', async (request) => {
    const search = request.query as { watchOnly?: string; asset?: string };
    const watchOnly = search.watchOnly !== 'false';
    const assetFilters = catalogService.listAssetFilters().map((filter) => filter.keyword);
    const releases = catalogService.listReleases(watchOnly).map((release) => ({
      ...release,
      assets: release.assets.filter((asset) => {
        const assetSearch = search.asset?.trim().toLowerCase();
        if (assetSearch && !asset.name.toLowerCase().includes(assetSearch)) {
          return false;
        }
        if (assetFilters.length === 0) {
          return true;
        }
        return assetFilters.some((keyword) => asset.name.toLowerCase().includes(keyword));
      }),
    }));
    return { releases, assetFilters: catalogService.listAssetFilters() };
  });

  app.get('/api/asset-filters', async () => ({
    assetFilters: catalogService.listAssetFilters(),
  }));

  app.post('/api/asset-filters', async (request) => {
    const body = request.body as { keyword?: string };
    if (!body.keyword?.trim()) {
      throw new Error('Asset filter keyword is required.');
    }
    return catalogService.addAssetFilter(body.keyword);
  });

  app.delete<{ Params: { id: string } }>('/api/asset-filters/:id', async (request) => {
    catalogService.deleteAssetFilter(Number.parseInt(request.params.id, 10));
    return { ok: true };
  });

  app.get('/api/export', async () => {
    const publicSettings = settingsService.getPublicSettings();
    const lmStudio = publicSettings.lmStudio
      ? {
          baseUrl: publicSettings.lmStudio.baseUrl,
          chatModel: publicSettings.lmStudio.chatModel,
          embeddingModel: publicSettings.lmStudio.embeddingModel,
          concurrency: publicSettings.lmStudio.concurrency,
        }
      : null;
    return catalogService.exportCatalog(lmStudio);
  });

  app.post('/api/import', async (request) => {
    const payload = exportPayloadSchema.parse(request.body);
    catalogService.importCatalog(payload);
    if (payload.lmStudio) {
      settingsService.saveLmStudioConfig({
        baseUrl: payload.lmStudio.baseUrl,
        chatModel: payload.lmStudio.chatModel,
        embeddingModel: payload.lmStudio.embeddingModel,
        apiKey: '',
        concurrency: payload.lmStudio.concurrency ?? 1,
      });
    }
    return { ok: true };
  });

  registerLocalWebApp(app, config);

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    reply.code(400).send({
      message: error instanceof Error ? error.message : 'Unknown error.',
    });
  });

  return app;
}

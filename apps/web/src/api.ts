import type {
  AppSettings,
  ExportPayload,
  HardwareInfo,
  LmStudioModelsResponse,
  LmStudioTestResult,
  SearchResponse,
  SyncProgressEvent,
  SyncSummary,
} from '@github-stars-ai-search/shared';
import { syncProgressEventSchema } from '@github-stars-ai-search/shared';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const payload = await response.json() as { message?: string };
      message = payload.message ?? message;
    } catch {
      // ignore and use status text
    }
    throw new Error(message || `Request failed with ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  return fallback;
}

function getAbortedSyncSummary(): SyncSummary {
  return {
    repositoryCount: 0,
    indexedRepositoryCount: 0,
    releaseCount: 0,
    chunkCount: 0,
    warnings: [],
  };
}

export function getSettings(): Promise<AppSettings> {
  return request('/api/settings');
}

export function testGitHubSettings(input: { token: string }): Promise<{ ok: true }> {
  return request('/api/settings/github/test', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function saveGitHubSettings(input: { token: string }): Promise<AppSettings> {
  return request('/api/settings/github', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function testLmStudioSettings(input: {
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
  apiKey?: string;
  concurrency?: number;
}): Promise<LmStudioTestResult> {
  return request('/api/settings/lm-studio/test', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function saveLmStudioSettings(input: {
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
  apiKey?: string;
  concurrency?: number;
}): Promise<AppSettings> {
  return request('/api/settings/lm-studio', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function discoverModels(baseUrl: string, apiKey?: string): Promise<LmStudioModelsResponse> {
  const params = new URLSearchParams({ baseUrl });
  if (apiKey) params.set('apiKey', apiKey);
  return request(`/api/lm-studio/models?${params.toString()}`);
}

export function getHardwareInfo(): Promise<HardwareInfo> {
  return request('/api/system/hardware');
}

function streamSync(
  path: string,
  onEvent: (event: SyncProgressEvent) => void,
  signal?: AbortSignal,
): Promise<SyncSummary> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const url = `${API_BASE_URL}${path}`;
    const settleResolve = (summary: SyncSummary) => {
      if (settled) return;
      settled = true;
      resolve(summary);
    };
    const settleReject = (error: unknown, fallback: string) => {
      if (settled) return;
      settled = true;
      reject(new Error(getErrorMessage(error, fallback)));
    };
    const processEventBlock = (block: string) => {
      const lines = block
        .split('\n')
        .map((line) => line.trimEnd())
        .filter(Boolean);
      const dataLine = lines.find((line) => line.startsWith('data: '));
      if (!dataLine) {
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(dataLine.slice(6));
      } catch (error) {
        settleReject(error, 'Received an invalid sync event from the server.');
        return;
      }

      const event = syncProgressEventSchema.safeParse(payload);
      if (!event.success) {
        settleReject('Received an invalid sync event from the server.', 'Received an invalid sync event from the server.');
        return;
      }

      onEvent(event.data);
      if (event.data.type === 'complete' || event.data.type === 'cancelled') {
        settleResolve(event.data.summary);
      } else if (event.data.type === 'error') {
        settleReject(event.data.message, 'The sync request failed.');
      }
    };

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          let message = response.statusText;
          try {
            const payload = (await response.json()) as { message?: string };
            message = payload.message ?? message;
          } catch {
            // use status text
          }
          throw new Error(message || `Request failed with ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body.');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '');
          let boundaryIndex = buffer.indexOf('\n\n');
          while (boundaryIndex >= 0) {
            processEventBlock(buffer.slice(0, boundaryIndex));
            buffer = buffer.slice(boundaryIndex + 2);
            boundaryIndex = buffer.indexOf('\n\n');
          }
        }

        buffer += decoder.decode().replace(/\r/g, '');
        if (buffer.trim()) {
          processEventBlock(buffer);
        }

        if (!settled) {
          if (signal?.aborted) {
            settleResolve(getAbortedSyncSummary());
            return;
          }
          settleReject('The server closed the sync stream before sending a final result.', 'The sync request ended unexpectedly.');
        }
      })
      .catch((error) => {
        if (signal?.aborted) {
          settleResolve(getAbortedSyncSummary());
          return;
        }
        settleReject(error, 'The sync request failed.');
      });
  });
}

export function syncFullCatalog(
  onEvent: (event: SyncProgressEvent) => void,
  signal?: AbortSignal,
): Promise<SyncSummary> {
  return streamSync('/api/sync/full', onEvent, signal);
}

export function analyzeRemaining(
  onEvent: (event: SyncProgressEvent) => void,
  signal?: AbortSignal,
): Promise<SyncSummary> {
  return streamSync('/api/sync/analyze-remaining', onEvent, signal);
}

export function analyzeAll(
  onEvent: (event: SyncProgressEvent) => void,
  signal?: AbortSignal,
): Promise<SyncSummary> {
  return streamSync('/api/sync/analyze-all', onEvent, signal);
}

export function getRepositories(): Promise<{ repositories: AppSettings extends never ? never : import('@github-stars-ai-search/shared').RepositoryRecord[] }> {
  return request('/api/repositories');
}

export function searchCatalog(input: { query: string; limit?: number }): Promise<SearchResponse> {
  return request('/api/search', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function toggleWatchReleases(repositoryId: number, watchReleases: boolean): Promise<{ ok: true }> {
  return request(`/api/repositories/${repositoryId}/watch-releases`, {
    method: 'PATCH',
    body: JSON.stringify({ watchReleases }),
  });
}

export function getReleases(watchOnly: boolean, asset?: string): Promise<{
  releases: import('@github-stars-ai-search/shared').ReleaseRecord[];
  assetFilters: import('@github-stars-ai-search/shared').AssetFilterRecord[];
}> {
  const params = new URLSearchParams();
  params.set('watchOnly', String(watchOnly));
  if (asset?.trim()) {
    params.set('asset', asset.trim());
  }
  return request(`/api/releases?${params.toString()}`);
}

export function getAssetFilters(): Promise<{ assetFilters: import('@github-stars-ai-search/shared').AssetFilterRecord[] }> {
  return request('/api/asset-filters');
}

export function addAssetFilter(input: { keyword: string }): Promise<import('@github-stars-ai-search/shared').AssetFilterRecord> {
  return request('/api/asset-filters', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function deleteAssetFilter(input: { id: number }): Promise<{ ok: true }> {
  return request(`/api/asset-filters/${input.id}`, {
    method: 'DELETE',
  });
}

export function getStats(): Promise<{ totalRepositories: number; indexedRepositories: number; totalChunks: number; totalReleases: number }> {
  return request('/api/stats');
}

export function exportCatalog(): Promise<ExportPayload> {
  return request('/api/export');
}

export function importCatalog(payload: ExportPayload): Promise<{ ok: true }> {
  return request('/api/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

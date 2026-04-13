import {
  repositoryPlatformSchema,
  type ReleaseRecord,
  type RepositoryRecord,
  type SyncSummary,
  type UpdateLmStudioSettingsInput,
} from '@github-stars-ai-search/shared';
import { chunkDocument, type SourceDocument } from '../lib/chunking.js';
import type { GitHubRelease, GitHubStarredRepository } from '../lib/github.js';
import { GitHubClient } from '../lib/github.js';
import { LMStudioClient } from '../lib/lmStudio.js';
import { CatalogService, type PersistedChunk } from './catalogService.js';
import { SettingsService } from './settingsService.js';

const HIGH_SIGNAL_FILES = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml'];

function toRepositoryRecord(repository: GitHubStarredRepository): RepositoryRecord {
  return {
    id: repository.id,
    fullName: repository.full_name,
    name: repository.name,
    ownerLogin: repository.owner.login,
    ownerAvatarUrl: repository.owner.avatar_url,
    description: repository.description,
    htmlUrl: repository.html_url,
    stargazerCount: repository.stargazers_count,
    language: repository.language,
    topics: repository.topics ?? [],
    defaultBranch: repository.default_branch,
    pushedAt: repository.pushed_at,
    starredAt: repository.starred_at ?? null,
    summary: null,
    tags: [],
    platforms: [],
    watchReleases: false,
    indexedAt: null,
  };
}

function toReleaseRecord(repositoryId: number, repositoryFullName: string, release: GitHubRelease): ReleaseRecord {
  return {
    id: release.id,
    repositoryId,
    repositoryFullName,
    tagName: release.tag_name,
    name: release.name ?? release.tag_name,
    body: release.body ?? '',
    publishedAt: release.published_at,
    htmlUrl: release.html_url,
    isPrerelease: release.prerelease,
    isDraft: release.draft,
    assets: release.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      size: asset.size,
      downloadCount: asset.download_count,
      contentType: asset.content_type,
      browserDownloadUrl: asset.browser_download_url,
    })),
  };
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}

function inferFacetsFallback(repository: RepositoryRecord): { summary: string; tags: string[]; platforms: string[] } {
  const tags = new Set<string>(repository.topics.slice(0, 4));
  if (repository.language) {
    tags.add(repository.language);
  }

  const platforms = new Set<string>();
  const text = `${repository.description ?? ''} ${repository.topics.join(' ')}`.toLowerCase();
  if (text.includes('docker')) platforms.add('docker');
  if (text.includes('cli') || text.includes('command')) platforms.add('cli');
  if (text.includes('web') || text.includes('frontend') || text.includes('browser')) platforms.add('web');
  if (text.includes('android')) platforms.add('android');
  if (text.includes('ios')) platforms.add('ios');
  if (text.includes('windows')) platforms.add('windows');
  if (text.includes('linux')) platforms.add('linux');
  if (text.includes('mac')) platforms.add('macos');

  return {
    summary: repository.description ?? `${repository.fullName} indexed for AI search.`,
    tags: Array.from(tags).slice(0, 5),
    platforms: Array.from(platforms).filter((platform) => repositoryPlatformSchema.safeParse(platform).success).slice(0, 5),
  };
}

function buildFacetPrompt(repository: RepositoryRecord, documents: SourceDocument[], releases: ReleaseRecord[]): string {
  const serializedDocuments = documents
    .map((document) => `## ${document.kind}:${document.path ?? document.title}\n${truncate(document.content, 2200)}`)
    .join('\n\n');

  const serializedReleases = releases
    .slice(0, 3)
    .map((release) => `- ${release.name} (${release.tagName}): ${truncate(release.body, 600)}`)
    .join('\n');

  return `
Repository: ${repository.fullName}
Description: ${repository.description ?? 'None'}
Primary language: ${repository.language ?? 'Unknown'}
Topics: ${repository.topics.join(', ') || 'None'}

Recent releases:
${serializedReleases || 'None'}

Evidence:
${serializedDocuments || 'No additional documents'}

Return JSON only in this shape:
{
  "summary": "short catalog summary in English",
  "tags": ["tag1", "tag2", "tag3"],
  "platforms": ["web", "cli"]
}

Rules:
- English only
- Summary under 50 words
- Tags should be short and practical
- Platforms must be chosen from: web, windows, macos, linux, ios, android, cli, docker
- Do not include markdown fences or explanations
  `.trim();
}

export interface SyncCallbacks {
  onProgress?: (current: number, total: number, repository: string, phase: 'fetching' | 'indexing' | 'analyzing') => void;
  signal?: AbortSignal;
}

export class SyncService {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly catalogService: CatalogService,
  ) {}

  private async loadDocuments(client: GitHubClient, repository: GitHubStarredRepository): Promise<SourceDocument[]> {
    const [owner, repoName] = repository.full_name.split('/');
    if (!owner || !repoName) {
      throw new Error(`Invalid repository name: ${repository.full_name}`);
    }
    const readme = await client.fetchReadme(owner, repoName);
    const highSignalFiles = await Promise.all(
      HIGH_SIGNAL_FILES.map(async (fileName) => ({
        fileName,
        content: await client.fetchRootFile(owner, repoName, fileName),
      })),
    );

    const documents: SourceDocument[] = [];
    const metadataDocument = [
      `Repository: ${repository.full_name}`,
      `Description: ${repository.description ?? 'None'}`,
      `Language: ${repository.language ?? 'Unknown'}`,
      `Topics: ${(repository.topics ?? []).join(', ') || 'None'}`,
      `Stars: ${repository.stargazers_count}`,
    ].join('\n');

    documents.push({
      kind: 'repository-metadata',
      path: null,
      title: `${repository.full_name} metadata`,
      content: metadataDocument,
    });

    if (readme.trim()) {
      documents.push({
        kind: 'readme',
        path: 'README',
        title: `${repository.full_name} README`,
        content: readme,
      });
    }

    for (const file of highSignalFiles) {
      if (file.content.trim()) {
        documents.push({
          kind: 'manifest',
          path: file.fileName,
          title: `${repository.full_name} ${file.fileName}`,
          content: file.content,
        });
      }
    }

    return documents;
  }

  private async summarizeRepository(
    lmStudioConfig: UpdateLmStudioSettingsInput,
    repository: RepositoryRecord,
    documents: SourceDocument[],
    releases: ReleaseRecord[],
  ): Promise<{ summary: string; tags: string[]; platforms: string[] }> {
    const fallback = inferFacetsFallback(repository);
    const client = new LMStudioClient(lmStudioConfig);

    try {
      const response = await client.chatJson(
        buildFacetPrompt(repository, documents, releases),
        'You are a repository cataloging assistant. Return strict JSON only.',
        320,
      );

      const summary = typeof response.summary === 'string' && response.summary.trim()
        ? response.summary.trim()
        : fallback.summary;
      const tags = Array.isArray(response.tags)
        ? response.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0).slice(0, 5)
        : fallback.tags;
      const platforms = Array.isArray(response.platforms)
        ? response.platforms
            .filter((platform): platform is string => typeof platform === 'string')
            .filter((platform) => repositoryPlatformSchema.safeParse(platform).success)
            .slice(0, 5)
        : fallback.platforms;

      return { summary, tags, platforms };
    } catch {
      return fallback;
    }
  }

  async syncFullCatalog(callbacks?: SyncCallbacks): Promise<SyncSummary> {
    const token = this.settingsService.getGitHubToken();
    const lmStudioConfig = this.settingsService.getLmStudioConfig();
    const githubClient = new GitHubClient(token);
    const lmStudioClient = new LMStudioClient(lmStudioConfig);
    await lmStudioClient.testConnection();

    const repositories = await githubClient.fetchStarredRepositories();
    const warnings: string[] = [];
    let indexedRepositoryCount = 0;
    let releaseCount = 0;
    let chunkCount = 0;
    const concurrency = lmStudioConfig.concurrency ?? 1;

    const processRepository = async (repository: GitHubStarredRepository, repoIndex: number): Promise<void> => {
      try {
        callbacks?.onProgress?.(repoIndex + 1, repositories.length, repository.full_name, 'fetching');

        const repositoryRecord = toRepositoryRecord(repository);
        this.catalogService.upsertRepository(repositoryRecord);

        // Intra-repo parallelism: fetch docs and releases simultaneously
        const [documents, rawReleases] = await Promise.all([
          this.loadDocuments(githubClient, repository),
          githubClient.fetchReleases(repository.owner.login, repository.name),
        ]);

        const releases = rawReleases.map((release) => toReleaseRecord(repository.id, repository.full_name, release));
        this.catalogService.replaceReleases(repository.id, repository.full_name, releases);
        releaseCount += releases.length;

        if (callbacks?.signal?.aborted) return;

        callbacks?.onProgress?.(repoIndex + 1, repositories.length, repository.full_name, 'indexing');

        const embeddedDocuments = [...documents];
        const releaseBodies = releases
          .filter((release) => release.body.trim())
          .slice(0, 3)
          .map<SourceDocument>((release) => ({
            kind: 'release-notes',
            path: release.tagName,
            title: `${repository.full_name} ${release.tagName}`,
            content: release.body,
          }));
        embeddedDocuments.push(...releaseBodies);

        const chunkDrafts = embeddedDocuments.flatMap((document) => chunkDocument(document).map((chunk) => ({ document, chunk })));
        const embeddings = await lmStudioClient.embed(chunkDrafts.map(({ chunk }) => chunk.content));
        const persistedChunks: PersistedChunk[] = [];
        for (let index = 0; index < chunkDrafts.length; index += 1) {
          const draft = chunkDrafts[index];
          if (!draft) {
            continue;
          }
          const { document, chunk } = draft;
          const documentIndex = embeddedDocuments.indexOf(document);
          persistedChunks.push({
            repositoryId: repository.id,
            documentIndex,
            kind: chunk.kind,
            path: chunk.path,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            embedding: embeddings[index] ?? [],
          });
        }

        this.catalogService.replaceDocumentsAndChunks(repository.id, embeddedDocuments, persistedChunks);
        chunkCount += persistedChunks.length;

        if (callbacks?.signal?.aborted) return;

        callbacks?.onProgress?.(repoIndex + 1, repositories.length, repository.full_name, 'analyzing');

        const facets = await this.summarizeRepository(lmStudioConfig, repositoryRecord, embeddedDocuments, releases);
        this.catalogService.updateFacets(repository.id, facets.summary, facets.tags, facets.platforms, new Date().toISOString());
        indexedRepositoryCount += 1;
      } catch (error) {
        warnings.push(`${repository.full_name}: ${(error as Error).message}`);
      }
    };

    if (concurrency <= 1) {
      // Sequential processing (original behavior)
      for (let i = 0; i < repositories.length; i++) {
        if (callbacks?.signal?.aborted) break;
        const repository = repositories[i];
        if (repository) await processRepository(repository, i);
      }
    } else {
      // Parallel processing with concurrency pool
      let nextIndex = 0;
      const runWorker = async (): Promise<void> => {
        while (nextIndex < repositories.length) {
          if (callbacks?.signal?.aborted) break;
          const index = nextIndex++;
          const repository = repositories[index];
          if (repository) {
            await processRepository(repository, index);
          }
        }
      };

      const workers = Array.from({ length: Math.min(concurrency, repositories.length) }, () => runWorker());
      await Promise.all(workers);
    }

    if (!callbacks?.signal?.aborted && repositories.length > 0) {
      this.catalogService.deleteRepositoriesMissingFrom(repositories.map((repository) => repository.id));
    }

    return {
      repositoryCount: repositories.length,
      indexedRepositoryCount,
      releaseCount,
      chunkCount,
      warnings,
    };
  }

  async analyzeRepositories(repositoryIds: number[], callbacks?: SyncCallbacks): Promise<SyncSummary> {
    const lmStudioConfig = this.settingsService.getLmStudioConfig();
    const token = this.settingsService.getGitHubToken();
    const githubClient = new GitHubClient(token);
    const lmStudioClient = new LMStudioClient(lmStudioConfig);
    await lmStudioClient.testConnection();

    const warnings: string[] = [];
    let indexedRepositoryCount = 0;
    let chunkCount = 0;
    const concurrency = lmStudioConfig.concurrency ?? 1;

    const processRepo = async (repoId: number, repoIndex: number): Promise<void> => {
      const repository = this.catalogService.getRepositoryById(repoId);
      if (!repository) return;

      try {
        callbacks?.onProgress?.(repoIndex + 1, repositoryIds.length, repository.fullName, 'fetching');

        const [owner, repoName] = repository.fullName.split('/');
        if (!owner || !repoName) throw new Error(`Invalid repository name: ${repository.fullName}`);

        const starredRepo: GitHubStarredRepository = {
          id: repository.id,
          full_name: repository.fullName,
          name: repository.name,
          owner: { login: owner, avatar_url: repository.ownerAvatarUrl ?? '' },
          description: repository.description,
          html_url: repository.htmlUrl,
          stargazers_count: repository.stargazerCount,
          language: repository.language,
          topics: repository.topics,
          default_branch: repository.defaultBranch,
          pushed_at: repository.pushedAt,
          starred_at: repository.starredAt ?? undefined,
        };

        const [documents, rawReleases] = await Promise.all([
          this.loadDocuments(githubClient, starredRepo),
          githubClient.fetchReleases(owner, repoName),
        ]);

        const releases = rawReleases.map((release) => toReleaseRecord(repository.id, repository.fullName, release));

        if (callbacks?.signal?.aborted) return;
        callbacks?.onProgress?.(repoIndex + 1, repositoryIds.length, repository.fullName, 'indexing');

        const embeddedDocuments = [...documents];
        const releaseBodies = releases
          .filter((release) => release.body.trim())
          .slice(0, 3)
          .map<SourceDocument>((release) => ({
            kind: 'release-notes',
            path: release.tagName,
            title: `${repository.fullName} ${release.tagName}`,
            content: release.body,
          }));
        embeddedDocuments.push(...releaseBodies);

        const chunkDrafts = embeddedDocuments.flatMap((document) => chunkDocument(document).map((chunk) => ({ document, chunk })));
        const embeddings = await lmStudioClient.embed(chunkDrafts.map(({ chunk }) => chunk.content));
        const persistedChunks: PersistedChunk[] = [];
        for (let index = 0; index < chunkDrafts.length; index += 1) {
          const draft = chunkDrafts[index];
          if (!draft) continue;
          const { document, chunk } = draft;
          const documentIndex = embeddedDocuments.indexOf(document);
          persistedChunks.push({
            repositoryId: repository.id,
            documentIndex,
            kind: chunk.kind,
            path: chunk.path,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            embedding: embeddings[index] ?? [],
          });
        }

        this.catalogService.replaceDocumentsAndChunks(repository.id, embeddedDocuments, persistedChunks);
        chunkCount += persistedChunks.length;

        if (callbacks?.signal?.aborted) return;
        callbacks?.onProgress?.(repoIndex + 1, repositoryIds.length, repository.fullName, 'analyzing');

        const facets = await this.summarizeRepository(lmStudioConfig, repository, embeddedDocuments, releases);
        this.catalogService.updateFacets(repository.id, facets.summary, facets.tags, facets.platforms, new Date().toISOString());
        indexedRepositoryCount += 1;
      } catch (error) {
        warnings.push(`${repository.fullName}: ${(error as Error).message}`);
      }
    };

    if (concurrency <= 1) {
      for (let i = 0; i < repositoryIds.length; i++) {
        if (callbacks?.signal?.aborted) break;
        const id = repositoryIds[i];
        if (id !== undefined) await processRepo(id, i);
      }
    } else {
      let nextIndex = 0;
      const runWorker = async (): Promise<void> => {
        while (nextIndex < repositoryIds.length) {
          if (callbacks?.signal?.aborted) break;
          const index = nextIndex++;
          const id = repositoryIds[index];
          if (id !== undefined) await processRepo(id, index);
        }
      };
      const workers = Array.from({ length: Math.min(concurrency, repositoryIds.length) }, () => runWorker());
      await Promise.all(workers);
    }

    return {
      repositoryCount: repositoryIds.length,
      indexedRepositoryCount,
      releaseCount: 0,
      chunkCount,
      warnings,
    };
  }
}

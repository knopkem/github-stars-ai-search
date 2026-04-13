import {
  repositoryPlatformSchema,
  type ReleaseRecord,
  type RepositoryRecord,
  type SyncProgressPhase,
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

const EMPTY_RELEASE_FINGERPRINT = '[]';

interface SyncOptions {
  forceReindex?: boolean;
}

interface RepositoryRefreshCandidate {
  repository: GitHubStarredRepository;
  repositoryRecord: RepositoryRecord;
  rawReleases: GitHubRelease[];
  discoveryIndex: number;
}

function toRepositoryRecord(
  repository: GitHubStarredRepository,
  existingRepository?: RepositoryRecord | null,
): RepositoryRecord {
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
    summary: existingRepository?.summary ?? null,
    tags: existingRepository?.tags ?? [],
    platforms: existingRepository?.platforms ?? [],
    watchReleases: existingRepository?.watchReleases ?? false,
    indexedAt: existingRepository?.indexedAt ?? null,
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

function normalizedTopics(topics: string[]): string[] {
  return [...topics].sort();
}

function hasMeaningfulRepositoryChange(existingRepository: RepositoryRecord, repository: GitHubStarredRepository): boolean {
  return existingRepository.fullName !== repository.full_name
    || existingRepository.htmlUrl !== repository.html_url
    || existingRepository.description !== repository.description
    || existingRepository.language !== repository.language
    || existingRepository.defaultBranch !== repository.default_branch
    || JSON.stringify(normalizedTopics(existingRepository.topics)) !== JSON.stringify(normalizedTopics(repository.topics ?? []));
}

function fingerprintGitHubReleases(releases: GitHubRelease[]): string {
  return JSON.stringify(
    [...releases]
      .sort((left, right) => left.id - right.id)
      .map((release) => [
        release.id,
        release.tag_name,
        release.name ?? '',
        release.body ?? '',
        release.published_at ?? '',
        release.html_url,
        release.prerelease ? 1 : 0,
        release.draft ? 1 : 0,
        [...release.assets]
          .sort((left, right) => left.id - right.id)
          .map((asset) => [
            asset.id,
            asset.name,
            asset.size,
            asset.download_count,
            asset.content_type ?? '',
            asset.browser_download_url,
          ]),
      ]),
  );
}

function fingerprintStoredReleases(releases: ReleaseRecord[]): string {
  return JSON.stringify(
    [...releases]
      .sort((left, right) => left.id - right.id)
      .map((release) => [
        release.id,
        release.tagName,
        release.name,
        release.body,
        release.publishedAt ?? '',
        release.htmlUrl,
        release.isPrerelease ? 1 : 0,
        release.isDraft ? 1 : 0,
        [...release.assets]
          .sort((left, right) => left.id - right.id)
          .map((asset) => [
            asset.id,
            asset.name,
            asset.size,
            asset.downloadCount,
            asset.contentType ?? '',
            asset.browserDownloadUrl,
          ]),
      ]),
  );
}

function buildStoredReleaseFingerprintMap(releases: ReleaseRecord[]): Map<number, string> {
  const releasesByRepositoryId = new Map<number, ReleaseRecord[]>();
  for (const release of releases) {
    const existing = releasesByRepositoryId.get(release.repositoryId) ?? [];
    existing.push(release);
    releasesByRepositoryId.set(release.repositoryId, existing);
  }

  return new Map(
    Array.from(releasesByRepositoryId.entries()).map(([repositoryId, repositoryReleases]) => [
      repositoryId,
      fingerprintStoredReleases(repositoryReleases),
    ]),
  );
}

function formatDiscoveryProgress(discoveredCount: number): string {
  return `${discoveredCount} starred ${discoveredCount === 1 ? 'repository' : 'repositories'} discovered`;
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  signal: AbortSignal | undefined,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  if (workerCount <= 1) {
    for (let index = 0; index < items.length; index += 1) {
      if (signal?.aborted) {
        break;
      }
      const item = items[index];
      if (item !== undefined) {
        await worker(item, index);
      }
    }
    return;
  }

  let nextIndex = 0;
  const runWorker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      if (signal?.aborted) {
        break;
      }
      const index = nextIndex++;
      const item = items[index];
      if (item !== undefined) {
        await worker(item, index);
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
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
  onProgress?: (current: number, total: number, repository: string, phase: SyncProgressPhase) => void;
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

  private buildEmbeddedDocuments(
    repositoryFullName: string,
    documents: SourceDocument[],
    releases: ReleaseRecord[],
  ): SourceDocument[] {
    const embeddedDocuments = [...documents];
    const releaseBodies = releases
      .filter((release) => release.body.trim())
      .slice(0, 3)
      .map<SourceDocument>((release) => ({
        kind: 'release-notes',
        path: release.tagName,
        title: `${repositoryFullName} ${release.tagName}`,
        content: release.body,
      }));
    embeddedDocuments.push(...releaseBodies);
    return embeddedDocuments;
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

  private async indexRepository(
    githubClient: GitHubClient,
    lmStudioClient: LMStudioClient,
    lmStudioConfig: UpdateLmStudioSettingsInput,
    repository: GitHubStarredRepository,
    repositoryRecord: RepositoryRecord,
    rawReleases: GitHubRelease[],
    progress: { current: number; total: number },
    callbacks?: SyncCallbacks,
  ): Promise<{ chunkCount: number; releaseCount: number; completed: boolean }> {
    const documents = await this.loadDocuments(githubClient, repository);
    const releases = rawReleases.map((release) => toReleaseRecord(repository.id, repository.full_name, release));
    this.catalogService.replaceReleases(repository.id, repository.full_name, releases);

    if (callbacks?.signal?.aborted) {
      return { chunkCount: 0, releaseCount: releases.length, completed: false };
    }

    callbacks?.onProgress?.(progress.current, progress.total, repository.full_name, 'indexing');

    const embeddedDocuments = this.buildEmbeddedDocuments(repository.full_name, documents, releases);
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

    if (callbacks?.signal?.aborted) {
      return { chunkCount: persistedChunks.length, releaseCount: releases.length, completed: false };
    }

    callbacks?.onProgress?.(progress.current, progress.total, repository.full_name, 'analyzing');

    const facets = await this.summarizeRepository(lmStudioConfig, repositoryRecord, embeddedDocuments, releases);
    this.catalogService.updateFacets(repository.id, facets.summary, facets.tags, facets.platforms, new Date().toISOString());

    return { chunkCount: persistedChunks.length, releaseCount: releases.length, completed: true };
  }

  async syncFullCatalog(callbacks?: SyncCallbacks, options?: SyncOptions): Promise<SyncSummary> {
    const token = this.settingsService.getGitHubToken();
    const githubClient = new GitHubClient(token);
    const concurrency = this.settingsService.getPublicSettings().lmStudio?.concurrency ?? 1;
    const forceReindex = options?.forceReindex === true;

    const repositories = await githubClient.fetchStarredRepositories(({ discoveredCount, estimatedTotalCount }) => {
      callbacks?.onProgress?.(
        discoveredCount,
        estimatedTotalCount,
        formatDiscoveryProgress(discoveredCount),
        'discovering',
      );
    });
    const warnings: string[] = [];
    let indexedRepositoryCount = 0;
    let releaseCount = 0;
    let chunkCount = 0;
    const existingRepositories = new Map(this.catalogService.listRepositories().map((repository) => [repository.id, repository]));
    const existingReleaseFingerprints = buildStoredReleaseFingerprintMap(this.catalogService.listReleases(false));
    const refreshCandidates: RepositoryRefreshCandidate[] = [];

    await runWithConcurrency(repositories, concurrency, callbacks?.signal, async (repository, repoIndex) => {
      try {
        callbacks?.onProgress?.(repoIndex + 1, repositories.length, repository.full_name, 'fetching');

        const existingRepository = existingRepositories.get(repository.id) ?? null;
        const repositoryRecord = toRepositoryRecord(repository, existingRepository);
        this.catalogService.upsertRepository(repositoryRecord);

        let needsRefresh = forceReindex
          || !existingRepository
          || existingRepository.indexedAt === null
          || existingRepository.pushedAt !== (repository.pushed_at ?? null)
          || (existingRepository !== null && hasMeaningfulRepositoryChange(existingRepository, repository));

        const releasesResult = await githubClient.fetchReleasesResult(repository.owner.login, repository.name);
        if (!releasesResult.ok) {
          warnings.push(`${repository.full_name}: ${releasesResult.error}`);
          if (needsRefresh) {
            refreshCandidates.push({
              repository,
              repositoryRecord,
              rawReleases: [],
              discoveryIndex: repoIndex,
            });
          }
          return;
        }

        const currentReleaseFingerprint = fingerprintGitHubReleases(releasesResult.releases);
        const previousReleaseFingerprint = existingReleaseFingerprints.get(repository.id) ?? EMPTY_RELEASE_FINGERPRINT;
        if (currentReleaseFingerprint !== previousReleaseFingerprint) {
          needsRefresh = true;
        }

        if (needsRefresh) {
          refreshCandidates.push({
            repository,
            repositoryRecord,
            rawReleases: releasesResult.releases,
            discoveryIndex: repoIndex,
          });
        }
      } catch (error) {
        warnings.push(`${repository.full_name}: ${(error as Error).message}`);
      }
    });

    const repositoriesToRefresh = refreshCandidates.sort((left, right) => left.discoveryIndex - right.discoveryIndex);
    if (repositoriesToRefresh.length > 0) {
      this.catalogService.markRepositoriesStale(repositoriesToRefresh.map((candidate) => candidate.repository.id));
    }

    if (!callbacks?.signal?.aborted && repositoriesToRefresh.length > 0) {
      const lmStudioConfig = this.settingsService.getLmStudioConfig();
      const lmStudioClient = new LMStudioClient(lmStudioConfig);
      await lmStudioClient.testConnection();

      await runWithConcurrency(repositoriesToRefresh, concurrency, callbacks?.signal, async (candidate, refreshIndex) => {
        try {
          callbacks?.onProgress?.(refreshIndex + 1, repositoriesToRefresh.length, candidate.repository.full_name, 'fetching');
          const result = await this.indexRepository(
            githubClient,
            lmStudioClient,
            lmStudioConfig,
            candidate.repository,
            candidate.repositoryRecord,
            candidate.rawReleases,
            { current: refreshIndex + 1, total: repositoriesToRefresh.length },
            callbacks,
          );

          releaseCount += result.releaseCount;
          chunkCount += result.chunkCount;
          if (result.completed) {
            indexedRepositoryCount += 1;
          }
        } catch (error) {
          warnings.push(`${candidate.repository.full_name}: ${(error as Error).message}`);
        }
      });
    }

    if (!callbacks?.signal?.aborted) {
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
    let releaseCount = 0;
    let chunkCount = 0;
    const concurrency = lmStudioConfig.concurrency ?? 1;

    await runWithConcurrency(repositoryIds, concurrency, callbacks?.signal, async (repoId, repoIndex) => {
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

        const rawReleases = await githubClient.fetchReleases(owner, repoName);
        const result = await this.indexRepository(
          githubClient,
          lmStudioClient,
          lmStudioConfig,
          starredRepo,
          repository,
          rawReleases,
          { current: repoIndex + 1, total: repositoryIds.length },
          callbacks,
        );

        releaseCount += result.releaseCount;
        chunkCount += result.chunkCount;
        if (result.completed) {
          indexedRepositoryCount += 1;
        }
      } catch (error) {
        warnings.push(`${repository.fullName}: ${(error as Error).message}`);
      }
    });

    return {
      repositoryCount: repositoryIds.length,
      indexedRepositoryCount,
      releaseCount,
      chunkCount,
      warnings,
    };
  }
}

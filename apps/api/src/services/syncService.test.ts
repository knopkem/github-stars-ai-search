import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReleaseRecord, RepositoryRecord } from '@github-stars-ai-search/shared';
import type { GitHubRelease, GitHubStarredRepository } from '../lib/github.js';
import type { CatalogService } from './catalogService.js';
import type { SettingsService } from './settingsService.js';

const githubState = vi.hoisted(() => ({
  fetchStarredRepositories: vi.fn(),
  fetchReleasesResult: vi.fn(),
  fetchReleases: vi.fn(),
  fetchReadme: vi.fn(),
  fetchRootFile: vi.fn(),
}));

const lmStudioState = vi.hoisted(() => ({
  testConnection: vi.fn(),
  embed: vi.fn(),
  chatJson: vi.fn(),
}));

vi.mock('../lib/github.js', () => ({
  GitHubClient: class {
    fetchStarredRepositories = githubState.fetchStarredRepositories;
    fetchReleasesResult = githubState.fetchReleasesResult;
    fetchReleases = githubState.fetchReleases;
    fetchReadme = githubState.fetchReadme;
    fetchRootFile = githubState.fetchRootFile;
  },
}));

vi.mock('../lib/lmStudio.js', () => ({
  LMStudioClient: class {
    testConnection = lmStudioState.testConnection;
    embed = lmStudioState.embed;
    chatJson = lmStudioState.chatJson;
  },
}));

vi.mock('../lib/chunking.js', () => ({
  chunkDocument: vi.fn((document: { kind: string; path: string | null; content: string }) => [
    {
      kind: document.kind,
      path: document.path,
      chunkIndex: 0,
      content: document.content,
    },
  ]),
}));

import { SyncService } from './syncService.js';

const lmStudioConfig = {
  baseUrl: 'http://127.0.0.1:1234',
  chatModel: 'chat-model',
  embeddingModel: 'embedding-model',
  apiKey: '',
  concurrency: 1,
} as const;

function createRepositoryRecord(id: number, overrides: Partial<RepositoryRecord> = {}): RepositoryRecord {
  return {
    id,
    fullName: `owner/repo-${id}`,
    name: `repo-${id}`,
    ownerLogin: 'owner',
    ownerAvatarUrl: 'https://example.com/avatar.png',
    description: `Repository ${id}`,
    htmlUrl: `https://github.com/owner/repo-${id}`,
    stargazerCount: id * 10,
    language: 'TypeScript',
    topics: ['sync'],
    defaultBranch: 'main',
    pushedAt: '2024-01-01T00:00:00Z',
    starredAt: '2024-01-02T00:00:00Z',
    summary: null,
    tags: [],
    platforms: [],
    watchReleases: false,
    needsRefresh: false,
    indexedAt: null,
    ...overrides,
  };
}

function createStarredRepository(record: RepositoryRecord, overrides: Partial<GitHubStarredRepository> = {}): GitHubStarredRepository {
  return {
    id: record.id,
    name: record.name,
    full_name: record.fullName,
    description: record.description,
    html_url: record.htmlUrl,
    stargazers_count: record.stargazerCount,
    language: record.language,
    default_branch: record.defaultBranch,
    pushed_at: record.pushedAt,
    topics: record.topics,
    owner: {
      login: record.ownerLogin,
      avatar_url: record.ownerAvatarUrl ?? '',
    },
    starred_at: record.starredAt ?? undefined,
    ...overrides,
  };
}

function createGitHubRelease(id: number, overrides: Partial<GitHubRelease> = {}): GitHubRelease {
  return {
    id,
    tag_name: `v${id}.0.0`,
    name: `Release ${id}`,
    body: `Release body ${id}`,
    published_at: '2024-01-03T00:00:00Z',
    html_url: `https://github.com/owner/repo/releases/${id}`,
    prerelease: false,
    draft: false,
    assets: [],
    ...overrides,
  };
}

function createReleaseRecord(repositoryId: number, releaseId: number, repositoryFullName = `owner/repo-${repositoryId}`): ReleaseRecord {
  return {
    id: releaseId,
    repositoryId,
    repositoryFullName,
    tagName: `v${releaseId}.0.0`,
    name: `Release ${releaseId}`,
    body: `Release body ${releaseId}`,
    publishedAt: '2024-01-03T00:00:00Z',
    htmlUrl: `https://github.com/owner/repo/releases/${releaseId}`,
    isPrerelease: false,
    isDraft: false,
    assets: [],
  };
}

function createCatalogService(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    listRepositories: vi.fn().mockReturnValue([]),
    listReleases: vi.fn().mockReturnValue([]),
    upsertRepository: vi.fn(),
    markRepositoriesStale: vi.fn(),
    replaceReleases: vi.fn(),
    replaceDocumentsAndChunks: vi.fn(),
    updateFacets: vi.fn(),
    deleteRepositoriesMissingFrom: vi.fn(),
    getRepositoryById: vi.fn(),
    ...overrides,
  } as unknown as CatalogService & Record<string, ReturnType<typeof vi.fn>>;
}

function createSettingsService(options?: { lmStudioConfigured?: boolean }) {
  const lmStudioConfigured = options?.lmStudioConfigured ?? true;
  return {
    getGitHubToken: vi.fn().mockReturnValue('test-token'),
    getLmStudioConfig: vi.fn().mockImplementation(() => {
      if (!lmStudioConfigured) {
        throw new Error('LM Studio should not be required.');
      }
      return lmStudioConfig;
    }),
    getPublicSettings: vi.fn().mockReturnValue({
      githubConfigured: true,
      lmStudio: lmStudioConfigured
        ? {
            baseUrl: lmStudioConfig.baseUrl,
            chatModel: lmStudioConfig.chatModel,
            embeddingModel: lmStudioConfig.embeddingModel,
            apiKeyConfigured: false,
            concurrency: lmStudioConfig.concurrency,
          }
        : null,
    }),
  } as unknown as SettingsService & Record<string, ReturnType<typeof vi.fn>>;
}

describe('SyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    githubState.fetchStarredRepositories.mockResolvedValue([]);
    githubState.fetchReleasesResult.mockResolvedValue({ ok: true, releases: [] });
    githubState.fetchReleases.mockResolvedValue([]);
    githubState.fetchReadme.mockResolvedValue('README');
    githubState.fetchRootFile.mockResolvedValue('');

    lmStudioState.testConnection.mockResolvedValue(undefined);
    lmStudioState.embed.mockImplementation(async (texts: string[]) => texts.map((_, index) => [index + 1]));
    lmStudioState.chatJson.mockResolvedValue({
      summary: 'Refreshed summary',
      tags: ['updated'],
      platforms: ['cli'],
    });
  });

  it('refreshes only repositories that changed and preserves stored analysis for unchanged repositories', async () => {
    const unchangedExisting = createRepositoryRecord(1, {
      summary: 'Keep me',
      tags: ['stable'],
      platforms: ['web'],
      watchReleases: true,
      indexedAt: '2024-01-05T00:00:00Z',
    });
    const changedExisting = createRepositoryRecord(2, {
      summary: 'Refresh me',
      tags: ['old'],
      platforms: ['cli'],
      indexedAt: '2024-01-06T00:00:00Z',
    });
    const newRepository = createRepositoryRecord(3);

    githubState.fetchStarredRepositories.mockResolvedValue([
      createStarredRepository(unchangedExisting),
      createStarredRepository(changedExisting, { description: 'Repository 2 (updated)' }),
      createStarredRepository(newRepository),
    ]);
    githubState.fetchReleasesResult.mockImplementation(async (_owner: string, repo: string) => {
      if (repo === 'repo-1') {
        return { ok: true, releases: [createGitHubRelease(101)] };
      }
      if (repo === 'repo-2') {
        return { ok: true, releases: [createGitHubRelease(201)] };
      }
      return { ok: true, releases: [] };
    });

    const catalogService = createCatalogService({
      listRepositories: vi.fn().mockReturnValue([unchangedExisting, changedExisting]),
      listReleases: vi.fn().mockReturnValue([createReleaseRecord(1, 101)]),
    });
    const settingsService = createSettingsService();

    const syncService = new SyncService(settingsService, catalogService);
    const summary = await syncService.syncFullCatalog();

    expect(summary.repositoryCount).toBe(3);
    expect(summary.indexedRepositoryCount).toBe(2);
    expect(catalogService.markRepositoriesStale).toHaveBeenCalledWith([2, 3]);
    expect(catalogService.replaceDocumentsAndChunks).toHaveBeenCalledTimes(2);
    expect(catalogService.updateFacets).toHaveBeenCalledTimes(2);
    expect(
      (catalogService.replaceDocumentsAndChunks as ReturnType<typeof vi.fn>).mock.calls
        .map((call) => call[0] as number),
    ).toEqual([2, 3]);

    const unchangedUpsert = (catalogService.upsertRepository as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => call[0] as RepositoryRecord)
      .find((repository: RepositoryRecord) => repository.id === 1);

    expect(unchangedUpsert).toMatchObject({
      summary: 'Keep me',
      tags: ['stable'],
      platforms: ['web'],
      watchReleases: true,
      indexedAt: '2024-01-05T00:00:00Z',
    });
    expect(lmStudioState.testConnection).toHaveBeenCalledTimes(1);
  });

  it('does not refresh repositories solely because the upstream pushed_at timestamp changed', async () => {
    const existingRepository = createRepositoryRecord(1, {
      summary: 'Current summary',
      tags: ['stable'],
      platforms: ['web'],
      indexedAt: '2024-01-05T00:00:00Z',
    });

    githubState.fetchStarredRepositories.mockResolvedValue([
      createStarredRepository(existingRepository, { pushed_at: '2024-02-01T00:00:00Z' }),
    ]);
    githubState.fetchReleasesResult.mockResolvedValue({
      ok: true,
      releases: [createGitHubRelease(101)],
    });

    const catalogService = createCatalogService({
      listRepositories: vi.fn().mockReturnValue([existingRepository]),
      listReleases: vi.fn().mockReturnValue([createReleaseRecord(1, 101)]),
    });
    const settingsService = createSettingsService({ lmStudioConfigured: false });

    const syncService = new SyncService(settingsService, catalogService);
    const summary = await syncService.syncFullCatalog();

    expect(summary.indexedRepositoryCount).toBe(0);
    expect(catalogService.markRepositoriesStale).not.toHaveBeenCalled();
    expect(catalogService.replaceDocumentsAndChunks).not.toHaveBeenCalled();
    expect(catalogService.updateFacets).not.toHaveBeenCalled();
    expect(lmStudioState.testConnection).not.toHaveBeenCalled();
  });

  it('skips LM reindex work when every repository is already current', async () => {
    const existingRepository = createRepositoryRecord(1, {
      summary: 'Current summary',
      tags: ['stable'],
      platforms: ['web'],
      indexedAt: '2024-01-05T00:00:00Z',
    });

    githubState.fetchStarredRepositories.mockResolvedValue([
      createStarredRepository(existingRepository),
    ]);
    githubState.fetchReleasesResult.mockResolvedValue({
      ok: true,
      releases: [createGitHubRelease(101)],
    });

    const catalogService = createCatalogService({
      listRepositories: vi.fn().mockReturnValue([existingRepository]),
      listReleases: vi.fn().mockReturnValue([createReleaseRecord(1, 101)]),
    });
    const settingsService = createSettingsService({ lmStudioConfigured: false });

    const syncService = new SyncService(settingsService, catalogService);
    const summary = await syncService.syncFullCatalog();

    expect(summary.indexedRepositoryCount).toBe(0);
    expect(catalogService.markRepositoriesStale).not.toHaveBeenCalled();
    expect(catalogService.replaceDocumentsAndChunks).not.toHaveBeenCalled();
    expect(catalogService.updateFacets).not.toHaveBeenCalled();
    expect(lmStudioState.testConnection).not.toHaveBeenCalled();
  });

  it('does not refresh repositories solely because a GitHub release omits the optional name field', async () => {
    const existingRepository = createRepositoryRecord(1, {
      summary: 'Current summary',
      tags: ['stable'],
      platforms: ['web'],
      indexedAt: '2024-01-05T00:00:00Z',
    });

    githubState.fetchStarredRepositories.mockResolvedValue([
      createStarredRepository(existingRepository),
    ]);
    githubState.fetchReleasesResult.mockResolvedValue({
      ok: true,
      releases: [createGitHubRelease(101, { name: undefined })],
    });

    const catalogService = createCatalogService({
      listRepositories: vi.fn().mockReturnValue([existingRepository]),
      listReleases: vi.fn().mockReturnValue([
        {
          ...createReleaseRecord(1, 101, existingRepository.fullName),
          name: 'v101.0.0',
        },
      ]),
    });
    const settingsService = createSettingsService({ lmStudioConfigured: false });

    const syncService = new SyncService(settingsService, catalogService);
    const summary = await syncService.syncFullCatalog();

    expect(summary.indexedRepositoryCount).toBe(0);
    expect(catalogService.markRepositoriesStale).not.toHaveBeenCalled();
    expect(catalogService.replaceDocumentsAndChunks).not.toHaveBeenCalled();
    expect(catalogService.updateFacets).not.toHaveBeenCalled();
  });

  it('does not refresh repositories solely because release asset download counts changed', async () => {
    const existingRepository = createRepositoryRecord(1, {
      summary: 'Current summary',
      tags: ['stable'],
      platforms: ['web'],
      indexedAt: '2024-01-05T00:00:00Z',
    });

    githubState.fetchStarredRepositories.mockResolvedValue([
      createStarredRepository(existingRepository),
    ]);
    githubState.fetchReleasesResult.mockResolvedValue({
      ok: true,
      releases: [createGitHubRelease(101, {
        assets: [{
          id: 501,
          name: 'tool.zip',
          size: 1024,
          download_count: 99,
          content_type: 'application/zip',
          browser_download_url: 'https://example.com/tool.zip',
        }],
      })],
    });

    const catalogService = createCatalogService({
      listRepositories: vi.fn().mockReturnValue([existingRepository]),
      listReleases: vi.fn().mockReturnValue([
        createReleaseRecord(1, 101, existingRepository.fullName),
      ].map((release) => ({
        ...release,
        assets: [{
          id: 501,
          name: 'tool.zip',
          size: 1024,
          downloadCount: 1,
          contentType: 'application/zip',
          browserDownloadUrl: 'https://example.com/tool.zip',
        }],
      }))),
    });
    const settingsService = createSettingsService({ lmStudioConfigured: false });

    const syncService = new SyncService(settingsService, catalogService);
    const summary = await syncService.syncFullCatalog();

    expect(summary.indexedRepositoryCount).toBe(0);
    expect(catalogService.markRepositoriesStale).not.toHaveBeenCalled();
    expect(catalogService.replaceDocumentsAndChunks).not.toHaveBeenCalled();
    expect(catalogService.updateFacets).not.toHaveBeenCalled();
  });

  it('forces a rebuild for every discovered repository when requested', async () => {
    const existingRepository = createRepositoryRecord(1, {
      summary: 'Current summary',
      tags: ['stable'],
      platforms: ['web'],
      indexedAt: '2024-01-05T00:00:00Z',
    });

    githubState.fetchStarredRepositories.mockResolvedValue([
      createStarredRepository(existingRepository),
    ]);
    githubState.fetchReleasesResult.mockResolvedValue({
      ok: true,
      releases: [createGitHubRelease(101)],
    });

    const catalogService = createCatalogService({
      listRepositories: vi.fn().mockReturnValue([existingRepository]),
      listReleases: vi.fn().mockReturnValue([createReleaseRecord(1, 101)]),
    });
    const settingsService = createSettingsService();

    const syncService = new SyncService(settingsService, catalogService);
    const summary = await syncService.syncFullCatalog(undefined, { forceReindex: true });

    expect(summary.indexedRepositoryCount).toBe(1);
    expect(catalogService.markRepositoriesStale).toHaveBeenCalledWith([1]);
    expect(catalogService.replaceDocumentsAndChunks).toHaveBeenCalledWith(1, expect.any(Array), expect.any(Array));
    expect(lmStudioState.testConnection).toHaveBeenCalledTimes(1);
  });

  it('refreshes repositories that remain marked pending even when indexed data already exists', async () => {
    const existingRepository = createRepositoryRecord(1, {
      summary: 'Current summary',
      tags: ['stable'],
      platforms: ['web'],
      needsRefresh: true,
      indexedAt: '2024-01-05T00:00:00Z',
    });

    githubState.fetchStarredRepositories.mockResolvedValue([
      createStarredRepository(existingRepository),
    ]);
    githubState.fetchReleasesResult.mockResolvedValue({
      ok: true,
      releases: [createGitHubRelease(101)],
    });

    const catalogService = createCatalogService({
      listRepositories: vi.fn().mockReturnValue([existingRepository]),
      listReleases: vi.fn().mockReturnValue([createReleaseRecord(1, 101)]),
    });
    const settingsService = createSettingsService();

    const syncService = new SyncService(settingsService, catalogService);
    const summary = await syncService.syncFullCatalog();

    expect(summary.indexedRepositoryCount).toBe(1);
    expect(catalogService.markRepositoriesStale).toHaveBeenCalledWith([1]);
    expect(catalogService.replaceDocumentsAndChunks).toHaveBeenCalledWith(1, expect.any(Array), expect.any(Array));
  });

  it('fetches release metadata with higher concurrency than LM Studio analysis work', async () => {
    const repositories = [
      createRepositoryRecord(1, { indexedAt: '2024-01-05T00:00:00Z' }),
      createRepositoryRecord(2, { indexedAt: '2024-01-05T00:00:00Z' }),
      createRepositoryRecord(3, { indexedAt: '2024-01-05T00:00:00Z' }),
    ];

    githubState.fetchStarredRepositories.mockResolvedValue(
      repositories.map((repository) => createStarredRepository(repository)),
    );

    let activeFetches = 0;
    let maxConcurrentFetches = 0;
    const releaseResolvers: Array<() => void> = [];
    githubState.fetchReleasesResult.mockImplementation(() => new Promise((resolve) => {
      activeFetches += 1;
      maxConcurrentFetches = Math.max(maxConcurrentFetches, activeFetches);
      releaseResolvers.push(() => {
        activeFetches -= 1;
        resolve({ ok: true, releases: [createGitHubRelease(101)] });
      });
    }));

    const catalogService = createCatalogService({
      listRepositories: vi.fn().mockReturnValue(repositories),
      listReleases: vi.fn().mockReturnValue(repositories.map((repository) => createReleaseRecord(repository.id, 101, repository.fullName))),
    });
    const settingsService = createSettingsService({ lmStudioConfigured: false });

    const syncService = new SyncService(settingsService, catalogService);
    const summaryPromise = syncService.syncFullCatalog();

    await Promise.resolve();
    await Promise.resolve();
    expect(releaseResolvers).toHaveLength(3);
    expect(maxConcurrentFetches).toBeGreaterThan(1);

    releaseResolvers.forEach((resolve) => resolve());

    const summary = await summaryPromise;
    expect(summary.indexedRepositoryCount).toBe(0);
    expect(lmStudioState.testConnection).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryRecord, UpdateLmStudioSettingsInput } from '@github-stars-ai-search/shared';

const queryAnalyzerState = vi.hoisted(() => ({
  analyzeQuery: vi.fn(),
}));

vi.mock('../lib/queryAnalyzer.js', () => ({
  analyzeQuery: queryAnalyzerState.analyzeQuery,
}));

import { SearchService } from './searchService.js';

const lmStudioConfig: UpdateLmStudioSettingsInput = {
  baseUrl: 'http://127.0.0.1:1234',
  chatModel: 'chat-model',
  embeddingModel: 'embedding-model',
  apiKey: '',
  concurrency: 1,
};

function createRepository(id: number): RepositoryRecord {
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
    topics: [],
    defaultBranch: 'main',
    pushedAt: '2024-01-01T00:00:00Z',
    starredAt: '2024-01-02T00:00:00Z',
    summary: null,
    tags: [],
    platforms: [],
    watchReleases: false,
    indexedAt: '2024-01-03T00:00:00Z',
  };
}

function createCatalogService(repositories: RepositoryRecord[]) {
  const repositoryMap = new Map(repositories.map((repository) => [repository.id, repository]));

  return {
    keywordSearchRepositories: vi.fn().mockReturnValue(
      repositories.map((repository, index) => ({
        repositoryId: repository.id,
        rank: index,
      })),
    ),
    keywordSearchChunks: vi.fn().mockReturnValue([]),
    rankChunkVectors: vi.fn().mockReturnValue([]),
    getRepositoryByIds: vi.fn((ids: number[]) => new Map(ids.flatMap((id) => {
      const repository = repositoryMap.get(id);
      return repository ? [[id, repository] as const] : [];
    }))),
  };
}

describe('SearchService', () => {
  beforeEach(() => {
    queryAnalyzerState.analyzeQuery.mockReset();
    queryAnalyzerState.analyzeQuery.mockResolvedValue({
      type: 'simple',
      expandedQuery: 'video production',
      intent: 'Find repositories related to video production',
      keywords: ['video', 'production'],
      hypotheticalDocument: undefined,
    });
  });

  it('returns the full ranked result set when the requested limit exceeds 25', async () => {
    const repositories = Array.from({ length: 30 }, (_, index) => createRepository(index + 1));
    const catalogService = createCatalogService(repositories);
    const searchService = new SearchService(catalogService as never);

    const response = await searchService.search('video production', 30, lmStudioConfig);

    expect(response.totalCandidates).toBe(30);
    expect(response.results).toHaveLength(30);
    expect(response.results.map((result) => result.repository.id)).toEqual(
      repositories.map((repository) => repository.id),
    );
  });
});

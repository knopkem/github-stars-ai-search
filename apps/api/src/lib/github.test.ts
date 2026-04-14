import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubClient } from './github.js';

function createStarredRepository(id: number) {
  return {
    starred_at: `2024-01-${String((id % 28) + 1).padStart(2, '0')}T00:00:00Z`,
    repo: {
      id,
      name: `repo-${id}`,
      full_name: `owner/repo-${id}`,
      description: `Repository ${id}`,
      html_url: `https://github.com/owner/repo-${id}`,
      stargazers_count: id,
      language: 'TypeScript',
      default_branch: 'main',
      pushed_at: '2024-01-01T00:00:00Z',
      topics: ['test'],
      owner: {
        login: 'owner',
        avatar_url: 'https://example.com/avatar.png',
      },
    },
  };
}

function createJsonResponse(body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers,
  });
}

describe('GitHubClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('reports discovery progress while collecting starred repositories', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => createStarredRepository(index + 1));
    const secondPage = Array.from({ length: 3 }, (_, index) => createStarredRepository(index + 101));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        createJsonResponse(firstPage, {
          link: [
            '<https://api.github.com/user/starred?page=2&per_page=100&sort=updated>; rel="next"',
            '<https://api.github.com/user/starred?page=2&per_page=100&sort=updated>; rel="last"',
          ].join(', '),
        }),
      )
      .mockResolvedValueOnce(createJsonResponse(secondPage));

    vi.stubGlobal('fetch', fetchMock);

    const onProgress = vi.fn();
    const client = new GitHubClient('test-token');
    const repositories = await client.fetchStarredRepositories(onProgress);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(repositories).toHaveLength(103);
    expect(repositories[0]?.starred_at).toBe(firstPage[0]?.starred_at);
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      discoveredCount: 100,
      estimatedTotalCount: 200,
    });
    expect(onProgress).toHaveBeenNthCalledWith(2, {
      discoveredCount: 103,
      estimatedTotalCount: 103,
    });
  });

  it('marks discovery complete when the final total is only known after an empty page', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => createStarredRepository(index + 1));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse(firstPage))
      .mockResolvedValueOnce(createJsonResponse([]));

    vi.stubGlobal('fetch', fetchMock);

    const onProgress = vi.fn();
    const client = new GitHubClient('test-token');
    const repositories = await client.fetchStarredRepositories(onProgress);

    expect(repositories).toHaveLength(100);
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      discoveredCount: 100,
      estimatedTotalCount: 200,
    });
    expect(onProgress).toHaveBeenNthCalledWith(2, {
      discoveredCount: 100,
      estimatedTotalCount: 100,
    });
  });

  it('retries transient network failures while fetching starred repositories', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('network error'))
      .mockResolvedValueOnce(createJsonResponse([]));

    vi.stubGlobal('fetch', fetchMock);

    const client = new GitHubClient('test-token');
    const repositoriesPromise = client.fetchStarredRepositories();

    await vi.runAllTimersAsync();
    const repositories = await repositoriesPromise;

    expect(repositories).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fetches remaining starred repository pages in parallel while preserving page order', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => createStarredRepository(index + 1));
    const secondPage = Array.from({ length: 100 }, (_, index) => createStarredRepository(index + 101));
    const thirdPage = Array.from({ length: 2 }, (_, index) => createStarredRepository(index + 201));

    let resolveSecondPage: ((response: Response) => void) | null = null;
    let resolveThirdPage: ((response: Response) => void) | null = null;
    const secondPagePromise = new Promise<Response>((resolve) => {
      resolveSecondPage = resolve;
    });
    const thirdPagePromise = new Promise<Response>((resolve) => {
      resolveThirdPage = resolve;
    });

    const fetchMock = vi.fn((input: string | URL | globalThis.Request) => {
      const url = String(input);
      const page = new URL(url).searchParams.get('page');
      if (page === '1') {
        return Promise.resolve(
          createJsonResponse(firstPage, {
            link: [
              '<https://api.github.com/user/starred?page=2&per_page=100&sort=updated>; rel="next"',
              '<https://api.github.com/user/starred?page=3&per_page=100&sort=updated>; rel="last"',
            ].join(', '),
          }),
        );
      }
      if (page === '2') {
        return secondPagePromise;
      }
      if (page === '3') {
        return thirdPagePromise;
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const onProgress = vi.fn();
    const client = new GitHubClient('test-token');
    const repositoriesPromise = client.fetchStarredRepositories(onProgress);

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    if (!resolveSecondPage || !resolveThirdPage) {
      throw new Error('Expected deferred starred page resolvers to be initialized.');
    }

    const resolvePageThree = resolveThirdPage as (response: Response) => void;
    const resolvePageTwo = resolveSecondPage as (response: Response) => void;

    resolvePageThree(createJsonResponse(thirdPage));
    resolvePageTwo(createJsonResponse(secondPage));

    const repositories = await repositoriesPromise;

    expect(repositories).toHaveLength(202);
    expect(repositories[0]?.id).toBe(1);
    expect(repositories[100]?.id).toBe(101);
    expect(repositories[200]?.id).toBe(201);
    expect(onProgress).toHaveBeenCalledWith({
      discoveredCount: 202,
      estimatedTotalCount: 202,
    });
  });
});

import {
  RetryableHttpError,
  isRetryableHttpStatus,
  withDelayedRetry,
} from './retry.js';
import { runWithConcurrency } from './concurrency.js';

export interface GitHubStarredRepository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  language: string | null;
  default_branch: string | null;
  pushed_at: string | null;
  topics: string[];
  owner: {
    login: string;
    avatar_url: string;
  };
  starred_at?: string;
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string | null;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
  assets: Array<{
    id: number;
    name: string;
    size: number;
    download_count: number;
    content_type: string | null;
    browser_download_url: string;
  }>;
}

export interface StarredRepositoryDiscoveryProgress {
  discoveredCount: number;
  estimatedTotalCount: number;
}

export type GitHubReleasesResult =
  | { ok: true; releases: GitHubRelease[] }
  | { ok: false; releases: []; error: string };

const STARRED_REPOSITORIES_PAGE_SIZE = 100;
const STARRED_DISCOVERY_CONCURRENCY = 6;

function decodeGitHubContent(encodedContent: string): string {
  return Buffer.from(encodedContent.replace(/\n/g, ''), 'base64').toString('utf8');
}

function parseLastPageFromLinkHeader(linkHeader: string | null): number | null {
  if (!linkHeader) {
    return null;
  }

  const lastLink = linkHeader
    .split(',')
    .map((part) => part.trim())
    .find((part) => part.includes('rel="last"'));
  if (!lastLink) {
    return null;
  }

  const urlMatch = lastLink.match(/<([^>]+)>/);
  if (!urlMatch) {
    return null;
  }
  const urlText = urlMatch[1];
  if (!urlText) {
    return null;
  }

  try {
    const url = new URL(urlText);
    const page = Number(url.searchParams.get('page'));
    return Number.isInteger(page) && page > 0 ? page : null;
  } catch {
    return null;
  }
}

export class GitHubClient {
  constructor(private readonly token: string) {}

  private async fetchStarredRepositoriesPage(page: number): Promise<{
    repositories: GitHubStarredRepository[];
    lastPage: number | null;
  }> {
    const response = await this.requestResponse(
      `/user/starred?page=${page}&per_page=${STARRED_REPOSITORIES_PAGE_SIZE}&sort=updated`,
      {
        headers: {
          Accept: 'application/vnd.github.star+json',
        },
      },
    );
    const pageItems = await response.json() as Array<{ starred_at: string; repo: GitHubStarredRepository } | GitHubStarredRepository>;

    return {
      repositories: pageItems.map((item) => (
        'repo' in item && item.repo
          ? {
              ...item.repo,
              starred_at: item.starred_at,
            }
          : item as GitHubStarredRepository
      )),
      lastPage: parseLastPageFromLinkHeader(response.headers.get('link')),
    };
  }

  private async requestResponse(path: string, init?: RequestInit): Promise<Response> {
    return withDelayedRetry(async () => {
      const response = await fetch(`https://api.github.com${path}`, {
        ...init,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init?.headers ?? {}),
        },
      });

      if (!response.ok) {
        const message = await response.text();
        const errorMessage = `GitHub API error (${response.status}): ${message || response.statusText}`;
        if (isRetryableHttpStatus(response.status)) {
          throw new RetryableHttpError(errorMessage, response.status);
        }
        throw new Error(errorMessage);
      }

      return response;
    });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.requestResponse(path, init);
    return response.json() as Promise<T>;
  }

  async validateToken(): Promise<void> {
    await this.request('/user');
  }

  async fetchStarredRepositories(
    onProgress?: (progress: StarredRepositoryDiscoveryProgress) => void,
  ): Promise<GitHubStarredRepository[]> {
    const firstPage = await this.fetchStarredRepositoriesPage(1);
    if (firstPage.repositories.length === 0) {
      return [];
    }

    if (firstPage.lastPage === null) {
      const repositories = [...firstPage.repositories];
      onProgress?.({
        discoveredCount: repositories.length,
        estimatedTotalCount: firstPage.repositories.length < STARRED_REPOSITORIES_PAGE_SIZE
          ? repositories.length
          : repositories.length + STARRED_REPOSITORIES_PAGE_SIZE,
      });

      if (firstPage.repositories.length < STARRED_REPOSITORIES_PAGE_SIZE) {
        return repositories;
      }

      let page = 2;
      while (true) {
        const nextPage = await this.fetchStarredRepositoriesPage(page);
        if (nextPage.repositories.length === 0) {
          onProgress?.({
            discoveredCount: repositories.length,
            estimatedTotalCount: repositories.length,
          });
          break;
        }

        repositories.push(...nextPage.repositories);
        const isLastPage = nextPage.repositories.length < STARRED_REPOSITORIES_PAGE_SIZE;
        onProgress?.({
          discoveredCount: repositories.length,
          estimatedTotalCount: isLastPage ? repositories.length : repositories.length + STARRED_REPOSITORIES_PAGE_SIZE,
        });

        if (isLastPage) {
          break;
        }
        page += 1;
      }

      return repositories;
    }

    const pages = new Map<number, GitHubStarredRepository[]>([[1, firstPage.repositories]]);
    let discoveredCount = firstPage.repositories.length;
    const lastPage = firstPage.lastPage;
    onProgress?.({
      discoveredCount,
      estimatedTotalCount: lastPage === 1 ? discoveredCount : lastPage * STARRED_REPOSITORIES_PAGE_SIZE,
    });

    if (lastPage === 1) {
      return firstPage.repositories;
    }

    const remainingPages = Array.from({ length: lastPage - 1 }, (_, index) => index + 2);
    let completedPages = 1;

    await runWithConcurrency(remainingPages, STARRED_DISCOVERY_CONCURRENCY, undefined, async (pageNumber) => {
      const page = await this.fetchStarredRepositoriesPage(pageNumber);
      pages.set(pageNumber, page.repositories);
      discoveredCount += page.repositories.length;
      completedPages += 1;

      onProgress?.({
        discoveredCount,
        estimatedTotalCount: completedPages === lastPage
          ? discoveredCount
          : lastPage * STARRED_REPOSITORIES_PAGE_SIZE,
      });
    });

    return Array.from({ length: lastPage }, (_, index) => pages.get(index + 1) ?? []).flat();
  }

  async fetchReadme(owner: string, repo: string): Promise<string> {
    try {
      const response = await this.request<{ content: string; encoding: string }>(`/repos/${owner}/${repo}/readme`);
      return response.encoding === 'base64' ? decodeGitHubContent(response.content) : response.content;
    } catch {
      return '';
    }
  }

  async fetchRootFile(owner: string, repo: string, filePath: string): Promise<string> {
    try {
      const response = await this.request<{ content: string; encoding: string }>(
        `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`
      );
      return response.encoding === 'base64' ? decodeGitHubContent(response.content) : response.content;
    } catch {
      return '';
    }
  }

  async fetchReleasesResult(owner: string, repo: string): Promise<GitHubReleasesResult> {
    try {
      return {
        ok: true,
        releases: await this.request<GitHubRelease[]>(`/repos/${owner}/${repo}/releases?per_page=10`),
      };
    } catch (error) {
      return {
        ok: false,
        releases: [],
        error: error instanceof Error && error.message.trim()
          ? error.message
          : `Unable to fetch releases for ${owner}/${repo}.`,
      };
    }
  }

  async fetchReleases(owner: string, repo: string): Promise<GitHubRelease[]> {
    const result = await this.fetchReleasesResult(owner, repo);
    return result.releases;
  }
}

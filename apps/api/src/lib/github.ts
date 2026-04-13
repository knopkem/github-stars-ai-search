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

function decodeGitHubContent(encodedContent: string): string {
  return Buffer.from(encodedContent.replace(/\n/g, ''), 'base64').toString('utf8');
}

export class GitHubClient {
  constructor(private readonly token: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
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
      throw new Error(`GitHub API error (${response.status}): ${message || response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  async validateToken(): Promise<void> {
    await this.request('/user');
  }

  async fetchStarredRepositories(): Promise<GitHubStarredRepository[]> {
    const repositories: GitHubStarredRepository[] = [];
    let page = 1;

    while (true) {
      const pageItems = await this.request<Array<{ starred_at: string; repo: GitHubStarredRepository } | GitHubStarredRepository>>(
        `/user/starred?page=${page}&per_page=100&sort=updated`,
        {
          headers: {
            Accept: 'application/vnd.github.star+json',
          },
        },
      );

      if (pageItems.length === 0) {
        break;
      }

      for (const item of pageItems) {
        if ('repo' in item && item.repo) {
          repositories.push({
            ...item.repo,
            starred_at: item.starred_at,
          });
        } else {
          repositories.push(item as GitHubStarredRepository);
        }
      }

      if (pageItems.length < 100) {
        break;
      }
      page += 1;
    }

    return repositories;
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

  async fetchReleases(owner: string, repo: string): Promise<GitHubRelease[]> {
    try {
      return await this.request<GitHubRelease[]>(`/repos/${owner}/${repo}/releases?per_page=10`);
    } catch {
      return [];
    }
  }
}

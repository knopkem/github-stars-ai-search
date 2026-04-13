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
    const url = `${API_BASE_URL}${path}`;

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
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              // Event type prefix — data follows on next line
            } else if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6)) as SyncProgressEvent;
              onEvent(data);
              if (data.type === 'complete') {
                resolve(data.summary);
              } else if (data.type === 'cancelled') {
                resolve(data.summary);
              } else if (data.type === 'error') {
                reject(new Error(data.message));
              }
            }
          }
        }
      })
      .catch((error) => {
        if (signal?.aborted) {
          resolve({ repositoryCount: 0, indexedRepositoryCount: 0, releaseCount: 0, chunkCount: 0, warnings: [] });
          return;
        }
        reject(error);
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

export function searchCatalog(input: { query: string }): Promise<SearchResponse> {
  return request('/api/search', {
    method: 'POST',
    body: JSON.stringify({ query: input.query }),
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

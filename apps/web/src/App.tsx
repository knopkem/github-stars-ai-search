import { useCallback, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import type { SearchResponse, SyncProgressEvent, SyncSummary } from '@github-stars-ai-search/shared';
import {
  addAssetFilter,
  analyzeAll,
  analyzeRemaining,
  deleteAssetFilter,
  exportCatalog,
  getAssetFilters,
  getRepositories,
  getReleases,
  getSettings,
  getStats as getStatsApi,
  importCatalog,
  saveGitHubSettings,
  saveLmStudioSettings,
  searchCatalog,
  syncFullCatalog,
  testGitHubSettings,
  toggleWatchReleases,
} from './api';
import { Header } from './components/Header';
import { CategorySidebar } from './components/CategorySidebar';
import { CatalogView } from './components/CatalogView';
import { ReleasesView } from './components/ReleasesView';
import { SettingsPanel } from './components/SettingsPanel';
import { StatusBanner } from './components/StatusBanner';
import { useCategories, filterByCategory } from './hooks/useCategories';

type View = 'catalog' | 'releases' | 'settings';

type BannerState = {
  tone: 'success' | 'error' | 'info';
  message: string;
} | null;

const AI_SEARCH_LIMIT = 25;

function getErrorMessage(error: unknown, fallback = 'Request failed.'): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  return fallback;
}

function extractSearchMetadata(response: SearchResponse | null) {
  if (!response) {
    return null;
  }

  const rawResponse = response as SearchResponse & {
    resultCount?: number | null;
    durationMs?: number | null;
    metadata?: Record<string, unknown>;
    searchStrategy?: string | null;
    timingMs?: number | null;
    totalCandidates?: number | null;
  };
  const metadata = rawResponse.metadata ?? {};
  const resultCount =
    typeof rawResponse.resultCount === 'number'
      ? rawResponse.resultCount
      : typeof rawResponse.totalCandidates === 'number'
        ? rawResponse.totalCandidates
      : typeof metadata.resultCount === 'number'
        ? metadata.resultCount
        : typeof metadata.totalCandidates === 'number'
          ? metadata.totalCandidates
        : response.results.length;
  const strategy =
    typeof rawResponse.strategy === 'string'
      ? rawResponse.strategy
      : typeof rawResponse.searchStrategy === 'string'
        ? rawResponse.searchStrategy
        : typeof metadata.strategy === 'string'
          ? metadata.strategy
          : null;
  const durationMs =
    typeof rawResponse.durationMs === 'number'
      ? rawResponse.durationMs
      : typeof rawResponse.timingMs === 'number'
        ? rawResponse.timingMs
        : typeof metadata.durationMs === 'number'
          ? metadata.durationMs
          : typeof metadata.timingMs === 'number'
            ? metadata.timingMs
            : null;

  return {
    resultCount,
    strategy,
    durationMs,
  };
}

function App() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>('catalog');
  const [banner, setBanner] = useState<BannerState>(null);
  const [_lastSyncSummary, setLastSyncSummary] = useState<SyncSummary | null>(null);
  const [latestSearch, setLatestSearch] = useState<SearchResponse | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
  });

  const repositoriesQuery = useQuery({
    queryKey: ['repositories'],
    queryFn: getRepositories,
  });

  const releasesQuery = useQuery({
    queryKey: ['releases'],
    queryFn: () => getReleases(true),
  });

  const assetFiltersQuery = useQuery({
    queryKey: ['asset-filters'],
    queryFn: getAssetFilters,
  });

  const statsQuery = useQuery({
    queryKey: ['stats'],
    queryFn: () => getStatsApi(),
  });

  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number; repository: string; phase: string } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncAbortRef = useRef<AbortController | null>(null);

  const handleSync = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncProgress(null);
    setBanner(null);

    const abortController = new AbortController();
    syncAbortRef.current = abortController;
    let lastRefresh = 0;

    try {
      const summary = await syncFullCatalog(
        (event: SyncProgressEvent) => {
          if (event.type === 'progress') {
            setSyncProgress({ current: event.current, total: event.total, repository: event.repository, phase: event.phase });
            // Refresh repo list every 10 repos so counts update live
            if (event.current - lastRefresh >= 10) {
              lastRefresh = event.current;
              queryClient.invalidateQueries({ queryKey: ['repositories'] });
              queryClient.invalidateQueries({ queryKey: ['stats'] });
            }
          }
        },
        abortController.signal,
      );

      setLastSyncSummary(summary);
      setLastSyncTime(new Date().toISOString());
      setBanner({
        tone: abortController.signal.aborted
          ? 'info'
          : summary.warnings.length > 0 ? 'info' : 'success',
        message: abortController.signal.aborted
          ? `Sync cancelled after indexing ${summary.indexedRepositoryCount}/${summary.repositoryCount} repositories.`
          : `Indexed ${summary.indexedRepositoryCount}/${summary.repositoryCount} repositories and ${summary.chunkCount} chunks.`,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['repositories'] }),
        queryClient.invalidateQueries({ queryKey: ['releases'] }),
        queryClient.invalidateQueries({ queryKey: ['stats'] }),
      ]);
    } catch (error) {
      if (!abortController.signal.aborted) {
        setBanner({ tone: 'error', message: getErrorMessage(error) });
      }
    } finally {
      setIsSyncing(false);
      setSyncProgress(null);
      syncAbortRef.current = null;
    }
  }, [isSyncing, queryClient]);

  const handleCancelSync = useCallback(() => {
    syncAbortRef.current?.abort();
  }, []);

  const handleAnalyze = useCallback(async (mode: 'remaining' | 'all') => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncProgress(null);
    setBanner(null);

    const abortController = new AbortController();
    syncAbortRef.current = abortController;
    let lastRefresh = 0;
    const analyzeFn = mode === 'remaining' ? analyzeRemaining : analyzeAll;

    try {
      const summary = await analyzeFn(
        (event: SyncProgressEvent) => {
          if (event.type === 'progress') {
            setSyncProgress({ current: event.current, total: event.total, repository: event.repository, phase: event.phase });
            if (event.current - lastRefresh >= 10) {
              lastRefresh = event.current;
              queryClient.invalidateQueries({ queryKey: ['repositories'] });
              queryClient.invalidateQueries({ queryKey: ['stats'] });
            }
          }
        },
        abortController.signal,
      );

      setLastSyncSummary(summary);
      setBanner({
        tone: abortController.signal.aborted
          ? 'info'
          : summary.warnings.length > 0 ? 'info' : 'success',
        message: abortController.signal.aborted
          ? `Analysis cancelled after ${summary.indexedRepositoryCount}/${summary.repositoryCount} repositories.`
          : `Analyzed ${summary.indexedRepositoryCount}/${summary.repositoryCount} repositories (${summary.chunkCount} chunks).`,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['repositories'] }),
        queryClient.invalidateQueries({ queryKey: ['stats'] }),
      ]);
    } catch (error) {
      if (!abortController.signal.aborted) {
        setBanner({
          tone: 'error',
          message: `${mode === 'remaining' ? 'Rerun Remaining' : 'Rerun All'} failed: ${getErrorMessage(error)}`,
        });
      }
    } finally {
      setIsSyncing(false);
      setSyncProgress(null);
      syncAbortRef.current = null;
    }
  }, [isSyncing, queryClient]);

  const searchMutation = useMutation({
    mutationFn: searchCatalog,
    onSuccess: (response) => {
      const metadata = extractSearchMetadata(response);
      setLatestSearch(response);
      setBanner({
        tone: 'info',
        message: [
          `Found ${metadata?.resultCount ?? response.results.length} ranked results for "${response.query}".`,
          metadata?.strategy ? `Strategy: ${metadata.strategy}` : null,
          metadata?.durationMs !== null && metadata?.durationMs !== undefined
            ? `${Math.round(metadata.durationMs)} ms`
            : null,
        ].filter(Boolean).join(' • '),
      });
    },
    onError: (error) => {
      setBanner({ tone: 'error', message: (error as Error).message });
    },
  });

  const repositoryWatchMutation = useMutation({
    mutationFn: ({ repositoryId, watchReleases }: { repositoryId: number; watchReleases: boolean }) =>
      toggleWatchReleases(repositoryId, watchReleases),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['repositories'] }),
        queryClient.invalidateQueries({ queryKey: ['releases'] }),
      ]);
    },
  });

  const assetFilterMutation = useMutation({
    mutationFn: addAssetFilter,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['asset-filters'] }),
        queryClient.invalidateQueries({ queryKey: ['releases'] }),
      ]);
    },
    onError: (error) => setBanner({ tone: 'error', message: (error as Error).message }),
  });

  const deleteAssetFilterMutation = useMutation({
    mutationFn: deleteAssetFilter,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['asset-filters'] }),
        queryClient.invalidateQueries({ queryKey: ['releases'] }),
      ]);
    },
  });

  const settingsMutations = {
    saveGitHub: useMutation({
      mutationFn: saveGitHubSettings,
      onSuccess: async () => {
        setBanner({ tone: 'success', message: 'GitHub token saved securely on the server.' });
        await queryClient.invalidateQueries({ queryKey: ['settings'] });
      },
      onError: (error) => setBanner({ tone: 'error', message: (error as Error).message }),
    }),
    testGitHub: useMutation({
      mutationFn: testGitHubSettings,
      onSuccess: () => setBanner({ tone: 'success', message: 'GitHub token is valid.' }),
      onError: (error) => setBanner({ tone: 'error', message: (error as Error).message }),
    }),
    saveLmStudio: useMutation({
      mutationFn: saveLmStudioSettings,
      onSuccess: async () => {
        setBanner({ tone: 'success', message: 'LM Studio settings saved.' });
        await queryClient.invalidateQueries({ queryKey: ['settings'] });
      },
      onError: (error) => setBanner({ tone: 'error', message: (error as Error).message }),
    }),
    exportCatalog: useMutation({
      mutationFn: exportCatalog,
      onSuccess: (payload) => {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `github-stars-ai-search-${new Date().toISOString().slice(0, 10)}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        setBanner({ tone: 'success', message: 'Export created successfully.' });
      },
      onError: (error) => setBanner({ tone: 'error', message: (error as Error).message }),
    }),
    importCatalog: useMutation({
      mutationFn: importCatalog,
      onSuccess: async () => {
        setBanner({ tone: 'success', message: 'Catalog import completed.' });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['repositories'] }),
          queryClient.invalidateQueries({ queryKey: ['releases'] }),
          queryClient.invalidateQueries({ queryKey: ['asset-filters'] }),
        ]);
      },
      onError: (error) => setBanner({ tone: 'error', message: (error as Error).message }),
    }),
  };

  const repositories = repositoriesQuery.data?.repositories ?? [];
  const searchMetadata = useMemo(() => extractSearchMetadata(latestSearch), [latestSearch]);
  const catalogRows = useMemo(() => {
    if (latestSearch) {
      return latestSearch.results.map((result) => ({
        repository: result.repository,
        score: result.score,
        reasons: result.reasons,
        evidenceSnippets: result.evidenceSnippets,
        matchedDocumentKinds: result.matchedDocumentKinds,
        relevanceExplanation: result.relevanceExplanation ?? null,
      }));
    }

    return repositories.map((repository) => ({
      repository,
      score: null,
      reasons: [],
      evidenceSnippets: [],
      matchedDocumentKinds: [],
      relevanceExplanation: null,
    }));
  }, [latestSearch, repositories]);

  const categories = useCategories(repositories);
  const categoryFilteredIds = useMemo(
    () => filterByCategory(repositories, selectedCategory),
    [repositories, selectedCategory],
  );

  return (
    <div className="flex flex-col min-h-screen">
      <Header
        currentView={view}
        onChangeView={setView}
        totalRepositories={repositories.length}
        isSyncing={isSyncing}
        syncProgress={syncProgress}
        onSync={handleSync}
        onCancelSync={handleCancelSync}
        lastSyncTime={lastSyncTime}
      />

      {banner && (
        <div className="px-6 pt-3">
          <StatusBanner
            tone={banner.tone}
            message={banner.message}
            onDismiss={() => setBanner(null)}
          />
        </div>
      )}

      {isSyncing && syncProgress && (
        <div className="flex items-center gap-4 px-6 py-2.5 bg-navy-900/60 border-b border-border-subtle text-sm">
          <RefreshCw className="w-4 h-4 text-accent-blue animate-spin shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <span className="text-text-secondary text-xs truncate">
                {syncProgress.phase === 'fetching' && 'Fetching'}
                {syncProgress.phase === 'indexing' && 'Indexing'}
                {syncProgress.phase === 'analyzing' && 'Analyzing'}
                {' '}
                <span className="text-text-primary font-medium">{syncProgress.repository}</span>
              </span>
              <span className="text-text-muted text-xs shrink-0 ml-2">
                {syncProgress.current} of {syncProgress.total}
              </span>
            </div>
            <div className="w-full h-1 rounded-full bg-navy-700 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent-blue to-accent-purple transition-all duration-500"
                style={{ width: `${Math.round((syncProgress.current / syncProgress.total) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {view === 'catalog' && statsQuery.data && (
        <div className="flex gap-6 px-6 py-3 bg-surface-overlay border-b border-border-subtle text-sm">
          <div>
            <strong className="text-text-primary">{statsQuery.data.indexedRepositories}</strong>
            <span className="text-text-muted ml-1">repositories indexed</span>
          </div>
          <div>
            <strong className="text-text-primary">{statsQuery.data.totalChunks}</strong>
            <span className="text-text-muted ml-1">chunks stored</span>
          </div>
          <div>
            <strong className="text-text-primary">{statsQuery.data.totalReleases}</strong>
            <span className="text-text-muted ml-1">releases refreshed</span>
          </div>
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => handleAnalyze('remaining')}
              disabled={isSyncing}
              className="px-3 py-1 text-xs rounded bg-accent-blue/20 text-accent-blue hover:bg-accent-blue/30 disabled:opacity-50 transition-colors"
            >
              Rerun Remaining
            </button>
            <button
              onClick={() => handleAnalyze('all')}
              disabled={isSyncing}
              className="px-3 py-1 text-xs rounded bg-accent-purple/20 text-accent-purple hover:bg-accent-purple/30 disabled:opacity-50 transition-colors"
            >
              Rerun All
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — only shown on catalog view */}
        {view === 'catalog' && (
          <div className="hidden lg:block p-4 border-r border-border-subtle overflow-y-auto">
            <CategorySidebar
              categories={categories}
              selectedCategory={selectedCategory}
              onSelectCategory={setSelectedCategory}
              totalRepositories={repositories.length}
            />
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-6">
          {view === 'catalog' && (
            <CatalogView
              rows={catalogRows}
              searchResponse={latestSearch}
              searchMetadata={searchMetadata}
              allRepositories={repositories}
              isLoading={repositoriesQuery.isLoading || searchMutation.isPending}
              totalRepositories={repositories.length}
              categoryFilteredIds={categoryFilteredIds}
              onSearch={(query) => {
                if (!query.trim()) {
                  setLatestSearch(null);
                  return;
                }
                searchMutation.mutate({ query, limit: AI_SEARCH_LIMIT });
              }}
              onClearSearch={() => setLatestSearch(null)}
              onToggleWatchReleases={(repository, watchReleases) =>
                repositoryWatchMutation.mutate({ repositoryId: repository.id, watchReleases })
              }
            />
          )}

          {view === 'releases' && (
            <div className="max-w-5xl mx-auto">
              <ReleasesView
                releases={releasesQuery.data?.releases ?? []}
                assetFilters={assetFiltersQuery.data?.assetFilters ?? []}
                isLoading={releasesQuery.isLoading || assetFiltersQuery.isLoading}
                onAddFilter={(keyword) => assetFilterMutation.mutate({ keyword })}
                onDeleteFilter={(id) => deleteAssetFilterMutation.mutate({ id })}
              />
            </div>
          )}

          {view === 'settings' && (
            <div className="max-w-3xl mx-auto">
              <SettingsPanel
                settings={settingsQuery.data ?? null}
                isLoading={settingsQuery.isLoading}
                mutations={settingsMutations}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;

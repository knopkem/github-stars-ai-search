import { useMemo, useState, useCallback } from 'react';
import type { RepositoryRecord, SearchResponse } from '@github-stars-ai-search/shared';
import { SearchBar } from './SearchBar';
import { FilterToolbar } from './FilterToolbar';
import { RepositoryGrid } from './RepositoryGrid';
import { useFilterSort } from '../hooks/useFilterSort';

interface CatalogRow {
  repository: RepositoryRecord;
  score: number | null;
  reasons: string[];
  evidenceSnippets: string[];
  matchedDocumentKinds: string[];
  relevanceExplanation: string | null;
}

interface CatalogViewProps {
  rows: CatalogRow[];
  searchResponse: SearchResponse | null;
  searchMetadata: {
    resultCount: number;
    strategy: string | null;
    durationMs: number | null;
  } | null;
  allRepositories: RepositoryRecord[];
  isLoading: boolean;
  totalRepositories: number;
  categoryFilteredIds: Set<number> | null;
  onSearch: (query: string) => void;
  onClearSearch: () => void;
  onToggleWatchReleases: (repository: RepositoryRecord, watchReleases: boolean) => void;
}

export function CatalogView({
  rows,
  searchResponse,
  searchMetadata,
  allRepositories,
  isLoading,
  totalRepositories,
  categoryFilteredIds,
  onSearch,
  onClearSearch,
  onToggleWatchReleases,
}: CatalogViewProps) {
  const [realtimeQuery, setRealtimeQuery] = useState('');
  const [isAiSearchActive, setIsAiSearchActive] = useState(false);

  const {
    filters,
    setFilters,
    sort,
    setSort,
    displayMode,
    setDisplayMode,
    availableLanguages,
    applyFilters,
    applySort,
    activeFilterCount,
    resetFilters,
  } = useFilterSort(allRepositories);

  const handleSearch = useCallback(
    (query: string) => {
      setIsAiSearchActive(true);
      setRealtimeQuery('');
      onSearch(query);
    },
    [onSearch],
  );

  const handleRealtimeFilter = useCallback((query: string) => {
    setRealtimeQuery(query);
    setIsAiSearchActive(false);
  }, []);

  const handleClear = useCallback(() => {
    setRealtimeQuery('');
    setIsAiSearchActive(false);
    onClearSearch();
  }, [onClearSearch]);

  const processedRows = useMemo(() => {
    let result = rows;

    // Apply category filter
    if (categoryFilteredIds) {
      result = result.filter((r) => categoryFilteredIds.has(r.repository.id));
    }

    // Apply realtime text filter (client-side name/description matching)
    if (realtimeQuery && !isAiSearchActive) {
      const q = realtimeQuery.toLowerCase();
      result = result.filter(
        (r) =>
          r.repository.fullName.toLowerCase().includes(q) ||
          r.repository.name.toLowerCase().includes(q) ||
          (r.repository.description ?? '').toLowerCase().includes(q) ||
          (r.repository.summary ?? '').toLowerCase().includes(q),
      );
    }

    // Apply filters (language, stars, analyzed, watching)
    const filteredRepos = applyFilters(result.map((r) => r.repository));
    const filteredIds = new Set(filteredRepos.map((r) => r.id));
    result = result.filter((r) => filteredIds.has(r.repository.id));

    // Apply sort (only when not showing AI search results with scores)
    if (!isAiSearchActive) {
      const sortedRepos = applySort(result.map((r) => r.repository));
      const idToRow = new Map(result.map((r) => [r.repository.id, r]));
      result = sortedRepos.map((repo) => idToRow.get(repo.id)!).filter(Boolean);
    }

    return result;
  }, [rows, categoryFilteredIds, realtimeQuery, isAiSearchActive, applyFilters, applySort]);

  const analyzedCount = useMemo(
    () => allRepositories.filter((r) => r.indexedAt !== null).length,
    [allRepositories],
  );
  const toolbarTotalCount = searchMetadata?.resultCount ?? totalRepositories;

  const formatTiming = (durationMs: number) => (
    durationMs >= 1000 ? `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s` : `${Math.round(durationMs)}ms`
  );

  return (
    <div className="flex flex-col gap-4">
      <SearchBar
        onSearch={handleSearch}
        onRealtimeFilter={handleRealtimeFilter}
        onClear={handleClear}
        isSearching={isLoading}
        aiResultLimit={25}
      />

      {searchResponse && searchMetadata && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-accent-purple/20 bg-accent-purple/5 px-4 py-3">
          <span className="text-sm font-medium text-text-primary">
            AI search for &ldquo;{searchResponse.query}&rdquo;
          </span>
          <span className="rounded-full bg-accent-blue/10 px-2.5 py-1 text-xs font-medium text-accent-blue">
            {searchMetadata.resultCount} result{searchMetadata.resultCount === 1 ? '' : 's'}
          </span>
          {searchMetadata.strategy && (
            <span className="rounded-full bg-accent-purple/10 px-2.5 py-1 text-xs font-medium uppercase tracking-wide text-accent-purple">
              {searchMetadata.strategy}
            </span>
          )}
          {searchMetadata.durationMs !== null && (
            <span className="rounded-full bg-navy-700/60 px-2.5 py-1 text-xs font-medium text-text-secondary">
              {formatTiming(searchMetadata.durationMs)}
            </span>
          )}
        </div>
      )}

      <FilterToolbar
        sort={sort}
        onSortChange={setSort}
        displayMode={displayMode}
        onDisplayModeChange={setDisplayMode}
        totalCount={toolbarTotalCount}
        visibleCount={processedRows.length}
        analyzedCount={analyzedCount}
        activeFilterCount={activeFilterCount}
        filters={filters}
        onFiltersChange={setFilters}
        onResetFilters={resetFilters}
        availableLanguages={availableLanguages}
      />

      <RepositoryGrid
        rows={processedRows}
        isLoading={isLoading}
        displayMode={displayMode}
        onToggleWatchReleases={onToggleWatchReleases}
      />
    </div>
  );
}

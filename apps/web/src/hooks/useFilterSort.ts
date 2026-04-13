import { useMemo, useState, useCallback } from 'react';
import type { RepositoryRecord } from '@github-stars-ai-search/shared';

export type SortField = 'stars' | 'pushed' | 'name' | 'starred';
export type SortDirection = 'desc' | 'asc';

export interface FilterState {
  languages: string[];
  minStars: number | null;
  maxStars: number | null;
  analyzedOnly: boolean;
  watchingOnly: boolean;
}

export interface SortState {
  field: SortField;
  direction: SortDirection;
}

const INITIAL_FILTER: FilterState = {
  languages: [],
  minStars: null,
  maxStars: null,
  analyzedOnly: false,
  watchingOnly: false,
};

const INITIAL_SORT: SortState = {
  field: 'stars',
  direction: 'desc',
};

export function useFilterSort(repositories: RepositoryRecord[]) {
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTER);
  const [sort, setSort] = useState<SortState>(INITIAL_SORT);
  const [displayMode, setDisplayMode] = useState<'ai' | 'original'>('ai');

  const availableLanguages = useMemo(() => {
    const langs = new Map<string, number>();
    for (const repo of repositories) {
      if (repo.language) {
        langs.set(repo.language, (langs.get(repo.language) ?? 0) + 1);
      }
    }
    return Array.from(langs.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([lang, count]) => ({ lang, count }));
  }, [repositories]);

  const applyFilters = useCallback(
    (repos: RepositoryRecord[]) => {
      let result = repos;

      if (filters.languages.length > 0) {
        result = result.filter((r) => r.language && filters.languages.includes(r.language));
      }
      if (filters.minStars !== null) {
        result = result.filter((r) => r.stargazerCount >= filters.minStars!);
      }
      if (filters.maxStars !== null) {
        result = result.filter((r) => r.stargazerCount <= filters.maxStars!);
      }
      if (filters.analyzedOnly) {
        result = result.filter((r) => r.indexedAt !== null);
      }
      if (filters.watchingOnly) {
        result = result.filter((r) => r.watchReleases);
      }

      return result;
    },
    [filters],
  );

  const applySort = useCallback(
    (repos: RepositoryRecord[]) => {
      const sorted = [...repos];
      const dir = sort.direction === 'desc' ? -1 : 1;

      sorted.sort((a, b) => {
        switch (sort.field) {
          case 'stars':
            return (a.stargazerCount - b.stargazerCount) * dir;
          case 'pushed':
            return ((a.pushedAt ?? '').localeCompare(b.pushedAt ?? '')) * dir;
          case 'name':
            return a.fullName.localeCompare(b.fullName) * dir;
          case 'starred':
            return ((a.starredAt ?? '').localeCompare(b.starredAt ?? '')) * dir;
          default:
            return 0;
        }
      });

      return sorted;
    },
    [sort],
  );

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.languages.length > 0) count++;
    if (filters.minStars !== null) count++;
    if (filters.maxStars !== null) count++;
    if (filters.analyzedOnly) count++;
    if (filters.watchingOnly) count++;
    return count;
  }, [filters]);

  const resetFilters = useCallback(() => setFilters(INITIAL_FILTER), []);

  return {
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
  };
}

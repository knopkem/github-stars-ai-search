import { useState } from 'react';
import { SlidersHorizontal, ArrowUpDown, ChevronDown, Brain, X } from 'lucide-react';
import type { SortField, SortDirection, FilterState } from '../hooks/useFilterSort';

interface FilterToolbarProps {
  sort: { field: SortField; direction: SortDirection };
  onSortChange: (sort: { field: SortField; direction: SortDirection }) => void;
  displayMode: 'ai' | 'original';
  onDisplayModeChange: (mode: 'ai' | 'original') => void;
  totalCount: number;
  visibleCount: number;
  analyzedCount: number;
  activeFilterCount: number;
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  onResetFilters: () => void;
  availableLanguages: Array<{ lang: string; count: number }>;
}

const SORT_OPTIONS: Array<{ field: SortField; label: string }> = [
  { field: 'stars', label: 'Sort by Stars' },
  { field: 'pushed', label: 'Sort by Last Pushed' },
  { field: 'name', label: 'Sort by Name' },
  { field: 'starred', label: 'Sort by Starred Date' },
];

export function FilterToolbar({
  sort,
  onSortChange,
  displayMode,
  onDisplayModeChange,
  totalCount,
  visibleCount,
  analyzedCount,
  activeFilterCount,
  filters,
  onFiltersChange,
  onResetFilters,
  availableLanguages,
}: FilterToolbarProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [showSortDropdown, setShowSortDropdown] = useState(false);

  const currentSortLabel = SORT_OPTIONS.find((o) => o.field === sort.field)?.label ?? 'Sort';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Left: AI Analysis badge + Display toggle */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent-green/10 border border-accent-green/20">
            <Brain className="w-4 h-4 text-accent-green" />
            <span className="text-sm font-medium text-accent-green">AI Analysis</span>
          </div>

          <div className="flex items-center gap-1 text-sm text-text-secondary">
            <span>Display:</span>
            <button
              type="button"
              onClick={() => onDisplayModeChange('ai')}
              className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
                displayMode === 'ai'
                  ? 'text-accent-blue bg-accent-blue/10'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${displayMode === 'ai' ? 'bg-accent-blue' : 'bg-navy-500'}`} />
              AI Summary
            </button>
            <button
              type="button"
              onClick={() => onDisplayModeChange('original')}
              className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
                displayMode === 'original'
                  ? 'text-accent-blue bg-accent-blue/10'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${displayMode === 'original' ? 'bg-accent-blue' : 'bg-navy-500'}`} />
              Original
            </button>
          </div>
        </div>

        {/* Center: Stats */}
        <div className="text-sm text-text-muted">
          Showing <span className="text-text-secondary font-medium">{visibleCount}</span> of{' '}
          <span className="text-text-secondary font-medium">{totalCount}</span> repositories
          {analyzedCount > 0 && (
            <>
              {' • '}
              <span className="text-accent-green font-medium">{analyzedCount}</span> AI analyzed
            </>
          )}
        </div>

        {/* Right: Filters + Sort */}
        <div className="flex items-center gap-2">
          {/* Filters button */}
          <button
            type="button"
            onClick={() => setShowFilters((prev) => !prev)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-colors ${
              activeFilterCount > 0
                ? 'border-accent-blue/40 bg-accent-blue/10 text-accent-blue'
                : 'border-border-default text-text-secondary hover:text-text-primary hover:bg-navy-700/40'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="w-5 h-5 rounded-full bg-accent-blue text-white text-xs flex items-center justify-center font-semibold">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Sort dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowSortDropdown((prev) => !prev)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm border border-border-default text-text-secondary hover:text-text-primary hover:bg-navy-700/40 transition-colors"
            >
              {currentSortLabel}
              <ChevronDown className="w-3.5 h-3.5" />
            </button>

            {showSortDropdown && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowSortDropdown(false)} />
                <div className="absolute right-0 top-full mt-1 w-48 rounded-xl bg-navy-800 border border-border-default shadow-xl z-50 py-1 overflow-hidden">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.field}
                      type="button"
                      onClick={() => {
                        onSortChange({ ...sort, field: opt.field });
                        setShowSortDropdown(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                        sort.field === opt.field
                          ? 'text-accent-blue bg-accent-blue/10'
                          : 'text-text-secondary hover:text-text-primary hover:bg-navy-700/40'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Sort direction toggle */}
          <button
            type="button"
            onClick={() => onSortChange({ ...sort, direction: sort.direction === 'desc' ? 'asc' : 'desc' })}
            className="flex items-center justify-center w-9 h-9 rounded-lg border border-border-default text-text-secondary hover:text-text-primary hover:bg-navy-700/40 transition-colors"
            title={sort.direction === 'desc' ? 'Descending' : 'Ascending'}
          >
            <ArrowUpDown className={`w-4 h-4 transition-transform ${sort.direction === 'asc' ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Expanded filter panel */}
      {showFilters && (
        <div className="p-4 rounded-xl bg-navy-800/60 border border-border-default space-y-4 animate-fade-in-up">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">Filters</h3>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={onResetFilters}
                className="text-xs text-accent-red hover:underline"
              >
                Clear all filters
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Language filter */}
            <div>
              <label className="text-xs font-medium text-text-muted mb-2 block">Language</label>
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                {availableLanguages.slice(0, 20).map(({ lang, count }) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => {
                      const next = filters.languages.includes(lang)
                        ? filters.languages.filter((l) => l !== lang)
                        : [...filters.languages, lang];
                      onFiltersChange({ ...filters, languages: next });
                    }}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors ${
                      filters.languages.includes(lang)
                        ? 'bg-accent-blue/20 text-accent-blue border border-accent-blue/30'
                        : 'bg-navy-700/40 text-text-muted hover:text-text-secondary border border-transparent'
                    }`}
                  >
                    {lang}
                    <span className="opacity-60">({count})</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Star count */}
            <div>
              <label className="text-xs font-medium text-text-muted mb-2 block">Star Count</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  placeholder="Min"
                  value={filters.minStars ?? ''}
                  onChange={(e) =>
                    onFiltersChange({ ...filters, minStars: e.target.value ? Number(e.target.value) : null })
                  }
                  className="w-24 px-3 py-1.5 rounded-lg bg-navy-700/50 border border-border-default text-text-primary text-xs focus:outline-none focus:border-accent-blue/50"
                />
                <span className="text-text-muted text-xs">to</span>
                <input
                  type="number"
                  placeholder="Max"
                  value={filters.maxStars ?? ''}
                  onChange={(e) =>
                    onFiltersChange({ ...filters, maxStars: e.target.value ? Number(e.target.value) : null })
                  }
                  className="w-24 px-3 py-1.5 rounded-lg bg-navy-700/50 border border-border-default text-text-primary text-xs focus:outline-none focus:border-accent-blue/50"
                />
              </div>
            </div>

            {/* Toggles */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-text-muted mb-2 block">Status</label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.analyzedOnly}
                  onChange={(e) => onFiltersChange({ ...filters, analyzedOnly: e.target.checked })}
                  className="w-4 h-4 rounded border-border-default bg-navy-700 accent-accent-blue"
                />
                <span className="text-xs text-text-secondary">AI Analyzed only</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.watchingOnly}
                  onChange={(e) => onFiltersChange({ ...filters, watchingOnly: e.target.checked })}
                  className="w-4 h-4 rounded border-border-default bg-navy-700 accent-accent-blue"
                />
                <span className="text-xs text-text-secondary">Watching releases only</span>
              </label>
            </div>
          </div>

          {/* Active filter pills */}
          {activeFilterCount > 0 && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-border-subtle">
              {filters.languages.map((lang) => (
                <span
                  key={lang}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-accent-blue/15 text-accent-blue text-xs"
                >
                  {lang}
                  <button
                    type="button"
                    onClick={() =>
                      onFiltersChange({ ...filters, languages: filters.languages.filter((l) => l !== lang) })
                    }
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              {filters.minStars !== null && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-accent-blue/15 text-accent-blue text-xs">
                  ≥ {filters.minStars} stars
                  <button type="button" onClick={() => onFiltersChange({ ...filters, minStars: null })}>
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {filters.maxStars !== null && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-accent-blue/15 text-accent-blue text-xs">
                  ≤ {filters.maxStars} stars
                  <button type="button" onClick={() => onFiltersChange({ ...filters, maxStars: null })}>
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {filters.analyzedOnly && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-accent-green/15 text-accent-green text-xs">
                  AI Analyzed
                  <button type="button" onClick={() => onFiltersChange({ ...filters, analyzedOnly: false })}>
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {filters.watchingOnly && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-accent-orange/15 text-accent-orange text-xs">
                  Watching
                  <button type="button" onClick={() => onFiltersChange({ ...filters, watchingOnly: false })}>
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

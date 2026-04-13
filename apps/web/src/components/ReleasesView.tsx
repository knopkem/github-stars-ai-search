import { useMemo, useState } from 'react';
import {
  Search,
  Filter,
  ExternalLink,
  Download,
  Tag,
  X,
  Plus,
  Package,
  AlertTriangle,
  FileText,
} from 'lucide-react';
import type { AssetFilterRecord, ReleaseRecord } from '@github-stars-ai-search/shared';
import { timeAgo } from '../utils/formatting';

interface ReleasesViewProps {
  releases: ReleaseRecord[];
  assetFilters: AssetFilterRecord[];
  isLoading: boolean;
  onAddFilter: (keyword: string) => void;
  onDeleteFilter: (id: number) => void;
}

export function ReleasesView({
  releases,
  assetFilters,
  isLoading,
  onAddFilter,
  onDeleteFilter,
}: ReleasesViewProps) {
  const [draftFilter, setDraftFilter] = useState('');
  const [assetSearch, setAssetSearch] = useState('');

  const visibleReleases = useMemo(() => {
    return releases
      .map((release) => ({
        ...release,
        assets: release.assets.filter((asset) =>
          !assetSearch.trim() || asset.name.toLowerCase().includes(assetSearch.trim().toLowerCase())
        ),
      }))
      .filter((release) => release.assets.length > 0 || release.body.trim() || release.name.trim());
  }, [assetSearch, releases]);

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="flex flex-col gap-5 max-w-5xl mx-auto">
      {/* Page header */}
      <div>
        <h2 className="text-xl font-bold text-text-primary mb-1">Release Tracking</h2>
        <p className="text-sm text-text-muted">
          Releases for repositories you've opted into watching. Toggle watching from the repository cards.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        {/* Asset name search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Filter assets by name (zip, dmg, arm64, setup...)"
            value={assetSearch}
            onChange={(e) => setAssetSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface-input border border-border-default text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-accent-blue/50 transition-colors"
          />
          {assetSearch && (
            <button
              type="button"
              onClick={() => setAssetSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Persisted filter input */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
            <input
              type="text"
              placeholder="Add persistent filter..."
              value={draftFilter}
              onChange={(e) => setDraftFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draftFilter.trim()) {
                  onAddFilter(draftFilter.trim());
                  setDraftFilter('');
                }
              }}
              className="pl-10 pr-4 py-2.5 rounded-xl bg-surface-input border border-border-default text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-accent-blue/50 transition-colors w-56"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              if (!draftFilter.trim()) return;
              onAddFilter(draftFilter.trim());
              setDraftFilter('');
            }}
            disabled={!draftFilter.trim()}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-accent-blue/15 text-accent-blue text-sm font-medium border border-accent-blue/25 hover:bg-accent-blue/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
      </div>

      {/* Active asset filter chips */}
      {assetFilters.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-text-muted self-center mr-1">Active filters:</span>
          {assetFilters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => onDeleteFilter(filter.id)}
              title="Remove filter"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent-purple/15 text-accent-purple text-xs border border-accent-purple/20 hover:bg-accent-purple/25 transition-colors"
            >
              {filter.keyword}
              <X className="w-3 h-3" />
            </button>
          ))}
        </div>
      )}

      {/* Release list */}
      {isLoading ? (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border-default bg-surface-raised p-5 space-y-3">
              <div className="flex items-start justify-between">
                <div className="space-y-2 flex-1">
                  <div className="skeleton h-5 w-1/3 rounded" />
                  <div className="skeleton h-3 w-1/2 rounded" />
                </div>
                <div className="skeleton h-8 w-24 rounded-lg" />
              </div>
              <div className="skeleton h-3 w-full rounded" />
              <div className="skeleton h-3 w-4/5 rounded" />
            </div>
          ))}
        </div>
      ) : visibleReleases.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-navy-700/50 flex items-center justify-center mb-4">
            <Package className="w-8 h-8 text-text-muted" />
          </div>
          <h3 className="text-lg font-semibold text-text-primary mb-1">No releases found</h3>
          <p className="text-sm text-text-muted max-w-md">
            Enable release watching on repositories you care about, then sync the catalog to fetch their releases.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {visibleReleases.map((release) => (
            <article
              key={release.id}
              className="rounded-xl border border-border-default bg-surface-raised overflow-hidden hover:border-border-accent transition-colors"
            >
              {/* Release header */}
              <div className="flex items-start justify-between gap-4 p-5 pb-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h3 className="text-base font-bold text-text-primary truncate">{release.name}</h3>
                    {release.isPrerelease && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-accent-orange/15 text-accent-orange border border-accent-orange/20">
                        <AlertTriangle className="w-3 h-3" />
                        Pre-release
                      </span>
                    )}
                    {release.isDraft && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-navy-600 text-text-muted border border-border-default">
                        Draft
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-text-muted">
                    <span className="font-medium text-text-secondary">{release.repositoryFullName}</span>
                    <span className="flex items-center gap-1">
                      <Tag className="w-3 h-3" />
                      {release.tagName}
                    </span>
                    {release.publishedAt && (
                      <span>{timeAgo(release.publishedAt)}</span>
                    )}
                  </div>
                </div>
                <a
                  href={release.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-text-secondary border border-border-default hover:text-text-primary hover:bg-navy-700/40 transition-colors shrink-0"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open
                </a>
              </div>

              {/* Release body */}
              {release.body && (
                <div className="px-5 pb-3">
                  <p className="text-sm text-text-secondary line-clamp-3">
                    {release.body.slice(0, 400)}{release.body.length > 400 ? '…' : ''}
                  </p>
                </div>
              )}

              {/* Assets */}
              {release.assets.length > 0 && (
                <div className="border-t border-border-subtle mx-5 pt-3 pb-4">
                  <p className="text-xs font-medium text-text-muted mb-2 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" />
                    {release.assets.length} asset{release.assets.length > 1 ? 's' : ''}
                  </p>
                  <div className="flex flex-col gap-2">
                    {release.assets.map((asset) => (
                      <div
                        key={asset.id}
                        className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-navy-900/50 border border-border-subtle"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-text-primary font-medium truncate">{asset.name}</p>
                          <p className="text-xs text-text-muted">
                            {formatSize(asset.size)}
                            {asset.downloadCount > 0 && <> · {asset.downloadCount.toLocaleString()} downloads</>}
                          </p>
                        </div>
                        <a
                          href={asset.browserDownloadUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-accent-blue/15 text-accent-blue border border-accent-blue/20 hover:bg-accent-blue/25 transition-colors shrink-0"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

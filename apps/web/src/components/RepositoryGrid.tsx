import type { RepositoryRecord } from '@github-stars-ai-search/shared';
import { RepositoryCard } from './RepositoryCard';

interface CatalogRow {
  repository: RepositoryRecord;
  score: number | null;
  reasons: string[];
  evidenceSnippets: string[];
  matchedDocumentKinds: string[];
}

interface RepositoryGridProps {
  rows: CatalogRow[];
  isLoading: boolean;
  displayMode: 'ai' | 'original';
  onToggleWatchReleases: (repo: RepositoryRecord, watch: boolean) => void;
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border-default bg-surface-raised p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="skeleton w-9 h-9 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <div className="skeleton h-4 w-2/3 rounded" />
          <div className="skeleton h-3 w-1/3 rounded" />
        </div>
      </div>
      <div className="flex gap-1.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton w-8 h-8 rounded-lg" />
        ))}
      </div>
      <div className="space-y-1.5">
        <div className="skeleton h-3 w-full rounded" />
        <div className="skeleton h-3 w-4/5 rounded" />
      </div>
      <div className="flex gap-1.5">
        <div className="skeleton h-5 w-16 rounded-md" />
        <div className="skeleton h-5 w-20 rounded-md" />
      </div>
      <div className="flex gap-3">
        <div className="skeleton h-3 w-16 rounded" />
        <div className="skeleton h-3 w-12 rounded" />
      </div>
    </div>
  );
}

export function RepositoryGrid({ rows, isLoading, displayMode, onToggleWatchReleases }: RepositoryGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 9 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-navy-700/50 flex items-center justify-center mb-4">
          <span className="text-3xl">🔍</span>
        </div>
        <h3 className="text-lg font-semibold text-text-primary mb-1">No repositories found</h3>
        <p className="text-sm text-text-muted max-w-md">
          Sync the catalog and make sure LM Studio indexing completed successfully, or try a different search query.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {rows.map(({ repository, score, reasons, evidenceSnippets, matchedDocumentKinds }, index) => (
        <RepositoryCard
          key={repository.id}
          repository={repository}
          displayMode={displayMode}
          score={score}
          reasons={reasons}
          evidenceSnippets={evidenceSnippets}
          matchedDocumentKinds={matchedDocumentKinds}
          onToggleWatchReleases={onToggleWatchReleases}
          animationDelay={Math.min(index * 30, 300)}
        />
      ))}
    </div>
  );
}

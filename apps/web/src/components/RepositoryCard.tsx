import { Star, ExternalLink, Bell, BellOff, Brain, GitFork } from 'lucide-react';
import type { RepositoryRecord } from '@github-stars-ai-search/shared';
import { getLanguageColor } from '../utils/languageColors';
import { formatCount, timeAgo } from '../utils/formatting';
import { getPlatformInfo } from '../utils/platformIcons';

interface RepositoryCardProps {
  repository: RepositoryRecord;
  displayMode: 'ai' | 'original';
  score: number | null;
  reasons: string[];
  evidenceSnippets: string[];
  matchedDocumentKinds: string[];
  relevanceExplanation: string | null;
  onToggleWatchReleases: (repo: RepositoryRecord, watch: boolean) => void;
  animationDelay?: number;
}

function getAvatarUrl(ownerLogin: string, ownerAvatarUrl?: string | null): string {
  if (ownerAvatarUrl) return ownerAvatarUrl;
  return `https://github.com/${ownerLogin}.png?size=72`;
}

export function RepositoryCard({
  repository,
  displayMode,
  score,
  reasons,
  evidenceSnippets,
  matchedDocumentKinds,
  relevanceExplanation,
  onToggleWatchReleases,
  animationDelay = 0,
}: RepositoryCardProps) {
  const description =
    displayMode === 'ai' && repository.summary
      ? repository.summary
      : repository.description ?? 'No description available.';
  const showAiLabel = displayMode === 'ai' && repository.summary;
  const langColor = getLanguageColor(repository.language);
  const isAnalyzed = repository.indexedAt !== null;
  const avatarUrl = getAvatarUrl(repository.ownerLogin, (repository as Record<string, unknown>).ownerAvatarUrl as string | null);

  return (
    <article
      className="animate-fade-in-up flex flex-col rounded-xl border border-border-default bg-surface-raised p-4 hover:border-border-accent hover:shadow-lg hover:shadow-accent-blue/5 transition-all duration-200 hover:-translate-y-0.5"
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      {/* Header: Avatar + Name */}
      <div className="flex items-start gap-3 mb-3">
        <img
          src={avatarUrl}
          alt={repository.ownerLogin}
          className="w-9 h-9 rounded-full border border-border-subtle shrink-0 bg-navy-700"
          loading="lazy"
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-text-primary truncate">{repository.name}</h3>
          <p className="text-xs text-text-muted truncate">{repository.ownerLogin}</p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1.5 mb-3">
        <button
          type="button"
          title={isAnalyzed ? 'AI Analyzed' : 'Not yet analyzed'}
          className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs transition-colors ${
            isAnalyzed
              ? 'bg-accent-green/15 text-accent-green'
              : 'bg-accent-purple/15 text-accent-purple'
          }`}
        >
          <Brain className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onToggleWatchReleases(repository, !repository.watchReleases)}
          title={repository.watchReleases ? 'Unwatch releases' : 'Watch releases'}
          className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs transition-colors ${
            repository.watchReleases
              ? 'bg-accent-orange/15 text-accent-orange'
              : 'bg-navy-600/40 text-text-muted hover:text-text-secondary'
          }`}
        >
          {repository.watchReleases ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
        </button>
        <a
          href={repository.htmlUrl}
          target="_blank"
          rel="noreferrer"
          title="Open on GitHub"
          className="w-8 h-8 rounded-lg flex items-center justify-center bg-navy-600/40 text-text-muted hover:text-text-secondary transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
        <div className="flex-1" />
        <span
          className="w-8 h-8 rounded-lg flex items-center justify-center bg-accent-orange/10 text-accent-orange"
          title="Starred"
        >
          <Star className="w-4 h-4 fill-current" />
        </span>
      </div>

      {/* Description */}
      <p className="text-sm text-text-secondary line-clamp-3 mb-2 flex-1">{description}</p>

      {/* AI Summary label */}
      {showAiLabel && (
        <p className="text-xs text-accent-green mb-2 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />
          AI Summary
        </p>
      )}

      {relevanceExplanation && (
        <p className="mb-3 rounded-lg border border-accent-purple/15 bg-accent-purple/5 px-3 py-2 text-xs text-text-secondary line-clamp-3">
          {relevanceExplanation}
        </p>
      )}

      {/* Tags */}
      {repository.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {repository.tags.slice(0, 5).map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 rounded-md text-xs bg-accent-blue/10 text-accent-cyan border border-accent-blue/15"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Platforms */}
      {repository.platforms.length > 0 && (
        <div className="flex items-center gap-2 mb-3 text-xs text-text-muted">
          <span>Platforms:</span>
          <div className="flex gap-1">
            {repository.platforms.map((platform) => {
              const info = getPlatformInfo(platform);
              if (!info) return null;
              const Icon = info.icon;
              return (
                <span
                  key={platform}
                  title={info.label}
                  className="w-6 h-6 rounded flex items-center justify-center bg-navy-600/40"
                  style={{ color: info.color }}
                >
                  <Icon className="w-3.5 h-3.5" />
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer: Language, Stars, AI status, Push date */}
      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 pt-2 border-t border-border-subtle text-xs text-text-muted">
        {repository.language && (
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: langColor }} />
            {repository.language}
          </span>
        )}
        <span className="flex items-center gap-1">
          <Star className="w-3 h-3" />
          {formatCount(repository.stargazerCount)}
        </span>
        {score !== null && (
          <span className="text-accent-purple">
            score {score.toFixed(2)}
          </span>
        )}
        {isAnalyzed && (
          <span className="flex items-center gap-1 text-accent-green">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />
            AI analyzed
          </span>
        )}
        {repository.pushedAt && (
          <span className="flex items-center gap-1 ml-auto">
            <GitFork className="w-3 h-3" />
            Last pushed {timeAgo(repository.pushedAt)}
          </span>
        )}
      </div>

      {/* Search evidence (only shown in search results) */}
      {reasons.length > 0 && (
        <div className="mt-3 pt-2 border-t border-border-subtle space-y-1">
          <p className="text-xs font-semibold text-text-muted">Why it matched</p>
          {reasons.map((reason) => (
            <p key={reason} className="text-xs text-text-secondary pl-2 border-l-2 border-accent-blue">{reason}</p>
          ))}
        </div>
      )}

      {evidenceSnippets.length > 0 && (
        <div className="mt-2 space-y-1">
          <p className="text-xs font-semibold text-text-muted">Evidence</p>
          {evidenceSnippets.slice(0, 2).map((snippet, i) => (
            <p key={i} className="text-xs text-text-secondary pl-2 border-l-2 border-accent-purple line-clamp-2">
              {snippet}
            </p>
          ))}
        </div>
      )}

      {matchedDocumentKinds.length > 0 && (
        <p className="mt-1 text-xs text-text-muted">
          Sources: {matchedDocumentKinds.join(', ')}
        </p>
      )}
    </article>
  );
}

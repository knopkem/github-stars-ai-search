import type { SyncProgress } from '@github-stars-ai-search/shared';
import {
  Search,
  Package,
  Settings,
  RefreshCw,
  Star,
  X,
} from 'lucide-react';
import { timeAgo } from '../utils/formatting';

type View = 'catalog' | 'releases' | 'settings';

interface HeaderProps {
  currentView: View;
  onChangeView: (view: View) => void;
  totalRepositories: number;
  isSyncing: boolean;
  syncProgress: SyncProgress | null;
  onSync: () => void;
  onCancelSync: () => void;
  lastSyncTime: string | null;
}

export function Header({
  currentView,
  onChangeView,
  totalRepositories,
  isSyncing,
  syncProgress,
  onSync,
  onCancelSync,
  lastSyncTime,
}: HeaderProps) {
  const tabs: Array<{ id: View; label: string; icon: typeof Search; badge?: string }> = [
    { id: 'catalog', label: 'Repositories', icon: Search, badge: totalRepositories > 0 ? `${totalRepositories}` : undefined },
    { id: 'releases', label: 'Releases', icon: Package },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <header className="flex items-center justify-between px-6 py-3 bg-navy-900/80 border-b border-border-default backdrop-blur-md sticky top-0 z-50">
      {/* Left: Logo & Title */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-accent-blue to-accent-purple">
          <Star className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-text-primary leading-tight">GitHub Stars AI Search</h1>
          <p className="text-xs text-text-muted leading-tight">AI-powered repository management</p>
        </div>
      </div>

      {/* Center: Navigation Tabs */}
      <nav className="flex items-center gap-1" aria-label="Primary views">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentView === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChangeView(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-accent-blue text-white shadow-lg shadow-accent-blue/25'
                  : 'text-text-secondary hover:text-text-primary hover:bg-navy-700/50'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
              {tab.badge && (
                <span
                  className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                    isActive ? 'bg-white/20 text-white' : 'bg-navy-600 text-text-secondary'
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Right: Sync & Status */}
      <div className="flex items-center gap-3">
        {isSyncing && syncProgress && (
          <div className="flex items-center gap-2">
            <div className="w-32 h-1.5 rounded-full bg-navy-700 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent-blue to-accent-cyan transition-all duration-300"
                style={{ width: `${Math.round((syncProgress.current / syncProgress.total) * 100)}%` }}
              />
            </div>
            <span className="text-xs text-text-muted whitespace-nowrap">
              {syncProgress.current}/{syncProgress.total}
            </span>
          </div>
        )}
        {!isSyncing && lastSyncTime && (
          <span className="text-xs text-text-muted">
            Last sync {timeAgo(lastSyncTime)}
          </span>
        )}
        {isSyncing ? (
          <button
            type="button"
            onClick={onCancelSync}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-accent-red hover:bg-accent-red/10 transition-colors"
            title="Cancel sync"
          >
            <X className="w-4 h-4" />
            <span className="text-xs">Cancel</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onSync}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-navy-700/50 transition-colors"
            title="Sync and index catalog"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
      </div>
    </header>
  );
}

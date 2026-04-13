import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, X, Sparkles } from 'lucide-react';

interface SearchBarProps {
  onSearch: (query: string) => void;
  onRealtimeFilter: (query: string) => void;
  onClear: () => void;
  isSearching: boolean;
  aiResultLimit?: number;
}

export function SearchBar({ onSearch, onRealtimeFilter, onClear, isSearching, aiResultLimit = 25 }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [isRealtime, setIsRealtime] = useState(true);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (isRealtime) {
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          onRealtimeFilter(value);
        }, 150);
      }
    },
    [isRealtime, onRealtimeFilter],
  );

  const handleSubmit = useCallback(() => {
    if (query.trim()) {
      setIsRealtime(false);
      onSearch(query.trim());
    }
  }, [query, onSearch]);

  const handleClear = useCallback(() => {
    setQuery('');
    setIsRealtime(true);
    onClear();
    inputRef.current?.focus();
  }, [onClear]);

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
            placeholder='Search repositories… try "audio production" or "local-first notes"'
            className="w-full pl-12 pr-10 py-3 rounded-xl bg-navy-800/80 border border-border-default text-text-primary placeholder:text-text-muted text-sm focus:outline-none focus:border-accent-blue/50 focus:ring-1 focus:ring-accent-blue/25 transition-all"
          />
          {query && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full text-text-muted hover:text-text-primary hover:bg-navy-600/50 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!query.trim() || isSearching}
          className="flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-accent-pink to-accent-purple text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 whitespace-nowrap"
        >
          <Sparkles className="w-4 h-4" />
          AI Search
        </button>
      </div>

      {/* Search mode indicator */}
      <div className="flex items-center gap-2 px-1">
        {isRealtime ? (
          <p className="text-xs text-accent-green flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
            Real-time search mode — matching repository names
          </p>
        ) : (
          <p className="text-xs text-accent-purple flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" />
            AI deep search — press Enter or click AI Search for up to {aiResultLimit} semantic results
          </p>
        )}
        {!isRealtime && (
          <button
            type="button"
            onClick={() => {
              setIsRealtime(true);
              onClear();
            }}
            className="text-xs text-text-muted hover:text-text-primary underline"
          >
            Switch to real-time
          </button>
        )}
      </div>
    </div>
  );
}

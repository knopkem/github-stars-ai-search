import { FolderOpen } from 'lucide-react';
import type { Category } from '../hooks/useCategories';

interface CategorySidebarProps {
  categories: Category[];
  selectedCategory: string | null;
  onSelectCategory: (categoryId: string | null) => void;
  totalRepositories: number;
}

export function CategorySidebar({
  categories,
  selectedCategory,
  onSelectCategory,
  totalRepositories,
}: CategorySidebarProps) {
  return (
    <aside className="w-60 shrink-0 flex flex-col gap-1">
      <div className="flex items-center justify-between px-3 mb-2">
        <h2 className="text-sm font-semibold text-text-primary">Categories</h2>
      </div>

      {/* All Categories */}
      <button
        type="button"
        onClick={() => onSelectCategory(null)}
        className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-left text-sm transition-all duration-200 ${
          selectedCategory === null
            ? 'bg-accent-blue/15 text-accent-cyan border border-accent-blue/30'
            : 'text-text-secondary hover:bg-navy-700/40 hover:text-text-primary border border-transparent'
        }`}
      >
        <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-accent-orange/15">
          <FolderOpen className="w-4 h-4 text-accent-orange" />
        </span>
        <span className="flex-1 truncate font-medium">All Categories</span>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            selectedCategory === null
              ? 'bg-accent-blue/25 text-accent-cyan'
              : 'bg-navy-600/60 text-text-muted'
          }`}
        >
          {totalRepositories}
        </span>
      </button>

      {/* Category List */}
      <div className="flex flex-col gap-0.5 overflow-y-auto max-h-[calc(100vh-12rem)] pr-1">
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => onSelectCategory(cat.id)}
            className={`flex items-center gap-3 w-full px-3 py-2 rounded-xl text-left text-sm transition-all duration-200 ${
              selectedCategory === cat.id
                ? 'bg-accent-blue/15 text-accent-cyan border border-accent-blue/30'
                : 'text-text-secondary hover:bg-navy-700/40 hover:text-text-primary border border-transparent'
            }`}
          >
            <span className="text-base leading-none w-7 text-center">{cat.emoji}</span>
            <span className="flex-1 truncate">{cat.name}</span>
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                selectedCategory === cat.id
                  ? 'bg-accent-blue/25 text-accent-cyan'
                  : 'bg-navy-600/60 text-text-muted'
              }`}
            >
              {cat.count}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

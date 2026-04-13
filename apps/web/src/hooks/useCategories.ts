import { useMemo } from 'react';
import type { RepositoryRecord } from '@github-stars-ai-search/shared';

export interface Category {
  id: string;
  name: string;
  emoji: string;
  count: number;
}

// Predefined category mappings: tag substrings → category display
const CATEGORY_DEFINITIONS: Array<{
  id: string;
  name: string;
  emoji: string;
  matchTags: string[];
}> = [
  { id: 'web-apps', name: 'Web Apps', emoji: '🌐', matchTags: ['web', 'frontend', 'react', 'vue', 'svelte', 'angular', 'nextjs', 'webapp'] },
  { id: 'mobile-apps', name: 'Mobile Apps', emoji: '📱', matchTags: ['mobile', 'ios', 'android', 'react-native', 'flutter'] },
  { id: 'desktop-apps', name: 'Desktop Apps', emoji: '🖥️', matchTags: ['desktop', 'electron', 'tauri', 'gui'] },
  { id: 'database', name: 'Database', emoji: '🗄️', matchTags: ['database', 'sql', 'nosql', 'postgres', 'sqlite', 'redis', 'mongodb'] },
  { id: 'ai-ml', name: 'AI / Machine Learning', emoji: '🤖', matchTags: ['ai', 'machine-learning', 'deep-learning', 'llm', 'nlp', 'neural', 'ml'] },
  { id: 'dev-tools', name: 'Development Tools', emoji: '🛠️', matchTags: ['developer-tools', 'devtools', 'cli', 'tooling', 'build', 'testing', 'linting', 'automation'] },
  { id: 'security', name: 'Security Tools', emoji: '🔒', matchTags: ['security', 'encryption', 'auth', 'vulnerability', 'pentest'] },
  { id: 'games', name: 'Games', emoji: '🎮', matchTags: ['game', 'gaming', 'gamedev', 'game-engine'] },
  { id: 'design', name: 'Design Tools', emoji: '🎨', matchTags: ['design', 'ui', 'ux', 'css', 'styling', 'icons', 'fonts'] },
  { id: 'productivity', name: 'Productivity', emoji: '⚡', matchTags: ['productivity', 'notes', 'todo', 'calendar', 'workflow'] },
  { id: 'education', name: 'Education', emoji: '📚', matchTags: ['education', 'tutorial', 'learning', 'course', 'documentation'] },
  { id: 'networking', name: 'Networking', emoji: '🌍', matchTags: ['networking', 'http', 'api', 'proxy', 'dns', 'server'] },
  { id: 'data-analytics', name: 'Data Analytics', emoji: '📊', matchTags: ['data', 'analytics', 'visualization', 'dashboard', 'charts'] },
  { id: 'devops', name: 'DevOps', emoji: '🚀', matchTags: ['devops', 'docker', 'kubernetes', 'ci-cd', 'infrastructure', 'deployment', 'cloud'] },
  { id: 'media', name: 'Media', emoji: '🎬', matchTags: ['media', 'video', 'audio', 'image', 'streaming', 'music'] },
];

function repoMatchesCategory(repo: RepositoryRecord, matchTags: string[]): boolean {
  const repoTags = repo.tags.map((t) => t.toLowerCase());
  const repoTopics = repo.topics.map((t) => t.toLowerCase());
  const allTerms = [...repoTags, ...repoTopics];

  return matchTags.some((match) =>
    allTerms.some((term) => term.includes(match))
  );
}

export function useCategories(repositories: RepositoryRecord[]): Category[] {
  return useMemo(() => {
    const categories: Category[] = [];

    for (const def of CATEGORY_DEFINITIONS) {
      const count = repositories.filter((repo) => repoMatchesCategory(repo, def.matchTags)).length;
      if (count > 0) {
        categories.push({ id: def.id, name: def.name, emoji: def.emoji, count });
      }
    }

    // Sort by count descending
    categories.sort((a, b) => b.count - a.count);

    return categories;
  }, [repositories]);
}

export function filterByCategory(
  repositories: RepositoryRecord[],
  categoryId: string | null,
): Set<number> | null {
  if (!categoryId) return null;

  const def = CATEGORY_DEFINITIONS.find((d) => d.id === categoryId);
  if (!def) return null;

  const ids = new Set<number>();
  for (const repo of repositories) {
    if (repoMatchesCategory(repo, def.matchTags)) {
      ids.add(repo.id);
    }
  }
  return ids;
}

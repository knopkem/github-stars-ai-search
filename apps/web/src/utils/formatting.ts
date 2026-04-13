const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;
const SECONDS_PER_MONTH = 2592000; // ~30 days
const SECONDS_PER_YEAR = 31536000; // ~365 days

export function timeAgo(dateString: string | null | undefined): string {
  if (!dateString) return '';
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);

  if (seconds < SECONDS_PER_MINUTE) return 'just now';
  if (seconds < SECONDS_PER_HOUR) {
    const m = Math.floor(seconds / SECONDS_PER_MINUTE);
    return `${m} minute${m !== 1 ? 's' : ''} ago`;
  }
  if (seconds < SECONDS_PER_DAY) {
    const h = Math.floor(seconds / SECONDS_PER_HOUR);
    return `${h} hour${h !== 1 ? 's' : ''} ago`;
  }
  if (seconds < SECONDS_PER_MONTH) {
    const d = Math.floor(seconds / SECONDS_PER_DAY);
    return `${d} day${d !== 1 ? 's' : ''} ago`;
  }
  if (seconds < SECONDS_PER_YEAR) {
    const mo = Math.floor(seconds / SECONDS_PER_MONTH);
    return mo === 1 ? '1 month ago' : `${mo} months ago`;
  }
  const y = Math.floor(seconds / SECONDS_PER_YEAR);
  return y === 1 ? '1 year ago' : `about ${y} years ago`;
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return n.toLocaleString();
}

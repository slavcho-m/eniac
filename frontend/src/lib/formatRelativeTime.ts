const MINUTE = 60;
const HOUR = MINUTE * 60;
const DAY = HOUR * 24;

/** "18m ago" / "3h ago" / "5d ago", falling back to a short date past a week — matches
 * the reference design's sidebar timestamps. */
export function formatRelativeTime(isoString: string, now: Date = new Date()): string {
  const diffSeconds = Math.max(0, Math.floor((now.getTime() - new Date(isoString).getTime()) / 1000));

  if (diffSeconds < MINUTE) return "just now";
  if (diffSeconds < HOUR) return `${Math.floor(diffSeconds / MINUTE)}m ago`;
  if (diffSeconds < DAY) return `${Math.floor(diffSeconds / HOUR)}h ago`;
  if (diffSeconds < DAY * 7) return `${Math.floor(diffSeconds / DAY)}d ago`;
  return new Date(isoString).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "Today" / "Yesterday" / a short date — the sidebar's task-list group heading for a
 * given timestamp. */
export function dateGroupLabel(isoString: string, now: Date = new Date()): string {
  const date = new Date(isoString);
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / (DAY * 1000));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

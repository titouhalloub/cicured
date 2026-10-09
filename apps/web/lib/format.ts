/** Date/duration formatting helpers (no date-fns — kept dependency-free). */

/** Absolute UTC timestamp, stable for SSR/hydration (first client render matches). */
export function formatAbsolute(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

/** "just now" / "5 min ago" / "3 h ago" / "2 d ago". Client-side after mount. */
export function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 30) return "just now";
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

/** Short commit sha for tables (7 chars, matches GitHub's default). */
export function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : "—";
}

/** Build duration in minutes -> "3m" / "—". */
export function formatDuration(minutes: number | null): string {
  return minutes === null ? "—" : `${minutes}m`;
}

/**
 * Value formatting. Everything here produces a string that will be rendered in
 * IBM Plex Mono, because it is data — chrome never routes through this file.
 *
 * Shared by Server and Client Components, so nothing in here may touch the
 * database, the environment, or `server-only`.
 */

/**
 * A run id, short enough to scan in a header and long enough to be unique in
 * practice: `a41f·c9`. The interpunct is the separator used everywhere in the
 * console for "same value, two parts" — never a hyphen, which reads as a range.
 *
 * This is a display form only. Every link, query and API call uses the full id.
 */
export function shortRunId(id: string): string {
  const flat = id.replace(/-/g, "");
  return flat.slice(0, 4) + "·" + flat.slice(4, 6);
}

/** `mm:ss`, or `h:mm:ss` past an hour. Runs are minutes, not days. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** Thousands separators. A five-figure conflict count is unreadable without. */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * A stat that has not been computed yet reads as an em dash, not as zero.
 * "0 matches" and "matching has not run" are different facts and the run screen
 * is polled mid-pipeline, so it shows both.
 */
export function formatStat(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : formatCount(n);
}

/** `18:02:11` — wall-clock, for the audit timeline. */
export function formatClockTime(date: Date): string {
  return date.toLocaleTimeString("en-GB", { hour12: false });
}

/** `2026-08-06 18:02` — full stamp for tables and exports. */
export function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** `2d ago` — coarse on purpose; recency survivorship cares about days. */
export function formatRelative(date: Date, now: Date = new Date()): string {
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** `0.91` — confidence is always two decimals, never a percentage. */
export function formatConfidence(confidence: number): string {
  return confidence.toFixed(2);
}

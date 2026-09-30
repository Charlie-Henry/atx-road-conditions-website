/**
 * Socrata "floating" timestamps look like 2026-09-30T15:35:00.000 with no
 * zone. Interpret the wall-clock time as being in `timeZone`.
 */

function tzOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  const wallAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return wallAsUtc - Math.floor(utcMs / 1000) * 1000;
}

export function parseFloatingTimestamp(ts: string, timeZone: string): Date {
  // Already has an explicit zone (Z or +/-hh:mm): trust it.
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(ts)) return new Date(ts);

  const m = ts.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return new Date(NaN);
  const [, y, mo, d, h, mi, s] = m;
  const naiveUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0));

  // Two passes so the offset is right on either side of a DST change.
  let result = naiveUtc - tzOffsetMs(naiveUtc, timeZone);
  result = naiveUtc - tzOffsetMs(result, timeZone);
  return new Date(result);
}

export interface Freshness {
  ageMs: number;
  isStale: boolean;
  /** Timestamp is meaningfully in the future, which usually means a timezone misconfiguration. */
  isFuture: boolean;
}

export function getFreshness(observed: Date, now: Date, staleAfterHours: number): Freshness {
  const ageMs = now.getTime() - observed.getTime();
  return {
    ageMs,
    isStale: ageMs > staleAfterHours * 3_600_000,
    isFuture: ageMs < -5 * 60_000,
  };
}

export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  if (totalMin < 1) return "under a minute";
  if (totalMin < 60) return `${totalMin} min`;
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (hours < 24) return min ? `${hours} h ${min} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export function formatAge(ms: number): string {
  return Math.floor(ms / 60_000) < 1 ? "just now" : `${formatDuration(ms)} ago`;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** Spelled-out age for prose, e.g. "7 minutes ago", "2 hours 5 minutes ago". */
export function formatAgeLong(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return "just now";
  if (totalMin < 60) return `${plural(totalMin, "minute")} ago`;
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (hours < 24) return `${plural(hours, "hour")}${min ? ` ${plural(min, "minute")}` : ""} ago`;
  return `${plural(Math.floor(hours / 24), "day")} ago`;
}

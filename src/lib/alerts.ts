import { SETTINGS } from "../config/sensors";

export type AlertSeverity = "extreme" | "severe" | "moderate" | "minor" | "unknown";

export interface WeatherAlert {
  id: string;
  event: string;
  severity: AlertSeverity;
  /** When the hazard begins (onset, falling back to effective). */
  start: Date | null;
  /** When the hazard ends (ends, falling back to expires). */
  end: Date | null;
  description: string;
  instruction: string | null;
  areas: string | null;
  sender: string | null;
}

interface RawAlert {
  id?: string;
  properties?: {
    id?: string;
    event?: string;
    severity?: string;
    status?: string;
    messageType?: string;
    onset?: string | null;
    effective?: string | null;
    ends?: string | null;
    expires?: string | null;
    description?: string | null;
    instruction?: string | null;
    areaDesc?: string | null;
    senderName?: string | null;
  };
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { extreme: 0, severe: 1, moderate: 2, minor: 3, unknown: 4 };

function toDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toSeverity(v: string | undefined): AlertSeverity {
  const k = (v ?? "").toLowerCase();
  return k === "extreme" || k === "severe" || k === "moderate" || k === "minor" ? k : "unknown";
}

async function fetchForPoint(lat: number, lng: number): Promise<RawAlert[]> {
  // Comma kept literal; status=actual leaves out test and exercise messages.
  const url = `${SETTINGS.alertsApi}/alerts/active?point=${lat.toFixed(4)},${lng.toFixed(4)}&status=actual`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`NWS API returned HTTP ${res.status}`);
  const body = (await res.json()) as { features?: RawAlert[] };
  return body.features ?? [];
}

/**
 * Active alerts for every configured point, merged and de-duplicated by id,
 * most severe first. Throws only if every point failed.
 */
export async function fetchWeatherAlerts(now: Date = new Date()): Promise<WeatherAlert[]> {
  const results = await Promise.allSettled(SETTINGS.alertPoints.map(([lat, lng]) => fetchForPoint(lat, lng)));
  if (results.every((r) => r.status === "rejected")) {
    throw (results[0] as PromiseRejectedResult).reason;
  }
  for (const r of results) if (r.status === "rejected") console.error("Weather alert lookup failed", r.reason);

  const byId = new Map<string, WeatherAlert>();
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const feature of r.value) {
      const p = feature.properties;
      if (!p?.event) continue;
      if (p.status && p.status.toLowerCase() !== "actual") continue;
      if (p.messageType && p.messageType.toLowerCase() === "cancel") continue;
      if (SETTINGS.ignoredAlertEvents.includes(p.event)) continue;

      const end = toDate(p.ends) ?? toDate(p.expires);
      if (end && end.getTime() <= now.getTime()) continue; // already over

      const id = feature.id ?? p.id ?? `${p.event}|${p.ends ?? p.expires ?? ""}|${p.areaDesc ?? ""}`;
      if (byId.has(id)) continue;
      byId.set(id, {
        id,
        event: p.event,
        severity: toSeverity(p.severity),
        start: toDate(p.onset) ?? toDate(p.effective),
        end,
        description: (p.description ?? "").trim(),
        instruction: p.instruction?.trim() || null,
        areas: p.areaDesc?.trim() || null,
        sender: p.senderName?.trim() || null,
      });
    }
  }

  return [...byId.values()].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0),
  );
}

/** "9 PM Friday", "9:30 PM Friday", or "Saturday, Oct 10, 9 PM" when more than a week out. */
export function formatAlertTime(d: Date, now: Date, timeZone: string): string {
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d)) {
    parts[p.type] = p.value;
  }
  const time = `${parts.hour}${parts.minute !== "00" ? `:${parts.minute}` : ""} ${parts.dayPeriod}`;
  const farOut = d.getTime() - now.getTime() > 6 * 86_400_000;
  return farOut ? `${parts.weekday}, ${parts.month} ${parts.day}, ${time}` : `${time} ${parts.weekday}`;
}

/** e.g. "Flash Flood Watch in effect until 9 PM Friday" */
export function describeAlertWindow(alert: WeatherAlert, now: Date, timeZone: string): string {
  const t = (d: Date) => formatAlertTime(d, now, timeZone);
  const notStarted = alert.start !== null && alert.start.getTime() - now.getTime() > 5 * 60_000;
  if (notStarted && alert.end) return `${alert.event} from ${t(alert.start!)} until ${t(alert.end)}`;
  if (notStarted) return `${alert.event} from ${t(alert.start!)}`;
  if (alert.end) return `${alert.event} in effect until ${t(alert.end)}`;
  return `${alert.event} in effect`;
}

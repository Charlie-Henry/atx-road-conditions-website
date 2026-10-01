import { SETTINGS } from "../config/sensors";
import { parseFloatingTimestamp } from "./freshness";
import { num, parseLocation, type RawPoint } from "./geo";
import { sodaFetchJson, sodaUrl } from "./soda";

export interface Incident {
  id: string;
  issue: string;
  address: string | null;
  lat: number;
  lng: number;
  reportedAt: Date | null;
  agency: string | null;
}

interface RawIncident {
  traffic_report_id?: string;
  published_date?: string;
  issue_reported?: string;
  address?: string;
  agency?: string;
  latitude?: string | number;
  longitude?: string | number;
  location?: RawPoint;
  traffic_report_status?: string;
}

/** Abbreviations that appear in the feed's issue text. */
const EXPANSIONS: Array<[RegExp, string]> = [
  [/\bTRFC\b/gi, "Traffic"],
  [/\bHAZD\b/gi, "hazard"],
];

/**
 * The feed mixes "Crash Urgent" with "COLLISION WITH INJURY" and "TRFC HAZD/ DEBRIS".
 * Expand known abbreviations, tidy slashes, and sentence-case the shouting ones.
 */
function tidy(text: string): string {
  let t = text.trim().replace(/\s+/g, " ").replace(/\s*\/\s*/g, " / ");
  // Decide "shouting" before expanding abbreviations, which adds lowercase letters.
  if (t === t.toUpperCase()) t = t.toLowerCase();
  for (const [pattern, replacement] of EXPANSIONS) t = t.replace(pattern, replacement);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Fetch currently active traffic incidents. The status filter runs on the
 * server (traffic_report_status='ACTIVE') and is re-checked here so nothing
 * archived can slip onto the map. No $select or $order is sent, so a renamed
 * column can't turn the whole request into an HTTP 400; sorting is done here.
 */
export async function fetchActiveIncidents(): Promise<Incident[]> {
  const url = sodaUrl(SETTINGS.incidentsDatasetId, {
    $where: `traffic_report_status='${SETTINGS.incidentStatus}'`,
    $limit: String(SETTINGS.maxIncidents),
  });
  const rows = await sodaFetchJson<RawIncident[]>(url);
  const incidents: Incident[] = [];

  for (const row of rows) {
    if (row.traffic_report_status !== SETTINGS.incidentStatus) continue;

    const fromLocation = parseLocation(row.location);
    const lat = num(row.latitude) ?? fromLocation.lat;
    const lng = num(row.longitude) ?? fromLocation.lng;
    if (lat === null || lng === null) continue;

    let reportedAt: Date | null = null;
    if (row.published_date) {
      const d = parseFloatingTimestamp(row.published_date, SETTINGS.timestampTimeZone);
      if (!Number.isNaN(d.getTime())) reportedAt = d;
    }

    const issue = row.issue_reported ? tidy(row.issue_reported) : "Traffic incident";
    incidents.push({
      id: row.traffic_report_id ?? `${issue}|${lat}|${lng}|${row.published_date ?? ""}`,
      issue,
      address: row.address ? row.address.trim() : null,
      lat,
      lng,
      reportedAt,
      agency: row.agency ? row.agency.trim() : null,
    });
  }

  // Newest first
  incidents.sort((a, b) => (b.reportedAt?.getTime() ?? 0) - (a.reportedAt?.getTime() ?? 0));
  return incidents;
}

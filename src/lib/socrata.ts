import { SETTINGS } from "../config/sensors";
import { parseFloatingTimestamp } from "./freshness";
import { num, parseLocation, type RawPoint } from "./geo";
import { sodaUrl } from "./soda";

export interface Reading {
  sensorId: number;
  locationName: string | null;
  lat: number | null;
  lng: number | null;
  observedAt: Date;
  /** condition_text_displayed, e.g. "WT2" */
  conditionCode: string;
  /** condition_text_measured, the raw (unfiltered) value */
  measuredCode: string | null;
  surfaceTempC: number | null;
  airTempC: number | null;
  humidity: number | null;
  grip: string | null;
}

interface RawRow {
  location_name?: string;
  location?: RawPoint;
  timestamp?: string;
  temp_surface?: string;
  air_temp_primary?: string;
  relative_humidity?: string;
  condition_text_displayed?: string;
  condition_text_measured?: string;
  grip_text?: string;
}

const FIELDS = [
  "location_name",
  "location",
  "timestamp",
  "temp_surface",
  "air_temp_primary",
  "relative_humidity",
  "condition_text_displayed",
  "condition_text_measured",
  "grip_text",
].join(",");

/** The dataset reports 100.1 to signal a temperature error. */
const TEMP_ERROR_VALUE = 100.1;

function temp(v: unknown): number | null {
  const n = num(v);
  return n === null || Math.abs(n - TEMP_ERROR_VALUE) < 0.05 ? null : n;
}

/**
 * The dataset is a history table (one row per reading), so the latest
 * reading for a sensor is the first row when sorted by timestamp descending.
 * Returns null if the sensor has no rows.
 */
export async function fetchLatestReading(sensorId: number): Promise<Reading | null> {
  const url = sodaUrl(SETTINGS.datasetId, {
    $select: FIELDS,
    $where: `sensor_id=${sensorId}`,
    $order: "timestamp DESC",
    $limit: "1",
  });
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Socrata returned HTTP ${res.status}`);

  const rows = (await res.json()) as RawRow[];
  const row = rows[0];
  if (!row?.timestamp) return null;

  const observedAt = parseFloatingTimestamp(row.timestamp, SETTINGS.timestampTimeZone);
  if (Number.isNaN(observedAt.getTime())) throw new Error(`Unparseable timestamp: ${row.timestamp}`);

  const { lat, lng } = parseLocation(row.location);
  return {
    sensorId,
    locationName: row.location_name ?? null,
    lat,
    lng,
    observedAt,
    conditionCode: row.condition_text_displayed ?? "UNK",
    measuredCode: row.condition_text_measured ?? null,
    surfaceTempC: temp(row.temp_surface),
    airTempC: temp(row.air_temp_primary),
    humidity: num(row.relative_humidity),
    grip: row.grip_text ?? null,
  };
}

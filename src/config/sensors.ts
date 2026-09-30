/**
 * Sensors to show, plus site-wide settings.
 * Edit this file directly; there are no CLI flags or env vars for these.
 */

export interface SensorConfig {
  /** sensor_id in the Real-Time Road Conditions dataset (ypbq-i42h) */
  id: string;
  name: string;
  /** Public CCTV snapshot for a camera near the sensor */
  cctvUrl: string;
  /** Optional fallback position, used only if the dataset row has no location */
  lat?: number;
  lng?: number;
}

export const SENSORS: SensorConfig[] = [
  {
    id: "2",
    name: "FM 2222 at Lakewood Drive",
    cctvUrl: "https://cctv.austinmobility.io/image/1531.jpg",
  },
  {
    id: "3",
    name: "Lakeline Boulevard at US-183",
    cctvUrl: "https://cctv.austinmobility.io/image/1013.jpg",
  },
  {
    id: "4",
    name: "Ben White Boulevard at Banister Lane",
    cctvUrl: "https://cctv.austinmobility.io/image/962.jpg",
  },
];

export const SETTINGS = {
  domain: "data.austintexas.gov",
  datasetId: "ypbq-i42h",

  /** Real-Time Traffic Incident Reports dataset. Only rows with this status are shown. */
  incidentsDatasetId: "dx9v-zd7x",
  incidentStatus: "ACTIVE",
  /** SODA returns at most this many rows per request. Far more than Austin has active at once. */
  maxIncidents: 1000,
  showIncidentsByDefault: true,

  /**
   * National Weather Service alerts (api.weather.gov: free, no key). Each point
   * is queried and the results are merged, so watches and warnings that cover
   * any of them appear. Add a point (e.g. San Marcos) to widen the area.
   */
  alertsApi: "https://api.weather.gov",
  alertPoints: [
    [30.2672, -97.7431], // Austin
    [30.5083, -97.6789], // Round Rock
  ] as Array<[number, number]>,
  /** At most this many alerts show at once; the rest sit behind a "Show more" button. */
  maxAlertsShown: 3,
  /** Exact NWS event names to leave out, e.g. ["Air Quality Alert"]. */
  ignoredAlertEvents: [] as string[],

  /** A reading older than this is flagged as outdated. */
  staleAfterHours: 4,

  /** How often the page re-queries the open data portal. The dataset itself updates every 5 minutes. */
  refreshMinutes: 5,

  /**
   * The dataset's `timestamp` column is a "floating" timestamp with no
   * timezone or offset. This is the zone its wall-clock values are in.
   * It drives the 4-hour staleness check, so verify it (see README).
   * If every sensor shows "Outdated" (or the page warns about timestamps in
   * the future), this value is wrong. Try "UTC".
   */
  timestampTimeZone: "America/Chicago",

  /** Zone used when showing times to visitors. */
  displayTimeZone: "America/Chicago",

  /**
   * Camera snapshots get a shared time-bucket query string (?t=...) so every
   * visitor in the same window requests the same URL, which keeps CDN cache
   * hits high on the camera host. Set to 0 to request the bare URL instead.
   */
  cctvCacheBustMinutes: 5,

  /**
   * Basemap tiles. The default is OpenStreetMap's public tile server: free, no
   * key, but meant for light use (see https://operations.osmfoundation.org/policies/tiles/).
   * If traffic grows, swap in another provider's URL and attribution here.
   */
  tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  tileAttribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  tileMaxZoom: 19,

  mapCenter: [30.3, -97.75] as [number, number],
  mapZoom: 11,
};

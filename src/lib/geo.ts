export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface RawPoint {
  latitude?: string | number;
  longitude?: string | number;
  coordinates?: [number, number];
}

/** Socrata point columns come back as {latitude, longitude} strings, or GeoJSON-style coordinates. */
export function parseLocation(loc: RawPoint | undefined): { lat: number | null; lng: number | null } {
  if (!loc) return { lat: null, lng: null };
  if (Array.isArray(loc.coordinates)) {
    return { lat: num(loc.coordinates[1]), lng: num(loc.coordinates[0]) };
  }
  return { lat: num(loc.latitude), lng: num(loc.longitude) };
}

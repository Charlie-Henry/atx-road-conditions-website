import { SETTINGS } from "../config/sensors";

/** Build a SODA API URL for a dataset on the configured Socrata domain. */
export function sodaUrl(datasetId: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params);
  const token = import.meta.env?.PUBLIC_SOCRATA_APP_TOKEN;
  if (token) query.set("$$app_token", token);
  return `https://${SETTINGS.domain}/resource/${datasetId}.json?${query}`;
}

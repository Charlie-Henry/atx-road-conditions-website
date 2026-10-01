import { SETTINGS } from "../config/sensors";

/** Build a SODA API URL for a dataset on the configured Socrata domain. */
export function sodaUrl(datasetId: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params);
  const token = import.meta.env?.PUBLIC_SOCRATA_APP_TOKEN;
  if (token) query.set("$$app_token", token);
  return `https://${SETTINGS.domain}/resource/${datasetId}.json?${query}`;
}

export type PortalFailure = "timeout" | "network" | "http" | "response";

/** Each request gets one attempt, and gives up after this long. */
const REQUEST_TIMEOUT_MS = 30_000;

/** A failed portal request, with a plain-language description for the UI. */
export class PortalError extends Error {
  constructor(
    message: string,
    readonly kind: PortalFailure,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PortalError";
  }

  get userMessage(): string {
    switch (this.kind) {
      case "timeout":
        return "The open data portal took too long to respond.";
      case "network":
        return "Couldn't reach the open data portal.";
      case "response":
        return "The open data portal sent a response that couldn't be read.";
      default:
        if (this.status === 429) return "The open data portal is limiting requests right now.";
        if (this.status !== undefined && this.status >= 500) {
          return `The open data portal had a problem (HTTP ${this.status}).`;
        }
        return `The open data portal rejected the request (HTTP ${this.status}).`;
    }
  }
}

function classify(e: unknown): PortalError {
  if (e instanceof PortalError) return e;
  if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) {
    return new PortalError("Request timed out", "timeout");
  }
  if (e instanceof SyntaxError) return new PortalError("Unreadable JSON", "response");
  return new PortalError(e instanceof Error ? e.message : "Network error", "network");
}

/** GET a SODA URL and parse the JSON. One attempt; throws a PortalError if it fails. */
export async function sodaFetchJson<T>(url: string): Promise<T> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) throw new PortalError(`HTTP ${res.status}`, "http", res.status);
    return (await res.json()) as T;
  } catch (e) {
    throw classify(e);
  }
}

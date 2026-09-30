export type Severity = "ok" | "damp" | "wet" | "flood" | "snow" | "ice" | "unknown";

export interface ConditionInfo {
  code: string;
  label: string;
  severity: Severity;
}

// Mnemonics from the sensor manual:
// https://github.com/cityofaustin/atd-road-conditions/blob/production/5433-3X-manual.pdf
const CONDITIONS: Record<string, { label: string; severity: Severity }> = {
  UNK: { label: "Unknown", severity: "unknown" },
  DRY: { label: "Dry", severity: "ok" },
  WT1: { label: "Damp", severity: "damp" },
  WT2: { label: "Wet", severity: "wet" },
  WT3: { label: "Standing water", severity: "flood" },
  SN1: { label: "Snow", severity: "snow" },
  SN2: { label: "Deep snow", severity: "snow" },
  IC1: { label: "Ice", severity: "ice" },
  IC2: { label: "Black ice", severity: "ice" },
  MAX: { label: "Sensor error", severity: "unknown" },
  ERR: { label: "Sensor error", severity: "unknown" },
};

export function describeCondition(code: string | null | undefined): ConditionInfo {
  const key = (code ?? "").trim().toUpperCase();
  const hit = CONDITIONS[key];
  if (hit) return { code: key, ...hit };
  return { code: key || "UNK", label: "Unknown", severity: "unknown" };
}

export type GripLevel = "good" | "fair" | "poor" | "other";

export interface GripInfo {
  level: GripLevel;
  label: string;
}

/** grip_text is documented as GOOD, FAIR or POOR. Anything else is kept but not highlighted. */
export function describeGrip(text: string | null | undefined): GripInfo | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  const key = t.toUpperCase();
  const level: GripLevel = key === "GOOD" ? "good" : key === "FAIR" ? "fair" : key === "POOR" ? "poor" : "other";
  return { level, label: t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() };
}

/** Text for the grip tag. Poor grip gets a warning symbol. */
export function gripTagText(grip: GripInfo): string {
  return grip.level === "poor" ? `\u26A0\uFE0F Grip: ${grip.label}` : `Grip: ${grip.label}`;
}

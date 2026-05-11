import type {
  PolicyBootstrapMeta,
  PolicyConfigV1,
  PolicyContractBundleV1,
  PolicyOverridesV1,
} from "./config-v1.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function pickString(o: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.length > 0) {
      return v;
    }
  }
  return undefined;
}

function pickStringArray(o: Record<string, unknown>, ...keys: string[]): string[] | undefined {
  for (const k of keys) {
    const v = o[k];
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      return [...v];
    }
  }
  return undefined;
}

function extractBootstrap(raw: unknown): PolicyBootstrapMeta | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const b = raw.bootstrap;
  if (!isRecord(b)) {
    return undefined;
  }
  return {
    phase: pickString(b, "phase"),
    status: pickString(b, "status"),
    completedPhases: pickStringArray(b, "completedPhases", "completed_phases"),
    placeholder: typeof b.placeholder === "boolean" ? b.placeholder : undefined,
    enforcedToday: typeof b.enforcedToday === "boolean" || typeof b.enforced_today === "boolean"
      ? Boolean(b.enforcedToday ?? b.enforced_today)
      : undefined,
    currentFocus: pickString(b, "currentFocus", "current_focus"),
    note: pickString(b, "note"),
  };
}

function extractBundle(o: Record<string, unknown>): PolicyContractBundleV1 {
  const raw = o.contractBundle ?? o.contract_bundle;
  if (!isRecord(raw)) {
    return { kind: "rego", telemetryGates: [] };
  }
  const kind = pickString(raw, "kind") ?? "rego";
  const tg = raw.telemetryGates ?? raw.telemetry_gates;
  const telemetryGates = Array.isArray(tg)
    ? tg.filter((x): x is string => typeof x === "string")
    : [];
  return { kind, telemetryGates };
}

function extractCommands(o: Record<string, unknown>): Record<string, string> {
  const raw = o.commands;
  if (!isRecord(raw)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") {
      out[k] = v;
    }
  }
  return out;
}

function extractOverrides(o: Record<string, unknown>): PolicyOverridesV1 {
  const raw = o.overrides;
  if (!isRecord(raw)) {
    return { gates: {}, gatesOnFailure: {}, commands: { hooks: {} } };
  }
  const gates = isRecord(raw.gates) ? { ...raw.gates } : {};
  const gof = raw.gatesOnFailure ?? raw.gates_on_failure;
  const gatesOnFailure = isRecord(gof) ? { ...gof } : {};
  const ch = raw.commands;
  const hooks =
    isRecord(ch) && isRecord(ch.hooks) ? { ...ch.hooks } : {};
  return { gates, gatesOnFailure, commands: { hooks } };
}

function asV1Already(raw: unknown): PolicyConfigV1 | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (raw.schemaVersion !== 1) {
    return null;
  }
  const riskTier = pickString(raw, "riskTier", "risk_tier") ?? "medium";
  const thresholdPolicy =
    pickString(raw, "thresholdPolicy", "threshold_policy") ?? "defaults.medium";
  return {
    schemaVersion: 1,
    projectRoot: pickString(raw, "projectRoot", "project_root") ?? ".",
    bootstrap: extractBootstrap(raw),
    riskTier,
    thresholdPolicy,
    contractBundle: extractBundle(raw),
    commands: extractCommands(raw),
    overrides: extractOverrides(raw),
  };
}

/**
 * Returns a version-1 policy document. The system MUST NOT write files; callers
 * persist after review (for example via `tess upgrade --apply`).
 */
export function upgradePolicyTree(raw: unknown): PolicyConfigV1 {
  const existing = asV1Already(raw);
  if (existing) {
    return existing;
  }
  if (!isRecord(raw)) {
    return {
      schemaVersion: 1,
      projectRoot: ".",
      riskTier: "medium",
      thresholdPolicy: "defaults.medium",
      contractBundle: { kind: "rego", telemetryGates: [] },
      commands: {},
      overrides: { gates: {}, gatesOnFailure: {}, commands: { hooks: {} } },
    };
  }
  return {
    schemaVersion: 1,
    projectRoot: pickString(raw, "projectRoot", "project_root") ?? ".",
    bootstrap: extractBootstrap(raw),
    riskTier: pickString(raw, "riskTier", "risk_tier") ?? "medium",
    thresholdPolicy:
      pickString(raw, "thresholdPolicy", "threshold_policy") ?? "defaults.medium",
    contractBundle: extractBundle(raw),
    commands: extractCommands(raw),
    overrides: extractOverrides(raw),
  };
}

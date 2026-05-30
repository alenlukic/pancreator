/**
 * Canonical threshold-policy document shape for `pan upgrade --apply` consumers.
 * Version 1 aligns loosely with `pancreator.yaml` / `pancreator-defaults.yaml` keys.
 */
export interface PolicyBootstrapMeta {
  phase?: string;
  status?: string;
  completedPhases?: string[];
  placeholder?: boolean;
  enforcedToday?: boolean;
  currentFocus?: string;
  note?: string;
}

export interface PolicyContractBundleV1 {
  kind: string;
  telemetryGates: string[];
}

export interface PolicyOverridesV1 {
  gates: Record<string, unknown>;
  gatesOnFailure: Record<string, unknown>;
  commands: { hooks: Record<string, unknown> };
}

export interface PolicyConfigV1 {
  schemaVersion: 1;
  /**
   * Absolute path or path relative to the directory containing pancreator.yaml.
   * The special value `.` means the harness is embedded in the repo root.
   */
  projectRoot: string;
  bootstrap?: PolicyBootstrapMeta;
  riskTier: string;
  thresholdPolicy: string;
  contractBundle: PolicyContractBundleV1;
  commands: Record<string, string>;
  overrides: PolicyOverridesV1;
}

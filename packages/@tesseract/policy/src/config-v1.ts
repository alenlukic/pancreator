/**
 * Canonical threshold-policy document shape for `tess upgrade --apply` consumers.
 * Version 1 aligns loosely with `tesseract.yaml` / `tesseract-defaults.yaml` keys.
 */
export interface PolicyBootstrapMeta {
  phase?: string;
  placeholder?: boolean;
  enforcedToday?: boolean;
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
  bootstrap?: PolicyBootstrapMeta;
  riskTier: string;
  thresholdPolicy: string;
  contractBundle: PolicyContractBundleV1;
  commands: Record<string, string>;
  overrides: PolicyOverridesV1;
}

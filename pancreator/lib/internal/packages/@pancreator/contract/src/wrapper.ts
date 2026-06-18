import type { ContentHash } from "@pancreator/core";

import type { ContractKind, ContractSeverity } from "./kinds.js";

/**
 * Citation to a file range with a content hash, matching the dual-anchor shape in the handbook.
 */
export type ReferenceLines = {
  kind: "lines";
  path: string;
  range: readonly [startLine: number, endLine: number];
  contentHash: ContentHash;
  note: string;
};

/**
 * Citation to a code symbol, matching the dual-anchor shape in the handbook.
 */
export type ReferenceSymbol = {
  kind: "symbol";
  path: string;
  symbol: string;
  contentHash: ContentHash;
  note: string;
};

/**
 * A dual-anchor reference in a contract wrapper `references` array.
 */
export type Reference = ReferenceLines | ReferenceSymbol;

/**
 * Discriminant for `applies_to` in the kind-agnostic wrapper schema.
 */
export type AppliesToKind =
  | "artifact-symbol"
  | "pipeline-telemetry"
  | "file-path"
  | "run-log-event"
  | "pancreator-config";

/**
 * Common fields for a wrapper `applies_to` object.
 */
export type AppliesToBase = {
  kind: AppliesToKind;
};

/**
 * `applies_to` when the gate targets a symbol inside a file.
 */
export type AppliesToArtifactSymbol = AppliesToBase & {
  kind: "artifact-symbol";
  path: string;
  symbol: string;
  contentHash: ContentHash;
};

/**
 * `applies_to` when the gate targets a glob of repo files.
 */
export type AppliesToFilePath = AppliesToBase & {
  kind: "file-path";
  glob: string;
};

/**
 * `applies_to` union; extend in later bootstrap slices when the runner gains coverage.
 */
export type AppliesTo = AppliesToArtifactSymbol | AppliesToFilePath;

/**
 * A contract wrapper clause, matching the shape in `/lib/memory/handbook/contract-format.md` §1.
 * Runners narrow `runtime` per `kind` at dispatch time.
 */
export type ContractClause = {
  id: string;
  kind: ContractKind;
  severity: ContractSeverity;
  applies_to: AppliesTo;
  owner: string;
  description: string;
  references: readonly Reference[];
  spec?: string;
  module?: string;
  runtime: Record<string, unknown>;
  metadata: Record<string, string | number | boolean>;
};

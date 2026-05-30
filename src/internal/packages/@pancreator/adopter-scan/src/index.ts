/**
 * @packageDocumentation
 * Presence-only adoption scan for existing repositories (US-9).
 */
import { PANCREATOR_CORE_VERSION } from "@pancreator/core";

export const PANCREATOR_ADOPTER_SCAN_VERSION = "0.0.0" as const;

/** @deprecated Prefer `PANCREATOR_ADOPTER_SCAN_VERSION`. */
export const PANCREATOR_ADOPTER_SCAN_STUB = "adopter-scan" as const;

/** @deprecated Prefer `PANCREATOR_ADOPTER_SCAN_VERSION`. */
export function adopterScanStubVersion(): string {
  return PANCREATOR_CORE_VERSION;
}

export type {
  AdoptionCiSignal,
  AdoptionLanguageSignal,
  AdoptionScanReport,
  AdoptionTestFrameworkSignal,
  AdoptionWorkspaceTooling,
} from "./report.js";
export { scanRepository } from "./scan.js";

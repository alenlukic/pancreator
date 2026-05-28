/**
 * @packageDocumentation
 * Presence-only adoption scan for existing repositories (US-9).
 */
import { DAEDALINE_CORE_VERSION } from "@daedaline/core";

export const DAEDALINE_ADOPTER_SCAN_VERSION = "0.0.0" as const;

/** @deprecated Prefer `DAEDALINE_ADOPTER_SCAN_VERSION`. */
export const DAEDALINE_ADOPTER_SCAN_STUB = "adopter-scan" as const;

/** @deprecated Prefer `DAEDALINE_ADOPTER_SCAN_VERSION`. */
export function adopterScanStubVersion(): string {
  return DAEDALINE_CORE_VERSION;
}

export type {
  AdoptionCiSignal,
  AdoptionLanguageSignal,
  AdoptionScanReport,
  AdoptionTestFrameworkSignal,
  AdoptionWorkspaceTooling,
} from "./report.js";
export { scanRepository } from "./scan.js";

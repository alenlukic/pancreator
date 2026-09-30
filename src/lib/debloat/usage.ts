/**
 * Facility usage evidence over a window of days.
 *
 * This file is a re-export facade. The implementation lives in the modules
 * under `usage/`; new source importers should import the specific module.
 */

export type {
  EvidenceTier,
  FacilityUsage,
  UsageScanSources,
  UsageScan,
  UsageScanOptions,
} from './usage/model.js'
export { scanUsage } from './usage/scan.js'
export { defaultTranscriptsRoot } from './usage/transcripts.js'

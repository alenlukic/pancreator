/** Compatibility exports for callers inspecting legacy verifier receipts. Release execution never consumes these receipts. */
export {
  collectReleaseEvidence,
  readReleaseEvidence,
} from '../verification-evidence/legacy-receipt.js'
export type { ReleaseEvidenceBundle } from '../verification-evidence/legacy-receipt.js'

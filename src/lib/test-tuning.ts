/**
 * Harness test tuning: session state, inventories, partitions, and records.
 *
 * Tune records live under runtime/tune-harness/, outside runtime/logs/, so
 * pan archive does not move them.
 *
 * This file is a re-export facade. The implementation lives in the modules
 * under `test-tuning/`; new source importers should import the specific module.
 */

export {
  TUNE_ROOT,
  TUNE_WORK_DIR,
  TUNE_RECORDS_DIR,
  TUNE_REPORTS_DIR,
  TUNE_LATEST_PATH,
  TUNE_PASSES_FILE,
  TUNE_VERDICTS_FILE,
  TUNE_JUDGMENT_PROVENANCE_FILE,
  TUNE_FAST_PROFILE_FILE,
  TUNE_SECONDARY_PROFILE_FILE,
  identityKey,
  partitionRetainedSet,
  intervalsOverlap,
  validatePassOverlap,
  tuneSessionWorkDir,
  loadLatestRecord,
} from './test-tuning/record.js'
export type {
  TuneVerdict,
  TestIdentity,
  PassInterval,
  TuneRecord,
} from './test-tuning/record.js'
export {
  assertSelfDevelopment,
  collectCurrentInventory,
  collectBaselineInventory,
  prepareTuneSession,
  loadPreparedSession,
} from './test-tuning/inventory.js'
export type {
  PrepareTuneSessionOptions,
  PreparedTuneSession,
} from './test-tuning/inventory.js'
export {
  buildBenchmarkFromProfiles,
  finalizeTuneSession,
  finalizePreparedTuneSession,
} from './test-tuning/finalize.js'
export type {
  FinalizeTuneSessionInput,
  FinalizeTuneSessionResult,
} from './test-tuning/finalize.js'
export { validateTuneRecordShape } from './test-tuning/shape.js'
export {
  BENCHMARK_SESSION_ROOT,
  buildBenchmarkSessionRecord,
  runBenchmarkSession,
} from './test-tuning/benchmark.js'
export type {
  BenchmarkSample,
  BenchmarkCapture,
  BenchmarkSessionRecord,
} from './test-tuning/benchmark.js'
export { validateAudit } from './test-tuning/audit.js'
export type {
  AuditRow,
  ValidateAuditOptions,
  ValidateAuditResult,
} from './test-tuning/audit.js'

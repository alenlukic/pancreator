/**
 * Multi-instance Cursor spend sync and report.
 *
 * `syncSpend` collects this instance's attributed spend records, merges them
 * into a local ledger at `runtime/spend/ledger.json`, and uploads the ledger
 * as a gzip snapshot to the configured Vercel service.
 *
 * `reportMultiInstanceSpend` downloads every instance's latest snapshot from
 * the service, deduplicates events by key, and aggregates the combined set
 * using the same computation as the local spend report.
 *
 * No raw Cursor identifier (conversation id, cloud agent id, automation id,
 * email, or credential) leaves this machine. All cross-instance correlation
 * uses SHA-256 hex keys.
 *
 * This file is a re-export facade. The implementation lives in the modules
 * under `spend-sync/`; new source importers should import the specific module.
 */

export type {
  SpendLedger,
  SpendSnapshot,
  SyncSpendResult,
  InstanceSummary,
  MultiInstanceSpendReport,
  SyncSpendOptions,
  ReportMultiInstanceSpendOptions,
} from './spend-sync/model.js'
export {
  selectSpendRecord,
  mergeLedger,
  ledgerWindow,
} from './spend-sync/ledger.js'
export {
  combineSpendSnapshots,
  reportMultiInstanceSpend,
} from './spend-sync/report.js'
export type { CombineSpendSnapshotsOptions } from './spend-sync/report.js'
export { syncSpend } from './spend-sync/sync.js'
export {
  derivedCursorFeeCents,
  parseSpendSnapshot,
} from './spend-sync/snapshot.js'
export type { ParsedSpendSnapshot } from './spend-sync/snapshot.js'

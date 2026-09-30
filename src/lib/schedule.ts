/**
 * Calendar scheduler entry point. The implementation lives in `./schedule/`,
 * one module per concern; this module re-exports its public surface so the
 * CLI and the tests keep one stable import path.
 */

export {
  mostRecentScheduleOccurrence,
  resolveScheduleConfig,
  readScheduleLedger,
  readScheduleHistory,
} from './schedule/ledger.js'
export type {
  ScheduleOutcome,
  ScheduleDecisionRecord,
  ScheduleAlert,
  ScheduleAlertFile,
  ScheduleActionResult,
  ScheduleRuntime,
} from './schedule/ledger.js'
export { parseHorizonSessionStatus } from './schedule/actions.js'
export {
  refreshScheduleAlerts,
  scheduleTick,
  runScheduledJob,
  scheduleStatus,
  validateSchedule,
  installScheduleAgent,
  uninstallScheduleAgent,
} from './schedule/tick.js'

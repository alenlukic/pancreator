/**
 * Long-horizon session entry point. The implementation lives in
 * `./horizon/`, one module per concern; this module re-exports its public
 * surface so the CLI, the scheduler, and the tests keep one stable import
 * path.
 */

export { loadHorizonSession } from './horizon/session.js'
export type {
  HorizonTaskKind,
  HorizonTaskStatus,
  HorizonTask,
  HorizonTaskRoute,
  HorizonLiveRunRole,
  HorizonLiveRun,
  HorizonRouteCommands,
  HorizonRouteProgress,
  HorizonBoundaryRecord,
  HorizonSessionState,
  HorizonQueueTaskInput,
  HorizonQueueInput,
  HorizonNextResult,
} from './horizon/session.js'
export {
  parseHorizonQueue,
  horizonCycle,
  transitiveHorizonDependents,
  eligibleHorizonTask,
} from './horizon/queue.js'
export {
  initHorizonSession,
  addHorizonTask,
  startHorizonSession,
} from './horizon/lifecycle.js'
export { nextHorizonTask } from './horizon/next.js'
export {
  resolveTaskRoute,
  routeProgress,
  horizonLiveRuns,
} from './horizon/routes.js'
export type { HorizonDeferralClassification } from './horizon/driver.js'
export {
  checkpointHorizonSession,
  reconcileHorizonSession,
} from './horizon/checkpoint.js'
export type { HorizonReconcileResult } from './horizon/checkpoint.js'
export {
  deferHorizonTask,
  reinstateHorizonTask,
  abandonHorizonSession,
} from './horizon/operator-actions.js'
export type { HorizonDeferralAuthority } from './horizon/operator-actions.js'
export { horizonStatus, latestHorizonHandoff } from './horizon/status.js'
export type { HorizonStatusView } from './horizon/status.js'

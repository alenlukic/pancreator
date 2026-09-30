/**
 * Best-of-N sessions: candidate runs from several persona configurations and
 * one consolidation run over their results.
 *
 * This file is a re-export facade. The implementation lives in the modules
 * under `best-of-n/`; new source importers should import the specific module.
 */

export {
  parseBestOfNConfigs,
  bestOfNDir,
  bestOfNMutexPath,
  loadBestOfNState,
} from './best-of-n/state.js'
export type {
  BestOfNPersonaSet,
  BestOfNConfigsFile,
  BestOfNSessionStatus,
  BestOfNPendingCandidate,
  BestOfNCandidateRecord,
  BestOfNConsolidationRecord,
  BestOfNState,
  BestOfNCandidateStatus,
  BestOfNStatus,
} from './best-of-n/state.js'
export { bestOfNStatus } from './best-of-n/session.js'
export { initBestOfN } from './best-of-n/init.js'
export type { InitBestOfNOptions } from './best-of-n/init.js'
export {
  refreshBestOfNAgents,
  abandonBestOfNCandidate,
} from './best-of-n/candidates.js'
export type { RefreshBestOfNAgentsResult } from './best-of-n/candidates.js'
export { consolidateBestOfN } from './best-of-n/consolidation.js'
export { cleanBestOfN, pruneBestOfN } from './best-of-n/cleanup.js'
export type {
  CleanBestOfNResult,
  PruneBestOfNSkip,
  PruneBestOfNResult,
} from './best-of-n/cleanup.js'

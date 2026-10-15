/**
 * `pan release land` coordinates integration, allocates a version,
 * constructs metadata, finalizes the commit pair, and fast-forwards pan-dev.
 * It neither runs checks nor consumes verification evidence.
 *
 * All operations run while the caller holds the landing mutex, so two
 * concurrent landings receive distinct versions and one serialized path to
 * pan-dev.
 *
 * The implementation lives in `./release-landing/`, one module per concern;
 * this module re-exports its public surface so the CLI and the tests keep one
 * stable import path.
 */

export {
  VERIFIED_TREE_LAND_PROFILES,
  predictMergeConflicts,
} from './release-landing/steps.js'
export type {
  LandingStatus,
  LandingStepName,
  LandingStep,
  LandingResult,
  LandingRepair,
  LandReleaseOptions,
  LandingVerification,
  TipIntegration,
} from './release-landing/steps.js'
export { landRelease } from './release-landing/land.js'
export {
  buildLandingTree,
  landingBuildIsCurrent,
  resolveLandingVerification,
  integrateTip,
  runLandingCheck,
} from './release-landing/verification.js'

/** Export integration helpers for chunk-b-daily-quality. */
export {
  fastForwardPanDev as fastForwardIntegration,
  METADATA_PATHS,
} from './release-landing/steps.js'

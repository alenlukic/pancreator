/**
 * The step sequence behind an injected bridge interface. The bridge handles
 * all Accessibility API calls; this module owns sequence, timing, error codes,
 * frontmost sampling, and the 30-second deadline.
 *
 * The driver never activates an application, opens a URL, posts key events,
 * or calls AppleScript.
 *
 * The implementation lives in `./driver/`, one module per concern; this module
 * re-exports its public surface so the CLI and the tests keep one stable
 * import path.
 */

export type {
  BridgePreflight,
  BridgeSnapshot,
  Bridge,
  HandoffStatus,
  StepRecord,
  HandoffResult,
  PreSendContext,
  PreSendOutcome,
  DriverOptions,
} from './driver/bridge.js'
export { selfCheck, runHandoffDriver } from './driver/run.js'
export type { SelfCheckResult } from './driver/run.js'

/**
 * @packageDocumentation
 * Intervention journal and LangGraph-shaped control primitives for pause, resume, abort, and goto.
 */
import { TESSERACT_CORE_VERSION } from "@tesseract/core";

export const TESSERACT_INTERVENTION_VERSION = "0.0.0" as const;

export type { CheckpointId } from "./checkpoint-id.js";
export {
  InvalidTaskIdForJournalError,
  InterventionJournalPathError,
  MalformedJournalLineError,
} from "./errors.js";
export {
  commandGoto,
  interruptSignal,
  timeTravelTo,
  type LangGraphCommandGoto,
  type LangGraphInterruptSignal,
  type LangGraphTimeTravel,
} from "./langgraph-shapes.js";
export type { InterventionCheckpointPort } from "./checkpoint-port.js";
export { InterventionManager } from "./manager.js";
export {
  assertJournalPathInScheduler,
  assertSafeTaskIdForPath,
  defaultInterventionsDir,
  interventionJournalPath,
} from "./paths.js";
export { loadActiveState, reduceJournalToState } from "./state.js";
export {
  FsInterventionStore,
  InMemoryInterventionStore,
  type InterventionStore,
} from "./store.js";
export type {
  InterventionCommand,
  InterventionRecord,
  InterventionState,
} from "./types.js";

/** @deprecated Prefer `TESSERACT_INTERVENTION_VERSION`. */
export const TESSERACT_INTERVENTION_STUB = "intervention" as const;

/** @deprecated Prefer `TESSERACT_INTERVENTION_VERSION`. */
export function interventionStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}

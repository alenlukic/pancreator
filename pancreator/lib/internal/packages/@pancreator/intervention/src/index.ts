/**
 * @packageDocumentation
 * Intervention journal and LangGraph-shaped control primitives for pause, resume, abort, and goto.
 */
import { PANCREATOR_CORE_VERSION } from "@pancreator/core";

export const PANCREATOR_INTERVENTION_VERSION = "0.0.0" as const;

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

/** @deprecated Prefer `PANCREATOR_INTERVENTION_VERSION`. */
export const PANCREATOR_INTERVENTION_STUB = "intervention" as const;

/** @deprecated Prefer `PANCREATOR_INTERVENTION_VERSION`. */
export function interventionStubVersion(): string {
  return PANCREATOR_CORE_VERSION;
}

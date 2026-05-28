import type { InterventionRecord, InterventionState } from "./types.js";
import type { InterventionStore } from "./store.js";
import type { TaskId } from "@daedaline/core";

/** Reduces an append-only intervention journal to the current lifecycle state. */
export function reduceJournalToState(records: readonly InterventionRecord[]): InterventionState {
  if (records.length === 0) {
    return "running";
  }
  const last = records[records.length - 1]!;
  switch (last.command) {
    case "abort":
      return "aborted";
    case "pause":
      return "paused";
    case "resume":
    case "goto":
      return "resumed";
    default: {
      const _exhaustive: never = last.command;
      return _exhaustive;
    }
  }
}

/** Loads the journal from `store` and returns the derived `InterventionState`. */
export async function loadActiveState(
  store: InterventionStore,
  taskId: TaskId,
): Promise<InterventionState> {
  const journal = await store.readJournal(taskId);
  return reduceJournalToState(journal);
}

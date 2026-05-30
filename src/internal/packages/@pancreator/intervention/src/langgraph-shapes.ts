import type { CheckpointId } from "./checkpoint-id.js";

/** Structural payload mirroring LangGraph-style `interrupt()` signaling. */
export type LangGraphInterruptSignal = {
  readonly kind: "pancreator.langgraph.interrupt";
};

export function interruptSignal(): LangGraphInterruptSignal {
  return { kind: "pancreator.langgraph.interrupt" };
}

/** Structural payload mirroring LangGraph `Command({ goto })` navigation. */
export type LangGraphCommandGoto = {
  readonly kind: "pancreator.langgraph.command.goto";
  readonly stageId: string;
};

export function commandGoto(stageId: string): LangGraphCommandGoto {
  return { kind: "pancreator.langgraph.command.goto", stageId };
}

/** Structural payload mirroring time-travel by `checkpoint_id`. */
export type LangGraphTimeTravel = {
  readonly kind: "pancreator.langgraph.time_travel";
  readonly checkpointId: CheckpointId;
};

export function timeTravelTo(checkpointId: CheckpointId): LangGraphTimeTravel {
  return { kind: "pancreator.langgraph.time_travel", checkpointId };
}

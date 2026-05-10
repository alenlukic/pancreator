import type { CheckpointId } from "./checkpoint-id.js";

/** Structural payload mirroring LangGraph-style `interrupt()` signaling. */
export type LangGraphInterruptSignal = {
  readonly kind: "tesseract.langgraph.interrupt";
};

export function interruptSignal(): LangGraphInterruptSignal {
  return { kind: "tesseract.langgraph.interrupt" };
}

/** Structural payload mirroring LangGraph `Command({ goto })` navigation. */
export type LangGraphCommandGoto = {
  readonly kind: "tesseract.langgraph.command.goto";
  readonly stageId: string;
};

export function commandGoto(stageId: string): LangGraphCommandGoto {
  return { kind: "tesseract.langgraph.command.goto", stageId };
}

/** Structural payload mirroring time-travel by `checkpoint_id`. */
export type LangGraphTimeTravel = {
  readonly kind: "tesseract.langgraph.time_travel";
  readonly checkpointId: CheckpointId;
};

export function timeTravelTo(checkpointId: CheckpointId): LangGraphTimeTravel {
  return { kind: "tesseract.langgraph.time_travel", checkpointId };
}

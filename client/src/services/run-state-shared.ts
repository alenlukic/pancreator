export const FEATURE_DELIVERY_STAGE_ORDER = [
  "intake",
  "plan",
  "implement",
  "review",
  "test",
  "report",
  "ship",
  "index",
  "complete",
] as const;

export type StageCellStatus = "pending" | "active" | "complete" | "failed";

export type StageCell = {
  name: string;
  ownerPersona: string;
  humanGate: string;
  nextHumanAction: string;
  nextCommand: string;
  status: StageCellStatus;
};

export type RunLogEvent = {
  timestamp: string;
  event: string;
  message: string;
};

export type TaskRunStateEnvelope = {
  taskId: string;
  decodedTimestamp?: string;
  decodedTimestampDiagnostic?: string;
  stages: StageCell[];
  runEvents: RunLogEvent[];
  sourceWarning?: string;
};

export function taskDisplayLabel(
  task: Pick<TaskRunStateEnvelope, "taskId" | "decodedTimestamp" | "decodedTimestampDiagnostic">,
): string {
  const suffix = task.decodedTimestamp ?? task.decodedTimestampDiagnostic;
  return suffix ? `${task.taskId} (${suffix})` : task.taskId;
}

import {
  featureDisplayLabel,
  taskLevelNextCommand,
  type HumanGateQueueEntry,
  type TaskRunStateEnvelope,
} from "@/services/run-state-shared";
import type { CommandCenterRowModel } from "./command-center-types";

export type CommandCenterRowOverflowModel = CommandCenterRowModel["overflow"];

export function buildTaskOverflow(task: TaskRunStateEnvelope): CommandCenterRowOverflowModel {
  return {
    taskId: task.taskId,
    runDir: task.runDir,
    inboxSource: task.inboxSource,
    runCommand: taskLevelNextCommand(task),
  };
}

export function gateQueueEntryLabel(
  entry: HumanGateQueueEntry,
  tasks: TaskRunStateEnvelope[],
): string {
  const task = tasks.find((candidate) => candidate.taskId === entry.taskId);
  return task ? featureDisplayLabel(task) : "Feature delivery run";
}

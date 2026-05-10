import type { TaskId } from "@tesseract/core";

/** Ports reserved for one task. */
export interface PortAllocation {
  taskId: TaskId;
  ports: number[];
}

/** Filesystem-backed exclusive port blocks for parallel pipeline isolation. */
export interface PortRegistry {
  reserve(taskId: TaskId, count: number): Promise<number[]>;
  release(taskId: TaskId): Promise<void>;
  list(): Promise<PortAllocation[]>;
}

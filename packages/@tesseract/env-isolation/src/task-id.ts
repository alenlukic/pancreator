import { InvalidTaskIdError } from "./errors.js";

const RESERVED = new Set([".", ".."]);

/** Validates a task id for registry keys. */
export function assertSafeTaskId(taskId: string): void {
  if (!taskId || taskId.trim() !== taskId) {
    throw new InvalidTaskIdError("Task id is empty or has surrounding whitespace.");
  }
  if (!/^[-a-zA-Z0-9_]+$/.test(taskId)) {
    throw new InvalidTaskIdError(
      "Task id may only use ASCII letters, digits, hyphen, and underscore.",
    );
  }
  if (RESERVED.has(taskId)) {
    throw new InvalidTaskIdError("Task id matches a reserved registry key.");
  }
}

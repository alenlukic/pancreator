import { TESSERACT_CORE_VERSION } from "@tesseract/core";

/**
 * @packageDocumentation Phase 0a scaffold. Cursor agent runner lands in Phase 3+.
 */
export const TESSERACT_RUNNER_CURSOR_STUB = "runner-cursor" as const;

export function runnerCursorStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}

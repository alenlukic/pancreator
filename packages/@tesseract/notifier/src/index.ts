import { TESSERACT_CORE_VERSION } from "@tesseract/core";

/**
 * @packageDocumentation Phase 0a scaffold. Notifier channels land in Phase 3+.
 */
export const TESSERACT_NOTIFIER_STUB = "notifier" as const;

export function notifierStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}

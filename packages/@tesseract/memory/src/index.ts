import { TESSERACT_CORE_VERSION } from "@tesseract/core";

/**
 * @packageDocumentation Phase 0a scaffold. Memory store lands in Phase 3+.
 */
export const TESSERACT_MEMORY_STUB = "memory" as const;

export function memoryStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}

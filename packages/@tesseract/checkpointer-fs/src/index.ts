import { TESSERACT_CORE_VERSION } from "@tesseract/core";

/**
 * @packageDocumentation Phase 0a scaffold. Checkpointer implementation is deferred to Phase 3+.
 */
export const TESSERACT_CHECKPOINTER_FS_STUB = "checkpointer-fs" as const;

export function checkpointerFsStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}

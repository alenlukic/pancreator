import { TESSERACT_CORE_VERSION } from "@tesseract/core";

/**
 * @packageDocumentation Phase 0a scaffold. Pipeline graph compiler lands in Phase 3+.
 */
export const TESSERACT_PIPELINE_STUB = "pipeline" as const;

export function pipelineStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}

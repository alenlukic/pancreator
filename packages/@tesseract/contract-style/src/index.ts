import { TESSERACT_CORE_VERSION } from "@tesseract/core";

/**
 * @packageDocumentation Phase 0a scaffold. Style helpers land in Phase 2+.
 */
export const TESSERACT_CONTRACT_STYLE_STUB = "contract-style" as const;

export function contractStyleStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}

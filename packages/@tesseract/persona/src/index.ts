import { TESSERACT_CORE_VERSION } from "@tesseract/core";

/**
 * @packageDocumentation Phase 0a scaffold. Persona spec loading lands in Phase 3+.
 */
export const TESSERACT_PERSONA_STUB = "persona" as const;

export function personaStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}

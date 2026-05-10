/**
 * @packageDocumentation
 * Parse and emit Anthropic 16-field persona specs from `src/personas/<name>.md` with Cursor
 * `.cursor/agents` and `.mdc` projections.
 */
import { TESSERACT_CORE_VERSION } from "@tesseract/core";

export const TESSERACT_PERSONA_VERSION = "0.0.0" as const;

/** @deprecated Meta-package probe; prefer package exports. */
export const TESSERACT_PERSONA_STUB = "persona" as const;

/** @deprecated Meta-package probe; prefer package exports. */
export function personaStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}

export type {
  ParsedPersonaFile,
  PersonaEffort,
  PersonaIsolation,
  PersonaMemory,
  PersonaMetadata,
  PersonaPermissionMode,
  PersonaSpec,
} from "./types.js";
export { emitCursorAgentsMirror, emitMdcShim, emitPersonaMarkdown, type MdcShimOptions } from "./emit.js";
export { parsePersonaMarkdown } from "./parse.js";
export { assertPersonaSpec, isPersonaSpec } from "./validate.js";

/**
 * @packageDocumentation
 * File-backed `MemoryStore`, handbook `MemoryRouter`, and dual-anchor helpers.
 * This package depends only on `@tesseract/core`, not on other primitives.
 */

import { TESSERACT_CORE_VERSION } from "@tesseract/core";

/** @deprecated Meta-package probe; prefer package exports. */
export const TESSERACT_MEMORY_STUB = "memory" as const;
/** @deprecated Meta-package probe; prefer package exports. */
export function memoryStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}

export type {
  CitationVerification,
  DualAnchorCitation,
  LinesDualAnchor,
  SymbolDualAnchor,
} from "./citation.js";
export {
  buildLinesDualAnchor,
  buildSymbolDualAnchor,
  hashUtf8Content,
  verifyDualAnchor,
} from "./citation.js";
export { readUtf8ForDualAnchor } from "./dual-anchor-reader.js";
export type { MemoryStore } from "./file-memory-store.js";
export { FileMemoryStore } from "./file-memory-store.js";
export { MemoryRouter, parseDocList, parseHandbookIndexTable, type RouteHit } from "./memory-router.js";

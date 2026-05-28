/**
 * @packageDocumentation
 * File-backed `MemoryStore`, handbook `MemoryRouter`, and dual-anchor helpers.
 * This package depends only on `@daedaline/core`, not on other primitives.
 */

import { DAEDALINE_CORE_VERSION } from "@daedaline/core";

/** @deprecated Meta-package probe; prefer package exports. */
export const DAEDALINE_MEMORY_STUB = "memory" as const;
/** @deprecated Meta-package probe; prefer package exports. */
export function memoryStubVersion(): string {
  return DAEDALINE_CORE_VERSION;
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

import { TESSERACT_CORE_VERSION } from "@tesseract/core";

/**
 * @packageDocumentation Phase 0a scaffold. Git worktree pool lands in Phase 3+.
 */
export const TESSERACT_WORKTREE_STUB = "worktree" as const;

export function worktreeStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}

/**
 * @packageDocumentation
 * File-backed Inbox I/O. This package depends only on `@tesseract/core`, not
 * on other primitives.
 */

import { TESSERACT_CORE_VERSION } from "@tesseract/core";

export { TESSERACT_CORE_VERSION };

/** @deprecated Meta-package probe; prefer package exports. */
export const TESSERACT_INBOX_STUB = "inbox" as const;
/** @deprecated Meta-package probe; prefer package exports. */
export function inboxStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}
export type { Inbox } from "./file-inbox.js";
export { FileInbox } from "./file-inbox.js";

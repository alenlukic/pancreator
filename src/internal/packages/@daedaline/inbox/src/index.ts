/**
 * @packageDocumentation
 * File-backed Inbox I/O. This package depends only on `@daedaline/core`, not
 * on other primitives.
 */

import { DAEDALINE_CORE_VERSION } from "@daedaline/core";

export { DAEDALINE_CORE_VERSION };

/** @deprecated Meta-package probe; prefer package exports. */
export const DAEDALINE_INBOX_STUB = "inbox" as const;
/** @deprecated Meta-package probe; prefer package exports. */
export function inboxStubVersion(): string {
  return DAEDALINE_CORE_VERSION;
}
export type { Inbox } from "./file-inbox.js";
export { FileInbox } from "./file-inbox.js";

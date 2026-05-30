/**
 * @packageDocumentation
 * File-backed Inbox I/O. This package depends only on `@pancreator/core`, not
 * on other primitives.
 */

import { PANCREATOR_CORE_VERSION } from "@pancreator/core";

export { PANCREATOR_CORE_VERSION };

/** @deprecated Meta-package probe; prefer package exports. */
export const PANCREATOR_INBOX_STUB = "inbox" as const;
/** @deprecated Meta-package probe; prefer package exports. */
export function inboxStubVersion(): string {
  return PANCREATOR_CORE_VERSION;
}
export type { Inbox } from "./file-inbox.js";
export { FileInbox } from "./file-inbox.js";

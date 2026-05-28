/**
 * @packageDocumentation
 * Console and Inbox `Notifier` implementations. This package depends only on
 * `@daedaline/core`, not on other primitives.
 */

import { DAEDALINE_CORE_VERSION } from "@daedaline/core";

export { DAEDALINE_CORE_VERSION };

/** @deprecated Meta-package probe; prefer package exports. */
export const DAEDALINE_NOTIFIER_STUB = "notifier" as const;
/** @deprecated Meta-package probe; prefer package exports. */
export function notifierStubVersion(): string {
  return DAEDALINE_CORE_VERSION;
}
export { createConsoleNotifier } from "./console-notifier.js";
export { createInboxNotifier } from "./inbox-notifier.js";
export type { InboxNotificationSink, Notifier, NotificationEvent } from "./types.js";

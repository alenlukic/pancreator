/**
 * @packageDocumentation
 * Console and Inbox `Notifier` implementations. This package depends only on
 * `@pancreator/core`, not on other primitives.
 */

import { PANCREATOR_CORE_VERSION } from "@pancreator/core";

export { PANCREATOR_CORE_VERSION };

/** @deprecated Meta-package probe; prefer package exports. */
export const PANCREATOR_NOTIFIER_STUB = "notifier" as const;
/** @deprecated Meta-package probe; prefer package exports. */
export function notifierStubVersion(): string {
  return PANCREATOR_CORE_VERSION;
}
export { createConsoleNotifier } from "./console-notifier.js";
export { createInboxNotifier } from "./inbox-notifier.js";
export type { InboxNotificationSink, Notifier, NotificationEvent } from "./types.js";

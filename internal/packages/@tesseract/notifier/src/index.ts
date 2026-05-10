/**
 * @packageDocumentation
 * Console and Inbox `Notifier` implementations. This package depends only on
 * `@tesseract/core`, not on other primitives.
 */

import { TESSERACT_CORE_VERSION } from "@tesseract/core";

export { TESSERACT_CORE_VERSION };

/** @deprecated Meta-package probe; prefer package exports. */
export const TESSERACT_NOTIFIER_STUB = "notifier" as const;
/** @deprecated Meta-package probe; prefer package exports. */
export function notifierStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}
export { createConsoleNotifier } from "./console-notifier.js";
export { createInboxNotifier } from "./inbox-notifier.js";
export type { InboxNotificationSink, Notifier, NotificationEvent } from "./types.js";

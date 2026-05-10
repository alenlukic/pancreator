/**
 * A human-readable notification payload for `Notifier` implementations.
 */
export type NotificationEvent = {
  /** Short title for the notification. */
  readonly summary: string;
  /** Optional long-form text. */
  readonly body?: string;
};

/**
 * The system SHALL deliver a `NotificationEvent` to an operator or sink.
 */
export interface Notifier {
  notify(event: NotificationEvent): Promise<void>;
}

/**
 * The system SHALL write an `InboxNotificationSink` to `/src/inbox/out/` through a
 * caller-supplied implementation (glossary: Inbox and Notifier). Callers that
 * use `@tesseract/inbox` MAY pass a `FileInbox` instance to structurally
 * match this type without a cross-primitive import.
 */
export type InboxNotificationSink = {
  writeOutFile: (name: string, content: string) => Promise<void>;
};

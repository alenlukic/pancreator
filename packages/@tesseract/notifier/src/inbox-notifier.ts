import type { InboxNotificationSink, Notifier, NotificationEvent } from "./types.js";

/**
 * The system SHALL serialize each `NotificationEvent` to UTF-8 text and store
 * it under a unique filename via `InboxNotificationSink.writeOutFile`.
 */
export function createInboxNotifier(
  sink: InboxNotificationSink,
  nameFactory: () => string = () => {
    return `notifier-${Date.now()}.md`;
  },
): Notifier {
  return {
    async notify(event: NotificationEvent): Promise<void> {
      const lines: string[] = [`# ${event.summary}`, ""];
      if (event.body != null && event.body.length > 0) {
        lines.push(event.body);
        lines.push("");
      }
      const body = lines.join("\n");
      await sink.writeOutFile(nameFactory(), body);
    },
  };
}

import type { NotificationEvent, Notifier } from "./types.js";

/**
 * The system SHALL print each notification to the provided log line callback.
 */
export function createConsoleNotifier(
  out: { log: (line: string) => void } = console,
): Notifier {
  return {
    async notify(event: NotificationEvent): Promise<void> {
      const text =
        event.body != null && event.body.length > 0
          ? `${event.summary}\n${event.body}`
          : event.summary;
      out.log(text);
    },
  };
}

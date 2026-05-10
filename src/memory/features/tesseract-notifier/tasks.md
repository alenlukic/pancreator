# Task List - @tesseract/notifier

- [x] T1: Confirm package scaffold and exported surface satisfy `tesseract.notifier.package_shape`.
- [x] T2: Confirm README Quickstart satisfies `tesseract.notifier.readme_ergonomics` (LLM-judge runs separately when contracts execute).
- [x] T3: Run package conformance checks and capture failures.
- [x] T4: Resolve contract failures with minimal, scoped package edits.
- [x] T5: Re-run contract checks and record green status for Phase 2 completion.

## Slice notes (Phase 3 step 4)

**Done:** `Notifier`, `NotificationEvent`, `createConsoleNotifier`, `createInboxNotifier`, `InboxNotificationSink` (structural match with `FileInbox.writeOutFile` at the app edge; no cross-primitive import); Vitest + README Quickstart; `typecheck`/`test` scripts. Deprecated `TESSERACT_NOTIFIER_STUB` / `notifierStubVersion` retained for the `tesseract` meta package.

**Deferred:** Slack and other remote channels, templated subject lines, and deduplication of notification files.

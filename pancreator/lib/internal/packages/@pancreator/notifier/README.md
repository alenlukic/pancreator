# @pancreator/notifier

`Notifier` implementations: console output and a sink-based inbox writer (wire `InboxNotificationSink` to your own `@pancreator/inbox` `FileInbox` at the application edge).

## Quickstart

```sh
pnpm install
pnpm --filter @pancreator/notifier run build
pnpm --filter @pancreator/notifier test
pnpm --filter @pancreator/notifier run typecheck
```

`createConsoleNotifier` prints to the console. `createInboxNotifier` writes Markdown under unique filenames using `writeOutFile` on a caller-provided sink.

## Scope

- This package depends only on `@pancreator/core` (and Node built-ins).
- Slack and other remote channels are out of scope for this slice.

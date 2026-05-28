# @daedaline/notifier

`Notifier` implementations: console output and a sink-based inbox writer (wire `InboxNotificationSink` to your own `@daedaline/inbox` `FileInbox` at the application edge).

## Quickstart

```sh
pnpm install
pnpm --filter @daedaline/notifier run build
pnpm --filter @daedaline/notifier test
pnpm --filter @daedaline/notifier run typecheck
```

`createConsoleNotifier` prints to the console. `createInboxNotifier` writes Markdown under unique filenames using `writeOutFile` on a caller-provided sink.

## Scope

- This package depends only on `@daedaline/core` (and Node built-ins).
- Slack and other remote channels are out of scope for this slice.

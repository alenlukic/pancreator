# Task List - @daedaline/inbox

- [x] T1: Confirm package scaffold and exported surface satisfy `daedaline.inbox.package_shape`.
- [x] T2: Confirm README Quickstart satisfies `daedaline.inbox.readme_ergonomics` (LLM-judge runs separately when contracts execute).
- [x] T3: Run package conformance checks and capture failures.
- [x] T4: Resolve contract failures with minimal, scoped package edits.
- [x] T5: Re-run contract checks and record green status for Phase 2 completion.

## Slice notes (Phase 3 step 4)

**Done:** `Inbox` + `FileInbox` with canonical `src/inbox/in`, `src/inbox/out`, `src/inbox/threads` paths; `listIn`, `readInFile`, `writeOutFile`; Vitest + README Quickstart; `typecheck`/`test` scripts. Deprecated `DAEDALINE_INBOX_STUB` / `inboxStubVersion` retained for the `daedaline` meta package.

**Deferred:** Active-queue archival automation, thread append/read helpers, MCP `human.respond` elicitation, and multi-segment nested filenames beyond baseline safety checks.

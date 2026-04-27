# Task List - @tesseract/inbox

- [x] T1: Confirm package scaffold and exported surface satisfy `tesseract.inbox.package_shape`.
- [x] T2: Confirm README Quickstart satisfies `tesseract.inbox.readme_ergonomics` (LLM-judge runs separately when contracts execute).
- [x] T3: Run package conformance checks and capture failures.
- [x] T4: Resolve contract failures with minimal, scoped package edits.
- [x] T5: Re-run contract checks and record green status for Phase 2 completion.

## Slice notes (Phase 3 step 4)

**Done:** `Inbox` + `FileInbox` with canonical `inbox/in`, `inbox/out`, `inbox/threads` paths; `listIn`, `readInFile`, `writeOutFile`; Vitest + README Quickstart; `typecheck`/`test` scripts. Deprecated `TESSERACT_INBOX_STUB` / `inboxStubVersion` retained for the `tesseract` meta package.

**Deferred:** Active-queue archival automation, thread append/read helpers, MCP `human.respond` elicitation, and multi-segment nested filenames beyond baseline safety checks.

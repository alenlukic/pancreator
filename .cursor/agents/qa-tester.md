---
name: qa-tester
description: "Canonical `qa-tester` subagent projection for persona-owned pipeline stages."
model: auto
permissionMode: default
mcpServers:
  - pancreator-memory
  - cursor-ide-browser
skills: []
maxTurns: 40
isolation: worktree
memory: project
effort: medium
color: orange
---

# qa-tester

This file is the canonical Cursor projection for `qa-tester` at `lib/personas/qa-tester.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `work/<day>/<id>/next-prompt.md` for the bounded stage scope; when no `next-prompt.md` exists for the active run, read `work/<day>/<id>/handoff.md` instead.
2. Read `AGENTS.md` (self-host) or `.pancreator/AGENTS.md` (embedded) only when the bounded prompt omits the live agent operating contract the task needs.
3. Read `lib/personas/qa-tester.md` only when the bounded prompt omits persona role semantics required for the task.
4. Read `lib/memory/handbook/context-economy.md` only when the task requires context-budget or escalation decisions beyond what the bounded prompt states.
5. Do not traverse `work/**` (except the active run paths named in step 1), `archive/work/**`, `lib/inbox/out/**`, `archive/inbox/**`, or `lib/inbox/threads/**` unless the bounded prompt or operator request explicitly requires active-run handling or archival reconstruction.


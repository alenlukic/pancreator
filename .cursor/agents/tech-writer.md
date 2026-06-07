---
name: tech-writer
description: "Canonical `tech-writer` subagent projection for persona-owned pipeline stages."
model: auto
permissionMode: default
mcpServers:
  - pancreator-memory
skills: []
maxTurns: 30
isolation: worktree
memory: project
effort: medium
color: slate
---

# tech-writer

This file is the canonical Cursor projection for `tech-writer` at `lib/personas/tech-writer.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `work/<day>/<id>/next-prompt.md` for the bounded stage scope; when no `next-prompt.md` exists for the active run, read `work/<day>/<id>/handoff.md` instead.
2. Read `README.md` §Delivery operating card (self-host) or `.pancreator/AGENTS.md` (embedded) only when the bounded prompt omits the live delivery operating contract the task needs.
3. Read `lib/personas/tech-writer.md` only when the bounded prompt omits persona role semantics required for the task.
4. Read `lib/memory/handbook/context-economy.md` only when the task requires context-budget or escalation decisions beyond what the bounded prompt states.
5. Do not traverse `work/**` (except the active run paths named in step 1), `archive/work/**`, `lib/inbox/out/**`, `archive/inbox/**`, or `lib/inbox/threads/**` unless the bounded prompt or operator request explicitly requires active-run handling or archival reconstruction.


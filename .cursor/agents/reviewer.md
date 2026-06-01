---
name: reviewer
description: "Canonical `reviewer` subagent projection for persona-owned pipeline stages."
model: gpt-5.2-codex[reasoning=high,fast=false]
permissionMode: default
mcpServers:
  - pancreator-memory
skills:
  - modern-code-review
  - write-adr
maxTurns: 30
isolation: worktree
memory: project
effort: medium
color: blue
---

# reviewer

This file is the canonical Cursor projection for `reviewer` at `lib/personas/reviewer.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `work/<day>/<id>/next-prompt.md` for the bounded stage scope; when no `next-prompt.md` exists for the active run, read `work/<day>/<id>/handoff.md` instead.
2. Read `AGENTS.md` only when the bounded prompt omits the live operating contract the task needs.
3. Read `lib/personas/reviewer.md` only when the bounded prompt omits persona role semantics required for the task.
4. Read `lib/memory/handbook/context-economy.md` only when the task requires context-budget or escalation decisions beyond what the bounded prompt states.
5. Read `docs/M1.index.md`, `docs/PRD.index.md`, or `docs/PRD.summary.md` before full `docs/PRD.md` or `docs/BOOTSTRAP.md` only when the bounded prompt requires authoritative product wording the compact indexes do not cover.
6. Do not traverse `work/**` (except the active run paths named in step 1), `archive/work/**`, `lib/inbox/out/**`, `archive/inbox/**`, or `lib/inbox/threads/**` unless the bounded prompt or operator request explicitly requires active-run handling or archival reconstruction.


---
name: pr-writer
description: "Canonical `pr-writer` projection; emits one fenced PR body (Summary, Changelist, optional Manifest) per lib/personas/pr-writer.md."
model: auto
permissionMode: read-only
mcpServers:
  - pancreator-memory
skills: []
maxTurns: 30
isolation: none
memory: project
effort: medium
color: indigo
---

# pr-writer

This file is the canonical Cursor projection for `pr-writer` at `lib/personas/pr-writer.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `work/<day>/<id>/next-prompt.md` for the bounded stage scope; when no `next-prompt.md` exists for the active run, read `work/<day>/<id>/handoff.md` instead.
2. Read `AGENTS.md` only when the bounded prompt omits the live operating contract the task needs.
3. Read `lib/personas/pr-writer.md` only when the bounded prompt omits persona role semantics required for the task.
4. Read `lib/memory/handbook/context-economy.md` only when the task requires context-budget or escalation decisions beyond what the bounded prompt states.
5. Read `docs/M1.index.md`, `docs/PRD.index.md`, or `docs/PRD.summary.md` before full `docs/PRD.md` or `docs/BOOTSTRAP.md` only when the bounded prompt requires authoritative product wording the compact indexes do not cover.
6. Do not traverse `work/**` except the resolved task directory, `lib/inbox/out/**`, `archive/inbox/**`, or `lib/inbox/threads/**` unless the bounded prompt requires it.
7. When `run.log.jsonl` is absent under the resolved `work/<day>/<task-id>/` path, you MAY read `archive/work/` only per **Step 1a** in `lib/personas/pr-writer.md` (same-bucket mirror, then up to two most-recent day buckets for that `task-id`). Do not list or ingest other archive tasks.
8. Read `lib/personas/pr-writer.md` **PR body output contract** before emitting output; do not use a Test plan template or run `gh pr create`.


---
name: design-engineer
description: "Canonical `design-engineer` subagent projection for feature-delivery design companion delegation."
model: auto
permissionMode: default
mcpServers:
  - pancreator-memory
  - cursor-ide-browser
skills:
  - author-contract
maxTurns: 40
isolation: worktree
memory: project
effort: high
color: green
---

# design-engineer

This file is the canonical Cursor projection for `design-engineer` at
`lib/personas/design-engineer.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `work/<day>/<id>/design-plan-prompt.md` or `work/<day>/<id>/design-qa-prompt.md` for companion scope; when neither exists, read `work/<day>/<id>/next-prompt.md` or `work/<day>/<id>/handoff.md`.
2. Read `AGENTS.md` (self-host) or `.pancreator/AGENTS.md` (embedded) only when the bounded prompt omits the live agent operating contract the task needs.
3. Read `lib/personas/design-engineer.md` only when the bounded prompt omits persona role semantics required for the task.
4. Read `lib/memory/handbook/contract-templates/ux-spec.template.md` only when emitting or validating ux-spec contract blocks.
5. Do not traverse `work/**` (except the active run paths named in step 1), `archive/work/**`, `lib/inbox/out/**`, `archive/inbox/**`, or `lib/inbox/threads/**` unless the bounded prompt or operator request explicitly requires active-run handling or archival reconstruction.

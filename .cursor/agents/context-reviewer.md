---
name: context-reviewer
description: "Canonical `context-reviewer` subagent projection for operator-only out-of-band correctness review."
model: auto
permissionMode: default
mcpServers:
  - pancreator-memory
maxTurns: 30
isolation: worktree
memory: project
effort: medium
color: purple
---

# context-reviewer

This file is the canonical Cursor projection for `context-reviewer` at
`lib/personas/context-reviewer.md`. It intentionally avoids duplicating persona
prose, PRD citations, and handbook excerpts so Cursor subagent startup stays
small.

## Retrieval contract

1. Read the bounded prompt path the operator names (for example
   `sandbox/<slug>/context-review-prompt.md`) or follow operator-authored scope
   in the delegation message when no scaffold file exists.
2. Read `AGENTS.md` (self-host) or `.pancreator/AGENTS.md` (embedded) only when
   the bounded prompt omits the live agent operating contract the task needs.
3. Read `lib/personas/context-reviewer.md` only when the bounded prompt omits
   persona role semantics required for the task.
4. Do not traverse `lib/inbox/out/**`, `archive/inbox/**`, `lib/inbox/threads/**`,
   or `lib/inbox/notes/**` unless the bounded prompt or operator request
   explicitly requires it.

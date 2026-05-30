---
name: pancreator-engineer
description: "Canonical `pancreator-engineer` subagent projection for persona-owned pipeline stages."
model: gpt-5.3-codex
permissionMode: default
tools:
  - Read
  - Grep
  - Glob
  - Write
  - Edit
  - "Bash(git diff:*)"
  - "Bash(git status:*)"
  - "Bash(git log:*)"
  - "Bash(pnpm lint:*)"
  - "Bash(pnpm test:*)"
  - "Bash(pnpm build:*)"
  - "Bash(pnpm typecheck:*)"
disallowedTools:
  - "Bash(rm:*)"
  - "Bash(git push:*)"
  - "Bash(git commit:*)"
  - "Bash(git reset:*)"
  - "Bash(git checkout:*)"
mcpServers: []
skills: []
maxTurns: 40
isolation: worktree
memory: project
effort: medium
color: green
metadata:
  pancreator-risk-tier: medium
  pancreator-pipeline-stages: [internal-engineering, compliance-remediation]
  pancreator-bootstrap-only: false
  pancreator-stability: experimental
  pancreator-handbook-anchors:
    - /lib/memory/handbook/glossary.md
    - /lib/memory/handbook/persona-spec.md
    - /lib/memory/handbook/contract-format.md
    - /lib/memory/handbook/documentation-impact-contract.md
  pancreator-checklist:
    - sixteen-field-yaml-complete
    - description-uses-EARS
    - tools-allowlist-minimal
    - mdc-shim-emitted-and-round-trips
    - layer-1-lint-clean
    - non-contract-inputs-normalized-via-contract-writer
    - prose-ambiguity-resolved-before-execution
    - execution-limited-to-pancreator-internal-corpus
    - docs-impact-evaluated-every-task
    - no-push-no-destructive-git
  pancreator-base-persona: pancreator-engineer
  pancreator-model-tier: canonical
  pancreator-canonical-persona: lib/personas/pancreator-engineer.md
---

# pancreator-engineer

This file is the canonical Cursor projection for `pancreator-engineer` at `lib/personas/pancreator-engineer.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `AGENTS.md` for the live operating contract.
2. Read `lib/personas/pancreator-engineer.md` for role semantics before performing persona-owned work.
3. Read `lib/memory/handbook/context-economy.md` only when the task requires context-budget decisions.
4. Read `docs/M1.index.md`, `docs/PRD.index.md`, or `docs/PRD.summary.md` before full `docs/PRD.md` or `docs/BOOTSTRAP.md`.
5. Do not traverse `work/**`, `archive/work/**`, `lib/inbox/out/**`, `archive/inbox/**`, or `lib/inbox/threads/**` unless the task explicitly requires active-run handling or archival reconstruction.



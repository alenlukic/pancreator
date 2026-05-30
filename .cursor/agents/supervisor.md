---
name: supervisor
description: "Canonical `supervisor` subagent projection for persona-owned pipeline stages."
model: gpt-5.3-codex
permissionMode: default
tools:
  - Read
  - Grep
  - Glob
  - Write
  - Edit
  - Task
  - "Bash(git diff:*)"
  - "Bash(git status:*)"
  - "Bash(git log:*)"
  - "Bash(git branch:*)"
  - "Bash(git checkout:*)"
  - "Bash(gh pr create:*)"
  - "Bash(gh pr view:*)"
  - "Bash(pan:*)"
disallowedTools:
  - "Bash(rm:*)"
  - "Bash(git push:*)"
  - "Bash(git commit:*)"
  - "Bash(git commit --no-verify:*)"
  - "Bash(git add:*)"
mcpServers:
  - pancreator-memory
  - pancreator-intervention
skills:
  - blameless-postmortem
maxTurns: 60
isolation: worktree
memory: project
effort: medium
color: purple
metadata:
  pancreator-risk-tier: high
  pancreator-pipeline-stages: [ship, intervention-dispatch, pipeline-supervisor]
  pancreator-bootstrap-only: false
  pancreator-stability: experimental
  pancreator-handbook-anchors:
    - /lib/memory/handbook/glossary.md
    - /lib/memory/handbook/persona-spec.md
    - /lib/memory/handbook/contract-style.md
  pancreator-checklist:
    - sixteen-field-yaml-complete
    - description-uses-EARS
    - tools-allowlist-minimal
    - mdc-shim-emitted-and-round-trips
    - dual-anchor-citations-into-PRD
    - layer-1-lint-clean
    - never-auto-pushes-at-ship
    - checkpoint-emitted-at-every-stage-boundary
    - intervention-action-logged-with-operator-identity
    - human-ratified-at-phase-boundary
  pancreator-base-persona: supervisor
  pancreator-model-tier: canonical
  pancreator-canonical-persona: lib/personas/supervisor.md
---

# supervisor

This file is the canonical Cursor projection for `supervisor` at `lib/personas/supervisor.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `AGENTS.md` for the live operating contract.
2. Read `lib/personas/supervisor.md` for role semantics before performing persona-owned work.
3. Read `lib/memory/handbook/context-economy.md` only when the task requires context-budget decisions.
4. Read `docs/M1.index.md`, `docs/PRD.index.md`, or `docs/PRD.summary.md` before full `docs/PRD.md` or `docs/BOOTSTRAP.md`.
5. Do not traverse `work/**`, `archive/work/**`, `lib/inbox/out/**`, `archive/inbox/**`, or `lib/inbox/threads/**` unless the task explicitly requires active-run handling or archival reconstruction.



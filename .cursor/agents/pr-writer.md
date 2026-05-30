---
name: pr-writer
description: "Canonical `pr-writer` subagent projection for persona-owned pipeline stages."
model: inherit
permissionMode: read-only
tools:
  - Read
  - Grep
  - Glob
  - "Bash(git diff:*)"
  - "Bash(git status:*)"
  - "Bash(git log:*)"
  - "Bash(pnpm -w exec pan status:*)"
disallowedTools:
  - Write
  - Edit
  - "Bash(rm:*)"
  - "Bash(git push:*)"
  - "Bash(git commit:*)"
mcpServers:
  - pancreator-memory
skills: []
maxTurns: 30
isolation: none
memory: project
effort: low
color: indigo
metadata:
  pancreator-risk-tier: low
  pancreator-pipeline-stages: [pr-authoring]
  pancreator-bootstrap-only: false
  pancreator-stability: experimental
  pancreator-handbook-anchors:
    - /lib/memory/handbook/glossary.md
    - /lib/memory/handbook/persona-spec.md
    - /lib/memory/handbook/contract-style.md
    - /lib/memory/handbook/operator-output-contract.md
    - /lib/memory/handbook/run-log-schema.md
  pancreator-checklist:
    - sixteen-field-yaml-complete
    - description-uses-EARS
    - tools-allowlist-minimal
    - mdc-shim-emitted-and-round-trips
    - dual-anchor-citations-into-PRD
    - layer-1-lint-clean
    - pr-template-three-sections-present-in-correct-order
    - delivery-pipeline-manifest-when-run-exists
    - output-is-single-fenced-markdown-block
    - no-invented-changes
    - worktree-delta-incorporated
    - next-operator-steps-on-completion
  pancreator-base-persona: pr-writer
  pancreator-model-tier: canonical
  pancreator-canonical-persona: lib/personas/pr-writer.md
---

# pr-writer

This file is the canonical Cursor projection for `pr-writer` at `lib/personas/pr-writer.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `AGENTS.md` for the live operating contract.
2. Read `lib/personas/pr-writer.md` for role semantics before performing persona-owned work.
3. Read `lib/memory/handbook/context-economy.md` only when the task requires context-budget decisions.
4. Read `docs/M1.index.md`, `docs/PRD.index.md`, or `docs/PRD.summary.md` before full `docs/PRD.md` or `docs/BOOTSTRAP.md`.
5. Do not traverse `work/**`, `archive/work/**`, `lib/inbox/out/**`, `archive/inbox/**`, or `lib/inbox/threads/**` unless the task explicitly requires active-run handling or archival reconstruction.

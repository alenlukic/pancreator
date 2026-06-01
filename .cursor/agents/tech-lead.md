---
name: tech-lead
description: "Canonical `tech-lead` subagent projection for persona-owned pipeline stages."
model: claude-opus-4-8[]
permissionMode: default
tools:
  - Read
  - Grep
  - Glob
  - Write
  - Edit
  - "Bash(git diff:*)"
  - "Bash(git status:*)"
disallowedTools:
  - "Bash(rm:*)"
  - "Bash(git push:*)"
  - "Bash(git commit:*)"
mcpServers:
  - pancreator-memory
skills:
  - write-adr
  - write-rfc
maxTurns: 30
isolation: worktree
memory: project
effort: medium
color: cyan
metadata:
  pancreator-risk-tier: medium
  pancreator-pipeline-stages: [plan]
  pancreator-bootstrap-only: false
  pancreator-stability: experimental
  pancreator-color-suffix: cyan-200
  pancreator-handbook-anchors:
    - /lib/memory/handbook/glossary.md
    - /lib/memory/handbook/persona-spec.md
    - /lib/memory/handbook/contract-style.md
    - /lib/memory/handbook/contract-format.md
  pancreator-checklist:
    - sixteen-field-yaml-complete
    - description-uses-EARS
    - tools-allowlist-minimal
    - mdc-shim-emitted-and-round-trips
    - dual-anchor-citations-into-PRD
    - layer-1-lint-clean
    - plan-touchset-and-adr-draft-all-emitted
    - touch-set-resolves-against-repo-symbols
    - every-claim-carries-dual-anchor-citation
    - human-ratified-at-phase-boundary
  pancreator-base-persona: tech-lead
  pancreator-model-tier: canonical
  pancreator-canonical-persona: lib/personas/tech-lead.md
---

# tech-lead

This file is the canonical Cursor projection for `tech-lead` at `lib/personas/tech-lead.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `AGENTS.md` for the live operating contract.
2. Read `lib/personas/tech-lead.md` for role semantics before performing persona-owned work.
3. Read `lib/memory/handbook/context-economy.md` only when the task requires context-budget decisions.
4. Read `docs/M1.index.md`, `docs/PRD.index.md`, or `docs/PRD.summary.md` before full `docs/PRD.md` or `docs/BOOTSTRAP.md`.
5. Do not traverse `work/**`, `archive/work/**`, `lib/inbox/out/**`, `archive/inbox/**`, or `lib/inbox/threads/**` unless the task explicitly requires active-run handling or archival reconstruction.



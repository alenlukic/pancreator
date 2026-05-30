---
name: persona-designer
description: "Backward-compatible standard alias for `persona-designer-standard`. Use for routine persona-designer work; invoke `persona-designer-complex` when the task is ambiguous, cross-cutting, policy-sensitive, or explicitly escalated."
model: claude-4.6-sonnet-medium-thinking
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
  - author-persona
maxTurns: 30
isolation: worktree
memory: project
effort: medium
color: violet
metadata:
  pancreator-risk-tier: medium
  pancreator-pipeline-stages: [bootstrap-phase-1, sme-spawn]
  pancreator-bootstrap-only: false
  pancreator-stability: experimental
  pancreator-handbook-anchors:
    - /src/memory/handbook/persona-spec.md
    - /src/memory/handbook/glossary.md
    - /src/memory/handbook/contract-style.md
  pancreator-checklist:
    - sixteen-field-yaml-complete
    - description-uses-EARS
    - skills-resolve-to-existing-files
    - tools-allowlist-minimal
    - mdc-shim-emitted-and-round-trips
    - dual-anchor-citations-into-PRD
    - layer-1-lint-clean
    - human-ratified-at-phase-boundary
  pancreator-base-persona: persona-designer
  pancreator-model-tier: standard-alias
  pancreator-canonical-persona: src/personas/persona-designer.md
---

# persona-designer

This file is a compact Cursor projection for the canonical persona at
`src/personas/persona-designer.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `AGENTS.md` for the live operating contract.
2. Read `src/personas/persona-designer.md` for role semantics before performing persona-owned work.
3. Read `src/memory/handbook/context-economy.md` only when the task requires context-budget decisions.
4. Read `docs/M1.index.md`, `docs/PRD.index.md`, or `docs/PRD.summary.md` before full `docs/PRD.md` or `docs/BOOTSTRAP.md`.
5. Do not traverse `src/work/**`, `src/internal/work_archive/**`, `src/inbox/out/**`, `src/inbox/archive/**`, or `src/inbox/threads/**` unless the task explicitly requires active-run handling or archival reconstruction.

## Tier guidance

- `persona-designer-standard` is the default for bounded or routine work; its model is selected by the current frontmatter policy.
- `persona-designer-complex` preserves the prior fixed model selection for reasoning-heavy work.
- `persona-designer` is a backward-compatible standard alias unless an operator explicitly asks for the complex tier.

When escalating from standard to complex, state the reason in the operator-visible response or run log.

---
name: intake-analyst-standard
description: "Standard economical `intake-analyst` subagent. Use for bounded, routine, or simple-task-mode work that should let Cursor auto-select an economical model."
model: auto
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
  - tesseract-memory
skills:
  - canonicalize-spec
maxTurns: 30
isolation: worktree
memory: project
effort: medium
color: cyan
metadata:
  tesseract-risk-tier: medium
  tesseract-pipeline-stages: [intake]
  tesseract-bootstrap-only: false
  tesseract-stability: experimental
  tesseract-color-suffix: cyan-100
  tesseract-handbook-anchors:
    - /memory/handbook/glossary.md
    - /memory/handbook/persona-spec.md
    - /memory/handbook/contract-style.md
  tesseract-checklist:
    - sixteen-field-yaml-complete
    - description-uses-EARS
    - tools-allowlist-minimal
    - mdc-shim-emitted-and-round-trips
    - dual-anchor-citations-into-PRD
    - layer-1-lint-clean
    - clarifying-loop-cap-at-5-rounds
    - canonical-spec-passes-Spec-Kit-shape
    - every-claim-carries-dual-anchor-citation
    - human-ratified-at-phase-boundary
  tesseract-base-persona: intake-analyst
  tesseract-model-tier: standard
  tesseract-canonical-persona: personas/intake-analyst.md
---

# intake-analyst-standard

This file is a compact Cursor projection for the canonical persona at
`personas/intake-analyst.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `AGENTS.md` for the live operating contract.
2. Read `personas/intake-analyst.md` for role semantics before performing persona-owned work.
3. Read `memory/handbook/context-economy.md` only when the task requires context-budget decisions.
4. Read `M1.index.md`, `PRD.index.md`, or `PRD.summary.md` before full `PRD.md` or `BOOTSTRAP.md`.
5. Do not traverse `work/**`, `internal/work_archive/**`, `inbox/out/**`, `inbox/archive/**`, or `inbox/threads/**` unless the task explicitly requires active-run handling or archival reconstruction.

## Tier guidance

- `intake-analyst-standard` uses `model: auto` and is the default for bounded or routine work.
- `intake-analyst-complex` preserves the prior fixed model selection for reasoning-heavy work.
- `intake-analyst` is a backward-compatible standard alias unless an operator explicitly asks for the complex tier.

When escalating from standard to complex, state the reason in the operator-visible response or run log.

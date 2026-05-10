---
name: coder-standard
description: "Standard economical `coder` subagent. Use for bounded, routine, or simple-task-mode work that should let Cursor auto-select an economical model."
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
  - "Bash(pnpm test:*)"
  - "Bash(pnpm lint:*)"
  - "Bash(pnpm build:*)"
  - "Bash(pnpm typecheck:*)"
disallowedTools:
  - "Bash(rm:*)"
  - "Bash(git push:*)"
  - "Bash(git commit:*)"
mcpServers:
  - tesseract-memory
skills: []
maxTurns: 30
isolation: worktree
memory: project
effort: medium
color: green
metadata:
  tesseract-risk-tier: medium
  tesseract-pipeline-stages: [implement]
  tesseract-bootstrap-only: false
  tesseract-stability: experimental
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
    - writes-only-inside-touch-set
    - one-test-per-public-symbol
    - circuit-breaker-thresholds-honored
    - human-ratified-at-phase-boundary
  tesseract-base-persona: coder
  tesseract-model-tier: standard
  tesseract-canonical-persona: personas/coder.md
---

# coder-standard

This file is a compact Cursor projection for the canonical persona at
`personas/coder.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `AGENTS.md` for the live operating contract.
2. Read `personas/coder.md` for role semantics before performing persona-owned work.
3. Read `memory/handbook/context-economy.md` only when the task requires context-budget decisions.
4. Read `M1.index.md`, `PRD.index.md`, or `PRD.summary.md` before full `PRD.md` or `BOOTSTRAP.md`.
5. Do not traverse `work/**`, `internal/work_archive/**`, `inbox/out/**`, `inbox/archive/**`, or `inbox/threads/**` unless the task explicitly requires active-run handling or archival reconstruction.

## Tier guidance

- `coder-standard` uses `model: auto` and is the default for bounded or routine work.
- `coder-complex` preserves the prior fixed model selection for reasoning-heavy work.
- `coder` is a backward-compatible standard alias unless an operator explicitly asks for the complex tier.

When escalating from standard to complex, state the reason in the operator-visible response or run log.

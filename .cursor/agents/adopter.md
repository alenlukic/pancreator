---
name: adopter
description: "Backward-compatible standard alias for `adopter-standard`. Use for routine adopter work; invoke `adopter-complex` when the task is ambiguous, cross-cutting, policy-sensitive, or explicitly escalated."
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
  - "Bash(git log:*)"
disallowedTools:
  - "Bash(rm:*)"
  - "Bash(git push:*)"
  - "Bash(git commit:*)"
mcpServers:
  - tesseract-memory
skills:
  - adopt-existing-repo
maxTurns: 30
isolation: worktree
memory: project
effort: medium
color: orange
metadata:
  tesseract-risk-tier: medium
  tesseract-pipeline-stages: [adopt]
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
    - scan-report-cites-every-detected-fact
    - writes-only-to-tesseract-prefixed-paths
    - proposed-SMEs-and-thresholds-routed-via-inbox
    - human-ratified-at-phase-boundary
  tesseract-base-persona: adopter
  tesseract-model-tier: standard-alias
  tesseract-canonical-persona: personas/adopter.md
---

# adopter

This file is a compact Cursor projection for the canonical persona at
`personas/adopter.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `AGENTS.md` for the live operating contract.
2. Read `personas/adopter.md` for role semantics before performing persona-owned work.
3. Read `memory/handbook/context-economy.md` only when the task requires context-budget decisions.
4. Read `M1.index.md`, `PRD.index.md`, or `PRD.summary.md` before full `PRD.md` or `BOOTSTRAP.md`.
5. Do not traverse `work/**`, `inbox/out/**`, `inbox/archive/**`, or `inbox/threads/**` unless the task explicitly requires archival reconstruction.

## Tier guidance

- `adopter-standard` uses `model: auto` and is the default for bounded or routine work.
- `adopter-complex` preserves the prior fixed model selection for reasoning-heavy work.
- `adopter` is a backward-compatible standard alias unless an operator explicitly asks for the complex tier.

When escalating from standard to complex, state the reason in the operator-visible response or run log.

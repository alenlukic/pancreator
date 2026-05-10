---
name: contract-writer-standard
description: "Standard economical `contract-writer` subagent. Use for bounded, routine, or simple-task-mode work that should let Cursor auto-select an economical model."
model: auto
permissionMode: default
tools:
  - Read
  - Grep
  - Glob
  - Write
  - Edit
  - "Bash(tess lint contracts:*)"
  - "Bash(tess contracts:*)"
  - "Bash(git diff:*)"
  - "Bash(git status:*)"
disallowedTools:
  - "Bash(rm:*)"
  - "Bash(git push:*)"
  - "Bash(git commit:*)"
mcpServers:
  - tesseract-memory
skills:
  - author-contract
maxTurns: 120
isolation: worktree
memory: project
effort: medium
color: amber
metadata:
  tesseract-risk-tier: medium
  tesseract-pipeline-stages: [bootstrap-phase-2, intake, plan, review]
  tesseract-bootstrap-only: false
  tesseract-stability: experimental
  tesseract-handbook-anchors:
    - /memory/handbook/contract-format.md
    - /memory/handbook/contract-style.md
    - /memory/handbook/contract-templates/
    - /memory/handbook/glossary.md
  tesseract-allowed-kinds-mvp: [rego, llm-judge]
  tesseract-allowed-kinds-m2: [rego, llm-judge, playwright, schemathesis, axe]
  tesseract-allowed-kinds-m3plus: [rego, llm-judge, playwright, schemathesis, axe, semgrep, hypothesis, fast-check, ts-predicate, py-predicate]
  tesseract-checklist:
    - kind-in-allowed-set-for-current-milestone
    - applies-to-anchor-resolves
    - owner-persona-exists
    - severity-block-clauses-pass-layer-1-lint-clean
    - llm-judge-block-clauses-have-quorum-and-cost-ceiling
    - rego-clauses-have-OPA-METADATA-block
    - dual-anchor-citations-on-every-external-standard
    - template-slots-filled-not-improvised
  tesseract-base-persona: contract-writer
  tesseract-model-tier: standard
  tesseract-canonical-persona: personas/contract-writer.md
---

# contract-writer-standard

This file is a compact Cursor projection for the canonical persona at
`personas/contract-writer.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `AGENTS.md` for the live operating contract.
2. Read `personas/contract-writer.md` for role semantics before performing persona-owned work.
3. Read `memory/handbook/context-economy.md` only when the task requires context-budget decisions.
4. Read `M1.index.md`, `PRD.index.md`, or `PRD.summary.md` before full `PRD.md` or `BOOTSTRAP.md`.
5. Do not traverse `work/**`, `internal/work_archive/**`, `inbox/out/**`, `inbox/archive/**`, or `inbox/threads/**` unless the task explicitly requires active-run handling or archival reconstruction.

## Tier guidance

- `contract-writer-standard` uses `model: auto` and is the default for bounded or routine work.
- `contract-writer-complex` preserves the prior fixed model selection for reasoning-heavy work.
- `contract-writer` is a backward-compatible standard alias unless an operator explicitly asks for the complex tier.

When escalating from standard to complex, state the reason in the operator-visible response or run log.

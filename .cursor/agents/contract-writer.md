---
name: contract-writer
description: "Backward-compatible standard alias for `contract-writer-standard`. Use for routine contract-writer work; invoke `contract-writer-complex` when the task is ambiguous, cross-cutting, policy-sensitive, or explicitly escalated."
model: auto
permissionMode: default
tools:
  - Read
  - Grep
  - Glob
  - Write
  - Edit
  - "Bash(ddl lint contracts:*)"
  - "Bash(ddl contracts:*)"
  - "Bash(git diff:*)"
  - "Bash(git status:*)"
disallowedTools:
  - "Bash(rm:*)"
  - "Bash(git push:*)"
  - "Bash(git commit:*)"
mcpServers:
  - daedaline-memory
skills:
  - author-contract
maxTurns: 120
isolation: worktree
memory: project
effort: medium
color: amber
metadata:
  daedaline-risk-tier: medium
  daedaline-pipeline-stages: [bootstrap-phase-2, intake, plan, review]
  daedaline-bootstrap-only: false
  daedaline-stability: experimental
  daedaline-handbook-anchors:
    - /src/memory/handbook/contract-format.md
    - /src/memory/handbook/contract-style.md
    - /src/memory/handbook/contract-templates/
    - /src/memory/handbook/glossary.md
  daedaline-allowed-kinds-mvp: [rego, llm-judge]
  daedaline-allowed-kinds-m2: [rego, llm-judge, playwright, schemathesis, axe]
  daedaline-allowed-kinds-m3plus: [rego, llm-judge, playwright, schemathesis, axe, semgrep, hypothesis, fast-check, ts-predicate, py-predicate]
  daedaline-checklist:
    - kind-in-allowed-set-for-current-milestone
    - applies-to-anchor-resolves
    - owner-persona-exists
    - severity-block-clauses-pass-layer-1-lint-clean
    - llm-judge-block-clauses-have-quorum-and-cost-ceiling
    - rego-clauses-have-OPA-METADATA-block
    - dual-anchor-citations-on-every-external-standard
    - template-slots-filled-not-improvised
  daedaline-base-persona: contract-writer
  daedaline-model-tier: standard-alias
  daedaline-canonical-persona: src/personas/contract-writer.md
---

# contract-writer

This file is a compact Cursor projection for the canonical persona at
`src/personas/contract-writer.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `AGENTS.md` for the live operating contract.
2. Read `src/personas/contract-writer.md` for role semantics before performing persona-owned work.
3. Read `src/memory/handbook/context-economy.md` only when the task requires context-budget decisions.
4. Read `docs/M1.index.md`, `docs/PRD.index.md`, or `docs/PRD.summary.md` before full `docs/PRD.md` or `docs/BOOTSTRAP.md`.
5. Do not traverse `src/work/**`, `src/internal/work_archive/**`, `src/inbox/out/**`, `src/inbox/archive/**`, or `src/inbox/threads/**` unless the task explicitly requires active-run handling or archival reconstruction.

## Tier guidance

- `contract-writer-standard` is the default for bounded or routine work; its model is selected by the current frontmatter policy.
- `contract-writer-complex` preserves the prior fixed model selection for reasoning-heavy work.
- `contract-writer` is a backward-compatible standard alias unless an operator explicitly asks for the complex tier.

When escalating from standard to complex, state the reason in the operator-visible response or run log.

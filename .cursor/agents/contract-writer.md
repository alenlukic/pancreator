---
name: contract-writer
description: "Canonical `contract-writer` subagent projection for persona-owned pipeline stages."
model: auto
permissionMode: default
tools:
  - Read
  - Grep
  - Glob
  - Write
  - Edit
  - "Bash(pan lint contracts:*)"
  - "Bash(pan contracts:*)"
  - "Bash(git diff:*)"
  - "Bash(git status:*)"
disallowedTools:
  - "Bash(rm:*)"
  - "Bash(git push:*)"
  - "Bash(git commit:*)"
mcpServers:
  - pancreator-memory
skills:
  - author-contract
maxTurns: 120
isolation: worktree
memory: project
effort: medium
color: amber
metadata:
  pancreator-risk-tier: medium
  pancreator-pipeline-stages: [bootstrap-phase-2, intake, plan, review]
  pancreator-bootstrap-only: false
  pancreator-stability: experimental
  pancreator-handbook-anchors:
    - /lib/memory/handbook/contract-format.md
    - /lib/memory/handbook/contract-style.md
    - /lib/memory/handbook/contract-templates/
    - /lib/memory/handbook/glossary.md
  pancreator-allowed-kinds-mvp: [rego, llm-judge]
  pancreator-allowed-kinds-m2: [rego, llm-judge, playwright, schemathesis, axe]
  pancreator-allowed-kinds-m3plus: [rego, llm-judge, playwright, schemathesis, axe, semgrep, hypothesis, fast-check, ts-predicate, py-predicate]
  pancreator-checklist:
    - kind-in-allowed-set-for-current-milestone
    - applies-to-anchor-resolves
    - owner-persona-exists
    - severity-block-clauses-pass-layer-1-lint-clean
    - llm-judge-block-clauses-have-quorum-and-cost-ceiling
    - rego-clauses-have-OPA-METADATA-block
    - dual-anchor-citations-on-every-external-standard
    - template-slots-filled-not-improvised
  pancreator-base-persona: contract-writer
  pancreator-model-tier: canonical
  pancreator-canonical-persona: lib/personas/contract-writer.md
---

# contract-writer

This file is the canonical Cursor projection for `contract-writer` at `lib/personas/contract-writer.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `AGENTS.md` for the live operating contract.
2. Read `lib/personas/contract-writer.md` for role semantics before performing persona-owned work.
3. Read `lib/memory/handbook/context-economy.md` only when the task requires context-budget decisions.
4. Read `docs/M1.index.md`, `docs/PRD.index.md`, or `docs/PRD.summary.md` before full `docs/PRD.md` or `docs/BOOTSTRAP.md`.
5. Do not traverse `work/**`, `archive/work/**`, `lib/inbox/out/**`, `archive/inbox/**`, or `lib/inbox/threads/**` unless the task explicitly requires active-run handling or archival reconstruction.



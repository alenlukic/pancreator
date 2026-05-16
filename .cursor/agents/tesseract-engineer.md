---
name: tesseract-engineer
description: "Backward-compatible standard alias for `tesseract-engineer-standard`. Use for routine tesseract-engineer work; invoke `tesseract-engineer-complex` when the task is ambiguous, cross-cutting, policy-sensitive, or explicitly escalated."
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
  - "Bash(pnpm lint:*)"
  - "Bash(pnpm test:*)"
  - "Bash(pnpm build:*)"
  - "Bash(pnpm typecheck:*)"
disallowedTools:
  - "Bash(rm:*)"
  - "Bash(git push:*)"
  - "Bash(git commit:*)"
  - "Bash(git reset:*)"
  - "Bash(git checkout:*)"
mcpServers: []
skills: []
maxTurns: 40
isolation: worktree
memory: project
effort: medium
color: green
metadata:
  tesseract-risk-tier: medium
  tesseract-pipeline-stages: [internal-engineering, compliance-remediation]
  tesseract-bootstrap-only: false
  tesseract-stability: experimental
  tesseract-handbook-anchors:
    - /src/memory/handbook/glossary.md
    - /src/memory/handbook/persona-spec.md
    - /src/memory/handbook/contract-format.md
    - /src/memory/handbook/documentation-impact-contract.md
  tesseract-checklist:
    - sixteen-field-yaml-complete
    - description-uses-EARS
    - tools-allowlist-minimal
    - mdc-shim-emitted-and-round-trips
    - layer-1-lint-clean
    - non-contract-inputs-normalized-via-contract-writer
    - prose-ambiguity-resolved-before-execution
    - execution-limited-to-tesseract-internal-corpus
    - docs-impact-evaluated-every-task
    - no-push-no-destructive-git
  tesseract-base-persona: tesseract-engineer
  tesseract-model-tier: standard-alias
  tesseract-canonical-persona: src/personas/tesseract-engineer.md
---

# tesseract-engineer

This file is a compact Cursor projection for the canonical persona at
`src/personas/tesseract-engineer.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `AGENTS.md` for the live operating contract.
2. Read `src/personas/tesseract-engineer.md` for role semantics before performing persona-owned work.
3. Read `src/memory/handbook/context-economy.md` only when the task requires context-budget decisions.
4. Read `docs/M1.index.md`, `docs/PRD.index.md`, or `docs/PRD.summary.md` before full `docs/PRD.md` or `docs/BOOTSTRAP.md`.
5. Do not traverse `src/work/**`, `src/internal/work_archive/**`, `src/inbox/out/**`, `src/inbox/archive/**`, or `src/inbox/threads/**` unless the task explicitly requires active-run handling or archival reconstruction.

## Tier guidance

- `tesseract-engineer-standard` is the default for bounded or routine work; its model is selected by the current frontmatter policy.
- `tesseract-engineer-complex` preserves the prior fixed model selection for reasoning-heavy work.
- `tesseract-engineer` is a backward-compatible standard alias unless an operator explicitly asks for the complex tier.

When escalating from standard to complex, state the reason in the operator-visible response or run log.

---
name: tesseract-engineer-complex
description: "Complex high-effort `tesseract-engineer` subagent. Use only when standard mode is insufficient: ambiguous architecture, policy/compliance reasoning, broad repo audit, historical reconstruction, or high-risk cross-cutting work."
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
effort: high
color: green
metadata:
  tesseract-risk-tier: medium
  tesseract-pipeline-stages: [internal-engineering, compliance-remediation]
  tesseract-bootstrap-only: false
  tesseract-stability: experimental
  tesseract-handbook-anchors:
    - /memory/handbook/glossary.md
    - /memory/handbook/persona-spec.md
    - /memory/handbook/contract-format.md
    - /memory/handbook/documentation-impact-contract.md
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
  tesseract-model-tier: complex
  tesseract-canonical-persona: personas/tesseract-engineer.md
---

# tesseract-engineer-complex

This file is a compact Cursor projection for the canonical persona at
`personas/tesseract-engineer.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `AGENTS.md` for the live operating contract.
2. Read `personas/tesseract-engineer.md` for role semantics before performing persona-owned work.
3. Read `memory/handbook/context-economy.md` only when the task requires context-budget decisions.
4. Read `M1.index.md`, `PRD.index.md`, or `PRD.summary.md` before full `PRD.md` or `BOOTSTRAP.md`.
5. Do not traverse `work/**`, `internal/work_archive/**`, `inbox/out/**`, `inbox/archive/**`, or `inbox/threads/**` unless the task explicitly requires active-run handling or archival reconstruction.

## Tier guidance

- `tesseract-engineer-standard` uses `model: auto` and is the default for bounded or routine work.
- `tesseract-engineer-complex` preserves the prior fixed model selection for reasoning-heavy work.
- `tesseract-engineer` is a backward-compatible standard alias unless an operator explicitly asks for the complex tier.

When escalating from standard to complex, state the reason in the operator-visible response or run log.

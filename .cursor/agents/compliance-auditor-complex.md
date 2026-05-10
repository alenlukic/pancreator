---
name: compliance-auditor-complex
description: "Complex high-effort `compliance-auditor` subagent. Use only when standard mode is insufficient: ambiguous architecture, policy/compliance reasoning, broad repo audit, historical reconstruction, or high-risk cross-cutting work."
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
  - "Bash(tess lint contracts:*)"
disallowedTools:
  - "Bash(rm:*)"
  - "Bash(git push:*)"
  - "Bash(git commit:*)"
  - "Bash(git reset:*)"
  - "Bash(git checkout:*)"
mcpServers: []
skills:
  - modern-code-review
maxTurns: 30
isolation: worktree
memory: project
effort: high
color: red
metadata:
  tesseract-risk-tier: medium
  tesseract-pipeline-stages: [compliance-audit]
  tesseract-bootstrap-only: false
  tesseract-stability: experimental
  tesseract-handbook-anchors:
    - /memory/handbook/glossary.md
    - /memory/handbook/persona-spec.md
    - /memory/handbook/contract-style.md
    - /memory/handbook/contract-format.md
    - /memory/handbook/documentation-impact-contract.md
    - /memory/handbook/policy-compliance-contract.md
    - /memory/handbook/run-log-schema.md
  tesseract-checklist:
    - sixteen-field-yaml-complete
    - description-uses-EARS
    - tools-allowlist-minimal
    - mdc-shim-emitted-and-round-trips
    - layer-1-lint-clean
    - docs-impact-evaluated-every-task
    - dual-anchor-citations-on-findings
    - remediation-limited-to-safe-local-fixes
    - no-push-no-destructive-git
    - focused-mode-respects-run-log-scope
  tesseract-base-persona: compliance-auditor
  tesseract-model-tier: complex
  tesseract-canonical-persona: personas/compliance-auditor.md
---

# compliance-auditor-complex

This file is a compact Cursor projection for the canonical persona at
`personas/compliance-auditor.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `AGENTS.md` for the live operating contract.
2. Read `personas/compliance-auditor.md` for role semantics before performing persona-owned work.
3. Read `memory/handbook/context-economy.md` only when the task requires context-budget decisions.
4. Read `M1.index.md`, `PRD.index.md`, or `PRD.summary.md` before full `PRD.md` or `BOOTSTRAP.md`.
5. Do not traverse `work/**`, `inbox/out/**`, `inbox/archive/**`, or `inbox/threads/**` unless the task explicitly requires archival reconstruction.

## Tier guidance

- `compliance-auditor-standard` uses `model: auto` and is the default for bounded or routine work.
- `compliance-auditor-complex` preserves the prior fixed model selection for reasoning-heavy work.
- `compliance-auditor` is a backward-compatible standard alias unless an operator explicitly asks for the complex tier.

When escalating from standard to complex, state the reason in the operator-visible response or run log.

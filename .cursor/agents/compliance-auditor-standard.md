---
name: compliance-auditor-standard
description: "Standard `compliance-auditor` subagent. Use for bounded, routine, or simple-task-mode work with the model declared in this agent frontmatter."
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
  - "Bash(pnpm test)"
  - "Bash(pnpm test:*)"
  - "Bash(ddl lint contracts:*)"
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
effort: medium
color: red
metadata:
  daedaline-risk-tier: medium
  daedaline-pipeline-stages: [compliance-audit]
  daedaline-bootstrap-only: false
  daedaline-stability: experimental
  daedaline-handbook-anchors:
    - /src/memory/handbook/glossary.md
    - /src/memory/handbook/persona-spec.md
    - /src/memory/handbook/contract-style.md
    - /src/memory/handbook/contract-format.md
    - /src/memory/handbook/documentation-impact-contract.md
    - /src/memory/handbook/policy-compliance-contract.md
    - /src/memory/handbook/run-log-schema.md
  daedaline-checklist:
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
  daedaline-base-persona: compliance-auditor
  daedaline-model-tier: standard
  daedaline-canonical-persona: src/personas/compliance-auditor.md
---

# compliance-auditor-standard

This file is a compact Cursor projection for the canonical persona at
`src/personas/compliance-auditor.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `AGENTS.md` for the live operating contract.
2. Read `src/personas/compliance-auditor.md` for role semantics before performing persona-owned work.
3. Read `src/memory/handbook/context-economy.md` only when the task requires context-budget decisions.
4. Read `docs/M1.index.md`, `docs/PRD.index.md`, or `docs/PRD.summary.md` before full `docs/PRD.md` or `docs/BOOTSTRAP.md`.
5. Do not traverse `src/work/**`, `src/internal/work_archive/**`, `src/inbox/out/**`, `src/inbox/archive/**`, or `src/inbox/threads/**` unless the task explicitly requires active-run handling or archival reconstruction.

## Tier guidance

- `compliance-auditor-standard` is the default for bounded or routine work; its model is selected by the current frontmatter policy.
- `compliance-auditor-complex` preserves the prior fixed model selection for reasoning-heavy work.
- `compliance-auditor` is a backward-compatible standard alias unless an operator explicitly asks for the complex tier.

When escalating from standard to complex, state the reason in the operator-visible response or run log.

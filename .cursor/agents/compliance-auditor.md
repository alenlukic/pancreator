---
name: compliance-auditor
description: "Canonical `compliance-auditor` subagent projection for persona-owned pipeline stages."
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
  - "Bash(pan lint contracts:*)"
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
  pancreator-risk-tier: medium
  pancreator-pipeline-stages: [compliance-audit]
  pancreator-bootstrap-only: false
  pancreator-stability: experimental
  pancreator-handbook-anchors:
    - /lib/memory/handbook/glossary.md
    - /lib/memory/handbook/persona-spec.md
    - /lib/memory/handbook/contract-style.md
    - /lib/memory/handbook/contract-format.md
    - /lib/memory/handbook/documentation-impact-contract.md
    - /lib/memory/handbook/policy-compliance-contract.md
    - /lib/memory/handbook/run-log-schema.md
  pancreator-checklist:
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
  pancreator-base-persona: compliance-auditor
  pancreator-model-tier: canonical
  pancreator-canonical-persona: lib/personas/compliance-auditor.md
---

# compliance-auditor

This file is the canonical Cursor projection for `compliance-auditor` at `lib/personas/compliance-auditor.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `AGENTS.md` for the live operating contract.
2. Read `lib/personas/compliance-auditor.md` for role semantics before performing persona-owned work.
3. Read `lib/memory/handbook/context-economy.md` only when the task requires context-budget decisions.
4. Read `docs/M1.index.md`, `docs/PRD.index.md`, or `docs/PRD.summary.md` before full `docs/PRD.md` or `docs/BOOTSTRAP.md`.
5. Do not traverse `work/**`, `archive/work/**`, `lib/inbox/out/**`, `archive/inbox/**`, or `lib/inbox/threads/**` unless the task explicitly requires active-run handling or archival reconstruction.



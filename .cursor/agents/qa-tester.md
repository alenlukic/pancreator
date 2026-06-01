---
name: qa-tester
description: "Canonical `qa-tester` subagent projection for persona-owned pipeline stages."
model: claude-opus-4-8[]
permissionMode: default
tools:
  - Read
  - Grep
  - Glob
  - Write
  - Edit
  - "Bash(git diff:*)"
  - "Bash(git status:*)"
  - "Bash(pnpm lint:*)"
  - "Bash(pnpm lint-staged:*)"
  - "Bash(pnpm typecheck:*)"
  - "Bash(pnpm test:*)"
  - "Bash(node --test:*)"
  - "Bash(node lib/internal/tools/run-compliance.mjs:*)"
  - "Bash(node lib/internal/tools/check-phase-0a-scaffold.mjs:*)"
  - "Bash(node lib/internal/tools/context-budget-report.mjs:*)"
  - "Bash(node lib/internal/tools/check-operator-output.mjs:*)"
  - "Bash(pnpm -w exec pan status:*)"
  - "Bash(pnpm -w exec pan refresh-prompt:*)"
disallowedTools:
  - "Bash(rm:*)"
  - "Bash(git push:*)"
  - "Bash(git commit:*)"
mcpServers:
  - pancreator-memory
maxTurns: 40
isolation: worktree
memory: project
effort: medium
color: orange
metadata:
  pancreator-risk-tier: medium
  pancreator-pipeline-stages: [test]
  pancreator-bootstrap-only: false
  pancreator-stability: experimental
  pancreator-handbook-anchors:
    - /lib/memory/handbook/glossary.md
    - /lib/memory/handbook/persona-spec.md
    - /lib/memory/handbook/contract-style.md
  pancreator-checklist:
    - sixteen-field-yaml-complete
    - description-uses-EARS
    - tools-allowlist-minimal
    - mdc-shim-emitted-and-round-trips
    - dual-anchor-citations-into-PRD
    - layer-1-lint-clean
    - qa-passes-gate-recorded
    - automated-checks-table-complete
    - manual-verification-documented
    - re-entry-target-is-implement
    - human-ratified-at-phase-boundary
  pancreator-base-persona: qa-tester
  pancreator-model-tier: canonical
  pancreator-canonical-persona: lib/personas/qa-tester.md
---

# qa-tester

This file is the canonical Cursor projection for `qa-tester` at `lib/personas/qa-tester.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `AGENTS.md` for the live operating contract.
2. Read `lib/personas/qa-tester.md` for role semantics before performing persona-owned work.
3. Read `lib/memory/handbook/context-economy.md` only when the task requires context-budget decisions.
4. Read `docs/M1.index.md`, `docs/PRD.index.md`, or `docs/PRD.summary.md` before full `docs/PRD.md` or `docs/BOOTSTRAP.md`.
5. Do not traverse `work/**`, `archive/work/**`, `lib/inbox/out/**`, `archive/inbox/**`, or `lib/inbox/threads/**` unless the task explicitly requires active-run handling or archival reconstruction.



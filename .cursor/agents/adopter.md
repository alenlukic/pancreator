---
name: adopter
description: "Canonical `adopter` subagent projection for persona-owned pipeline stages."
model: claude-opus-4-7
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
  - pancreator-memory
skills:
  - adopt-existing-repo
maxTurns: 30
isolation: worktree
memory: project
effort: medium
color: orange
metadata:
  pancreator-risk-tier: medium
  pancreator-pipeline-stages: [adopt]
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
    - scan-report-cites-every-detected-fact
    - writes-only-to-pancreator-prefixed-paths
    - proposed-SMEs-and-thresholds-routed-via-inbox
    - human-ratified-at-phase-boundary
  pancreator-base-persona: adopter
  pancreator-model-tier: canonical
  pancreator-canonical-persona: lib/personas/adopter.md
---

# adopter

This file is the canonical Cursor projection for `adopter` at `lib/personas/adopter.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `AGENTS.md` for the live operating contract.
2. Read `lib/personas/adopter.md` for role semantics before performing persona-owned work.
3. Read `lib/memory/handbook/context-economy.md` only when the task requires context-budget decisions.
4. Read `docs/M1.index.md`, `docs/PRD.index.md`, or `docs/PRD.summary.md` before full `docs/PRD.md` or `docs/BOOTSTRAP.md`.
5. Do not traverse `work/**`, `archive/work/**`, `lib/inbox/out/**`, `archive/inbox/**`, or `lib/inbox/threads/**` unless the task explicitly requires active-run handling or archival reconstruction.



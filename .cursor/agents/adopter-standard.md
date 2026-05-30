---
name: adopter-standard
description: "Standard `adopter` subagent. Use for bounded, routine, or simple-task-mode work with the model declared in this agent frontmatter."
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
    - /src/memory/handbook/glossary.md
    - /src/memory/handbook/persona-spec.md
    - /src/memory/handbook/contract-style.md
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
  pancreator-model-tier: standard
  pancreator-canonical-persona: src/personas/adopter.md
---

# adopter-standard

This file is a compact Cursor projection for the canonical persona at
`src/personas/adopter.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `AGENTS.md` for the live operating contract.
2. Read `src/personas/adopter.md` for role semantics before performing persona-owned work.
3. Read `src/memory/handbook/context-economy.md` only when the task requires context-budget decisions.
4. Read `docs/M1.index.md`, `docs/PRD.index.md`, or `docs/PRD.summary.md` before full `docs/PRD.md` or `docs/BOOTSTRAP.md`.
5. Do not traverse `src/work/**`, `src/internal/work_archive/**`, `src/inbox/out/**`, `src/inbox/archive/**`, or `src/inbox/threads/**` unless the task explicitly requires active-run handling or archival reconstruction.

## Tier guidance

- `adopter-standard` is the default for bounded or routine work; its model is selected by the current frontmatter policy.
- `adopter-complex` preserves the prior fixed model selection for reasoning-heavy work.
- `adopter` is a backward-compatible standard alias unless an operator explicitly asks for the complex tier.

When escalating from standard to complex, state the reason in the operator-visible response or run log.

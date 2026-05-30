---
name: librarian-complex
description: "Complex high-effort `librarian` subagent. Use only when standard mode is insufficient: ambiguous architecture, policy/compliance reasoning, broad repo audit, historical reconstruction, archive migration, or high-risk cross-cutting work."
model: gpt-5.5
permissionMode: default
tools:
  - Read
  - Grep
  - Glob
  - Write
  - Edit
  - "Bash(git diff:*)"
  - "Bash(git status:*)"
  - "Bash(mkdir:*)"
  - "Bash(mv:*)"
disallowedTools:
  - "Bash(rm:*)"
  - "Bash(git push:*)"
  - "Bash(git commit:*)"
mcpServers:
  - pancreator-memory
skills:
  - write-adr
maxTurns: 30
isolation: worktree
memory: project
effort: medium
color: teal
metadata:
  pancreator-risk-tier: low
  pancreator-pipeline-stages: [index_artifacts, archive_completed_work, update_feature_index, update_backlog, knowledge-curation]
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
    - feature-index-updated-on-every-post-run
    - completed-work-archived-after-report-stage
    - stale-citation-report-emitted-each-cron-run
    - every-claim-carries-dual-anchor-citation
    - human-ratified-at-phase-boundary
  pancreator-base-persona: librarian
  pancreator-model-tier: complex
  pancreator-canonical-persona: src/personas/librarian.md
---

# librarian-complex

This file is a compact Cursor projection for the canonical persona at
`src/personas/librarian.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `AGENTS.md` for the live operating contract.
2. Read `src/personas/librarian.md` for role semantics before performing persona-owned work.
3. Read `src/memory/handbook/context-economy.md` only when the task requires context-budget decisions.
4. Read `docs/M1.index.md`, `docs/PRD.index.md`, or `docs/PRD.summary.md` before full `docs/PRD.md` or `docs/BOOTSTRAP.md`.
5. Do not traverse `src/work/**`, `src/internal/work_archive/**`, `src/inbox/out/**`, `src/inbox/archive/**`, or `src/inbox/threads/**` unless the task explicitly requires active-run handling, completed-work archival, or historical reconstruction.

## Tier guidance

- `librarian-standard` is the default for bounded or routine work; its model is selected by the current frontmatter policy.
- `librarian-complex` preserves the prior fixed model selection for reasoning-heavy work.
- `librarian` is a backward-compatible standard alias unless an operator explicitly asks for the complex tier.

When escalating from standard to complex, state the reason in the operator-visible response or run log.

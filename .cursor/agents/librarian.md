---
name: librarian
description: "Canonical `librarian` subagent projection for persona-owned pipeline stages."
model: gpt-5.2-codex[]
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
    - feature-index-updated-on-every-post-run
    - completed-work-archived-after-report-stage
    - stale-citation-report-emitted-each-cron-run
    - every-claim-carries-dual-anchor-citation
    - human-ratified-at-phase-boundary
  pancreator-base-persona: librarian
  pancreator-model-tier: canonical
  pancreator-canonical-persona: lib/personas/librarian.md
---

# librarian

This file is the canonical Cursor projection for `librarian` at `lib/personas/librarian.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `AGENTS.md` for the live operating contract.
2. Read `lib/personas/librarian.md` for role semantics before performing persona-owned work.
3. Read `lib/memory/handbook/context-economy.md` only when the task requires context-budget decisions.
4. Read `docs/M1.index.md`, `docs/PRD.index.md`, or `docs/PRD.summary.md` before full `docs/PRD.md` or `docs/BOOTSTRAP.md`.
5. Do not traverse `work/**`, `archive/work/**`, `lib/inbox/out/**`, `archive/inbox/**`, or `lib/inbox/threads/**` unless the task explicitly requires active-run handling, completed-work archival, or historical reconstruction.



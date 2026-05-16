---
name: tech-lead-complex
description: "Complex high-effort `tech-lead` subagent. Use only when standard mode is insufficient: ambiguous architecture, policy/compliance reasoning, broad repo audit, historical reconstruction, or high-risk cross-cutting work."
model: gpt-5.5-medium
permissionMode: default
tools:
  - Read
  - Grep
  - Glob
  - Write
  - Edit
  - "Bash(git diff:*)"
  - "Bash(git status:*)"
disallowedTools:
  - "Bash(rm:*)"
  - "Bash(git push:*)"
  - "Bash(git commit:*)"
mcpServers:
  - tesseract-memory
skills:
  - write-adr
  - write-rfc
maxTurns: 30
isolation: worktree
memory: project
effort: high
color: cyan
metadata:
  tesseract-risk-tier: medium
  tesseract-pipeline-stages: [plan]
  tesseract-bootstrap-only: false
  tesseract-stability: experimental
  tesseract-color-suffix: cyan-200
  tesseract-handbook-anchors:
    - /src/memory/handbook/glossary.md
    - /src/memory/handbook/persona-spec.md
    - /src/memory/handbook/contract-style.md
    - /src/memory/handbook/contract-format.md
  tesseract-checklist:
    - sixteen-field-yaml-complete
    - description-uses-EARS
    - tools-allowlist-minimal
    - mdc-shim-emitted-and-round-trips
    - dual-anchor-citations-into-PRD
    - layer-1-lint-clean
    - plan-touchset-and-adr-draft-all-emitted
    - touch-set-resolves-against-repo-symbols
    - every-claim-carries-dual-anchor-citation
    - human-ratified-at-phase-boundary
  tesseract-base-persona: tech-lead
  tesseract-model-tier: complex
  tesseract-canonical-persona: src/personas/tech-lead.md
---

# tech-lead-complex

This file is a compact Cursor projection for the canonical persona at
`src/personas/tech-lead.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `AGENTS.md` for the live operating contract.
2. Read `src/personas/tech-lead.md` for role semantics before performing persona-owned work.
3. Read `src/memory/handbook/context-economy.md` only when the task requires context-budget decisions.
4. Read `docs/M1.index.md`, `docs/PRD.index.md`, or `docs/PRD.summary.md` before full `docs/PRD.md` or `docs/BOOTSTRAP.md`.
5. Do not traverse `src/work/**`, `src/internal/work_archive/**`, `src/inbox/out/**`, `src/inbox/archive/**`, or `src/inbox/threads/**` unless the task explicitly requires active-run handling or archival reconstruction.

## Tier guidance

- `tech-lead-standard` is the default for bounded or routine work; its model is selected by the current frontmatter policy.
- `tech-lead-complex` preserves the prior fixed model selection for reasoning-heavy work.
- `tech-lead` is a backward-compatible standard alias unless an operator explicitly asks for the complex tier.

When escalating from standard to complex, state the reason in the operator-visible response or run log.

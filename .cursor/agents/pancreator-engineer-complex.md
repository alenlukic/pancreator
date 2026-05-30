---
name: pancreator-engineer-complex
description: "Complex high-effort `pancreator-engineer` subagent. Use only when standard mode is insufficient: ambiguous architecture, policy/compliance reasoning, broad repo audit, historical reconstruction, or high-risk cross-cutting work."
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
  pancreator-risk-tier: medium
  pancreator-pipeline-stages: [internal-engineering, compliance-remediation]
  pancreator-bootstrap-only: false
  pancreator-stability: experimental
  pancreator-handbook-anchors:
    - /src/memory/handbook/glossary.md
    - /src/memory/handbook/persona-spec.md
    - /src/memory/handbook/contract-format.md
    - /src/memory/handbook/documentation-impact-contract.md
  pancreator-checklist:
    - sixteen-field-yaml-complete
    - description-uses-EARS
    - tools-allowlist-minimal
    - mdc-shim-emitted-and-round-trips
    - layer-1-lint-clean
    - non-contract-inputs-normalized-via-contract-writer
    - prose-ambiguity-resolved-before-execution
    - execution-limited-to-pancreator-internal-corpus
    - docs-impact-evaluated-every-task
    - no-push-no-destructive-git
  pancreator-base-persona: pancreator-engineer
  pancreator-model-tier: complex
  pancreator-canonical-persona: src/personas/pancreator-engineer.md
---

# pancreator-engineer-complex

This file is a compact Cursor projection for the canonical persona at
`src/personas/pancreator-engineer.md`. It intentionally avoids duplicating persona prose,
PRD citations, and handbook excerpts so Cursor subagent startup stays small.

## Retrieval contract

1. Read `AGENTS.md` for the live operating contract.
2. Read `src/personas/pancreator-engineer.md` for role semantics before performing persona-owned work.
3. Read `src/memory/handbook/context-economy.md` only when the task requires context-budget decisions.
4. Read `docs/M1.index.md`, `docs/PRD.index.md`, or `docs/PRD.summary.md` before full `docs/PRD.md` or `docs/BOOTSTRAP.md`.
5. Do not traverse `src/work/**`, `src/internal/work_archive/**`, `src/inbox/out/**`, `src/inbox/archive/**`, or `src/inbox/threads/**` unless the task explicitly requires active-run handling or archival reconstruction.

## Tier guidance

- `pancreator-engineer-standard` is the default for bounded or routine work; its model is selected by the current frontmatter policy.
- `pancreator-engineer-complex` preserves the prior fixed model selection for reasoning-heavy work.
- `pancreator-engineer` is a backward-compatible standard alias unless an operator explicitly asks for the complex tier.

When escalating from standard to complex, state the reason in the operator-visible response or run log.

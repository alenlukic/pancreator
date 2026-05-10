---
title: Context cost audit
slug: context-cost-audit
stability: experimental
bootstrap-only: false
phase: bootstrap
owners: [tesseract-engineer, supervisor]
purpose: |
  Current audit of likely Cursor token cost sinks and the practical controls
  this repository applies.
related:
  - /memory/handbook/context-economy.md
  - /memory/handbook/memory-tiers.md
  - /memory/handbook/subagent-model-tiers.md
  - /M1.index.md
---

# Context cost audit

This audit records likely token cost sinks in the current repository and the
controls used to reduce default load.

## Implemented controls

| Cost sink | Control |
|---|---|
| Full `PRD.md` and full `BOOTSTRAP.md` loaded for routing questions | Keep full files explicit-read by default; route through `PRD.summary.md`, `PRD.index.md`, and `M1.index.md`. |
| Active and archival execution artifacts under `work/**`, `internal/work_archive/**`, `inbox/out/**`, `inbox/archive/**`, and `inbox/threads/**` | Exclude from Cursor semantic indexing; require explicit active-run handling or historical-reconstruction trigger. |
| Human-only operator notes | Exclude `inbox/notes/**` from Cursor indexing and preserve AGENTS prohibition on agent traversal. |
| Cursor subagent projections duplicating canonical persona prose and PRD citations | Keep `.cursor/agents/**` compact and point to `personas/<name>.md` as canonical source. |
| Expensive fixed models used for every subagent invocation | Add standard/complex Cursor subagent variants; standard uses `model: auto`, complex preserves prior fixed model. |
| Generated machine artifacts | Exclude generated JSON, manifests, dry-run/write outputs, and lockfiles from default semantic indexing. |
| Broad handbook/persona sweeps | Treat internal operating content as routeable by handbook index, not default-loaded. |
| Operator-facing root clutter from implementation, tests, tools, and completed work | Move implementation surfaces to `internal/{packages,tests,tools}` and completed runs to `internal/work_archive/`; keep `work/` for active runs only. |

## Known risks

- Cursor may still add hidden tool schemas, open editors, chat history, or rule
  files outside this repository's direct control.
- `.cursor/agents/**` remains excluded from semantic indexing. Operators MUST
  verify custom agent discovery after changes.
- Full `PRD.md` and `BOOTSTRAP.md` remain explicitly readable. Agents MUST cite
  exact ranges when they rely on authoritative source wording.

## Manual validation

After this pass, operators SHOULD restart or reindex Cursor and run 3-5
comparable simple tasks. Compare cache-read totals against the recent post-pass
baseline of roughly 770K cache-read tokens.

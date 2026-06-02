---
title: Context cost audit
slug: context-cost-audit
stability: experimental
bootstrap-only: false
phase: bootstrap
owners: [pancreator-engineer, supervisor]
purpose: |
  Current audit of likely Cursor token cost sinks and the practical controls
  this repository applies.
related:
  - /lib/memory/handbook/context-economy.md
  - /lib/memory/handbook/memory-tiers.md
  - /docs/M1.index.md
---

# Context cost audit

This audit records likely token cost sinks in the current repository and the
controls used to reduce default load.

## Implemented controls

| Cost sink | Control |
|---|---|
| Full `docs/PRD.md` and full `docs/BOOTSTRAP.md` loaded for routing questions | Keep full files explicit-read by default; route through `docs/PRD.summary.md`, `docs/PRD.index.md`, and `docs/M1.index.md`. |
| Active and archival execution artifacts under `work/**`, `archive/work/**`, `lib/inbox/out/**`, `archive/inbox/**`, and `lib/inbox/threads/**` | Track `.cursorindexingignore`; exclude from Cursor semantic indexing; require explicit active-run handling or historical-reconstruction trigger. |
| Human-only operator notes | Exclude `lib/inbox/notes/**` from Cursor indexing and preserve AGENTS prohibition on agent traversal. |
| Cursor subagent projections duplicating canonical persona prose and PRD citations | Keep `.cursor/agents/**` compact and point to `lib/personas/<name>.md` as canonical source. |
| Expensive fixed models used for every subagent invocation | One canonical `.cursor/agents/<name>.md` per persona with economical default model policy; escalate model class per `context-economy.md` triggers. |
| Parent agents carrying planning, implementation, and review in one long context window | Add compact `handoff.md` cards, generated `next-prompt.md` stage prompts, and pointer-only `lib/memory/active/handoffs.md` so execution starts from bounded context. |
| Generated machine artifacts | Exclude generated JSON, manifests, dry-run/write outputs, and lockfiles from default semantic indexing. |
| Broad handbook/persona sweeps | Treat internal operating content as routeable by handbook index, not default-loaded. |
| Broad implementation rule triggers | Keep `coder.mdc` scoped to implementation packages, tests, tools, and explicit touch-set files instead of broad `lib/**/*` activation. |
| Operator-facing root clutter from implementation, tests, tools, and completed work | Move implementation surfaces to `lib/internal/packages/` and `lib/internal/tools/`, keep repository tests at root `tests/`, and move completed runs to `archive/work/`; keep `work/` for active runs only. |

## Known risks

- Cursor may still add hidden tool schemas, open editors, chat history, or rule
  files outside this repository's direct control.
- `.cursor/agents/**` remains excluded from semantic indexing. Operators MUST
  verify custom agent discovery after changes.
- Full `docs/PRD.md` and `docs/BOOTSTRAP.md` remain explicitly readable. Agents MUST cite
  exact ranges when they rely on authoritative source wording.

## Manual validation

After this pass, operators SHOULD restart or reindex Cursor and run 3-5
comparable simple tasks. Compare cache-read totals against the recent post-pass
baseline of roughly 770K cache-read tokens.

For **SDK local runs** on the synthetic tier fixture (token stream from `turn-ended`
events, not IDE cache-read), use the manual harness documented in
`tests/context-usage/README.md` (`pnpm run context:usage` / `context:usage:baseline`).

## Current failure mode

When `.cursorindexingignore` is absent, Cursor can re-index active work, archival
inbox artifacts, generated machine outputs, and subagent projections despite the
handbook policy. Operators SHOULD treat a missing root `.cursorindexingignore` as
a correctness bug, not just an optimization gap.

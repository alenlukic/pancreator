# Feature delivery handoff — us-1-dogfood-phase-4-exit

- Feature id: us-1-dogfood-phase-4-exit
- Task id: 20004_1826_us-1-dogfood-phase-4-exit
- Pipeline: feature-delivery
- Current stage: intake
- Executor persona: intake-analyst
- Source directive: src/inbox/in/us-1-dogfood-phase-4-exit.md
- State file: src/work/172990_05-16-26/20004_1826_us-1-dogfood-phase-4-exit/state.json
- Run log: src/work/172990_05-16-26/20004_1826_us-1-dogfood-phase-4-exit/run.log.jsonl
- Next prompt: src/work/172990_05-16-26/20004_1826_us-1-dogfood-phase-4-exit/next-prompt.md

## Stage contract

Input: src/inbox/in/us-1-dogfood-phase-4-exit.md
Output: src/memory/features/us-1-dogfood-phase-4-exit/spec.md
Advance after human ratification: pnpm -w exec tess advance 20004_1826_us-1-dogfood-phase-4-exit --artifact src/memory/features/us-1-dogfood-phase-4-exit/spec.md

## In-scope paths

- src/inbox/in/us-1-dogfood-phase-4-exit.md
- src/memory/features/us-1-dogfood-phase-4-exit/spec.md
- src/work/172990_05-16-26/20004_1826_us-1-dogfood-phase-4-exit/plan.md
- src/work/172990_05-16-26/20004_1826_us-1-dogfood-phase-4-exit/adr-draft.md
- src/work/172990_05-16-26/20004_1826_us-1-dogfood-phase-4-exit/touch-set.json
- src/work/172990_05-16-26/20004_1826_us-1-dogfood-phase-4-exit/implementation-report.md
- src/work/172990_05-16-26/20004_1826_us-1-dogfood-phase-4-exit/review.md
- src/memory/features/us-1-dogfood-phase-4-exit/delivery-report.md
- src/inbox/out/<timestamp>-us-1-dogfood-phase-4-exit-delivery-report.md

## Explicit non-goals

- Do not read or write src/inbox/notes/.
- Do not continue past a human gate without explicit ratification.
- Do not push, open a PR, or commit without the human operator.
- Do not carry planning context into implementation; use the stage prompt and named stage inputs.

## Validation commands

- node --test tests/*.test.mjs
- node src/internal/tools/check-phase-0a-scaffold.mjs
- node src/internal/tools/context-budget-report.mjs
- bash -n .cursor/hooks/enforce-policy-compliance.sh

## Re-entry rule

If scope changes, validation repeatedly fails, or the touch-set is incomplete, stop and delegate back to supervisor, tech-lead, or reviewer instead of extending the executor loop.

## Directive excerpt

```markdown
f---
title: US-1 Dogfood Phase 4 Exit
feature_id: us-1-dogfood-phase-4-exit
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-16T00:00:00Z
references:
  - kind: path
    path: docs/M1.index.md
    note: Phase 4 dogfood exit gaps remain open before Phase 5 M1 backlog work begins.
  - kind: path
    path: docs/BOOTSTRAP.md
    note: Phase 4 requires a real US-1 dogfood run, external run-log verification, pause/resume/abort exercise, and proof artifacts before exit.
  - kind: path
    path: AGENTS.md
    note: `src/inbox/in/` is the canonical incoming queue and phase boundaries require human ratification.
---

# US-1 Dogfood Phase 4 Exit
```

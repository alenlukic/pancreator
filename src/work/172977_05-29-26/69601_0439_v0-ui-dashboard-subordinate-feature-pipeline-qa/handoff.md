# Feature delivery handoff — v0-ui-dashboard-subordinate-feature-pipeline-qa

- Feature id: v0-ui-dashboard-subordinate-feature-pipeline-qa
- Task id: 69601_0439_v0-ui-dashboard-subordinate-feature-pipeline-qa
- Pipeline: feature-delivery
- Current stage: intake
- Executor persona: intake-analyst
- Source directive: src/inbox/in/172977_05-29-26/70345_0427_v0-ui-dashboard-subordinate-feature-pipeline-qa.md
- State file: src/work/172977_05-29-26/69601_0439_v0-ui-dashboard-subordinate-feature-pipeline-qa/state.json
- Run log: src/work/172977_05-29-26/69601_0439_v0-ui-dashboard-subordinate-feature-pipeline-qa/run.log.jsonl
- Next prompt: src/work/172977_05-29-26/69601_0439_v0-ui-dashboard-subordinate-feature-pipeline-qa/next-prompt.md

## Stage contract

Input: src/inbox/in/172977_05-29-26/70345_0427_v0-ui-dashboard-subordinate-feature-pipeline-qa.md
Output: src/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/spec.md
Advance after human ratification: pnpm -w exec pan advance 69601_0439_v0-ui-dashboard-subordinate-feature-pipeline-qa --artifact src/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/spec.md

## In-scope paths

- src/inbox/in/172977_05-29-26/70345_0427_v0-ui-dashboard-subordinate-feature-pipeline-qa.md
- src/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/spec.md
- src/work/172977_05-29-26/69601_0439_v0-ui-dashboard-subordinate-feature-pipeline-qa/plan.md
- src/work/172977_05-29-26/69601_0439_v0-ui-dashboard-subordinate-feature-pipeline-qa/adr-draft.md
- src/work/172977_05-29-26/69601_0439_v0-ui-dashboard-subordinate-feature-pipeline-qa/touch-set.json
- src/work/172977_05-29-26/69601_0439_v0-ui-dashboard-subordinate-feature-pipeline-qa/implementation-report.md
- src/work/172977_05-29-26/69601_0439_v0-ui-dashboard-subordinate-feature-pipeline-qa/review.md
- src/work/172977_05-29-26/69601_0439_v0-ui-dashboard-subordinate-feature-pipeline-qa/test-report.md
- src/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/delivery-report.md
- src/inbox/out/<timestamp>-v0-ui-dashboard-subordinate-feature-pipeline-qa-delivery-report.md

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
---
title: "v0-ui-dashboard-subordinate-feature-pipeline-qa"
feature_id: "v0-ui-dashboard-subordinate-feature-pipeline-qa"
stage: intake
owner: "intake-analyst"
status: open
created_at: "2026-05-29T04:27:34.273Z"
references: []
---

# v0-ui-dashboard-subordinate-feature-pipeline-qa

## Problem

The parent feature `feature-delivery-harness-wire-cursorrunner-through-run-and-advance`
needs QA evidence that the automated feature-delivery runner/harness can execute a realistic
subordinate directive without falsely classifying expected artifacts as worktree-hygiene
violations.

## Goal
```

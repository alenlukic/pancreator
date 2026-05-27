# Feature delivery handoff — m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo

- Feature id: m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo
- Task id: 72829_0346_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo
- Pipeline: feature-delivery
- Current stage: intake
- Executor persona: intake-analyst
- Source directive: src/inbox/in/172980_05-26-26/2597_2316_m1-substrate-runtime-batch.md
- State file: src/work/172979_05-27-26/72829_0346_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/state.json
- Run log: src/work/172979_05-27-26/72829_0346_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/run.log.jsonl
- Next prompt: src/work/172979_05-27-26/72829_0346_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/next-prompt.md

## Stage contract

Input: src/inbox/in/172980_05-26-26/2597_2316_m1-substrate-runtime-batch.md
Output: src/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/spec.md
Advance after human ratification: pnpm -w exec tess advance 72829_0346_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo --artifact src/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/spec.md

## In-scope paths

- src/inbox/in/172980_05-26-26/2597_2316_m1-substrate-runtime-batch.md
- src/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/spec.md
- src/work/172979_05-27-26/72829_0346_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/plan.md
- src/work/172979_05-27-26/72829_0346_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/adr-draft.md
- src/work/172979_05-27-26/72829_0346_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/touch-set.json
- src/work/172979_05-27-26/72829_0346_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/implementation-report.md
- src/work/172979_05-27-26/72829_0346_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/review.md
- src/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/delivery-report.md
- src/inbox/out/<timestamp>-m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo-delivery-report.md

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
title: M1 substrate runtime batch — harness loop, install paths, library mode, Phoenix conformance
feature_id: m1-substrate-runtime-batch
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-26T23:16:42Z
references:
  - kind: path
    path: docs/PRD.md
    note: §3.5 US-8 (library mode), US-9 (install paths); §10–§11 (LangGraph conformance, run logs, checkpointer); §11 M1 MVP scope.
  - kind: path
    path: docs/BOOTSTRAP.md
    note: Phase 3 substrate steps and BR4 (runner-cursor closes hand-orchestrated → pipeline-driven gap); Phase 5 on-real-targets work.
  - kind: path
    path: src/inbox/in/172981_05-25-26/
    note: Source bucket for the six consolidated directives (64495–64500).
  - kind: path
    path: src/inbox/archive/in/172981_05-25-26/22411_1746_cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref/64488_0605_cli-operator-tooling-batch.md
    note: Prior consolidated-batch intake pattern for multi-package delivery.
```

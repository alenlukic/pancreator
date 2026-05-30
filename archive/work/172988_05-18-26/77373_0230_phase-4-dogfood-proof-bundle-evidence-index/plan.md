# Plan: Phase 4 Dogfood Proof Bundle Evidence Index

## Architecture summary

This run SHALL execute one real nested `feature-delivery` pipeline for task `77373_0230_phase-4-dogfood-proof-bundle-evidence-index` and preserve auditable artifacts from intake through index under `work/172988_05-18-26/77373_0230_phase-4-dogfood-proof-bundle-evidence-index/`. The implement stage MUST update only `lib/memory/features/us-1-dogfood-phase-4-exit/phase-4-proof-bundle.md` within the `us-1-dogfood-phase-4-exit` folder, replacing `_pending_` placeholders with this task id and fixed run-log path `work/172988_05-18-26/77373_0230_phase-4-dogfood-proof-bundle-evidence-index/run.log.jsonl`; Phoenix import and ratification evidence remain required acceptance gates after stage artifacts exist. `{kind: lines, path: lib/inbox/in/phase-4-dogfood-proof-bundle-index.md, range: [48, 51], contentHash: ccf9748cc364505754017e9d57ad777e9bd90e78ecfffe3222a64733049ac76c}` `{kind: lines, path: lib/memory/features/us-1-dogfood-phase-4-exit/phase-4-proof-bundle.md, range: [7, 15], contentHash: d6dc74c48b595edd3d9bd0f9b7bb43de358324eaaf7002237417e9987372ea82}`

## Plan-stage decisions

1. The executor SHALL treat the nested task id and run-log path as immutable identifiers and SHALL not rename or relocate them.
2. The implementation touch-set SHALL include only `lib/memory/features/us-1-dogfood-phase-4-exit/phase-4-proof-bundle.md` under the `us-1` feature tree.
3. The run SHALL produce at least one auditable artifact for each of the seven ordered stages: intake, plan, implement, review, report, ship, and index.
4. Phoenix import and trace-evidence recording SHALL be tracked as mandatory post-artifact acceptance work and SHALL NOT be simulated.

## Implementation tasks

1. Read `lib/memory/features/phase-4-dogfood-proof-bundle-evidence-index/spec.md` and this stage touch-set, then stage a bounded implementation report in `work/172988_05-18-26/77373_0230_phase-4-dogfood-proof-bundle-evidence-index/implementation-report.md`.
2. Update `lib/memory/features/us-1-dogfood-phase-4-exit/phase-4-proof-bundle.md` so every `_pending_` placeholder for this nested run is replaced by task id `77373_0230_phase-4-dogfood-proof-bundle-evidence-index` and `work/172988_05-18-26/77373_0230_phase-4-dogfood-proof-bundle-evidence-index/run.log.jsonl`.
3. Ensure work-directory artifacts for implement and later stages are preserved in place, including `implementation-report.md`, `review.md`, and subsequent stage artifacts required for report, ship, and index closure.
4. Keep non-goal boundaries explicit: do not start Phase 5 backlog work, do not redefine Phase 4 exit criteria, and do not claim simulated telemetry as acceptable evidence.
5. Record any validation outcomes and unresolved blockers in stage artifacts so reviewer and ship owners can audit acceptance-criteria coverage.

## Stage-artifact expectations by pipeline stage

- Intake: canonical spec remains the source of truth.
- Plan: `plan.md`, `adr-draft.md`, `touch-set.json`, and updated `handoff.md`.
- Implement: `implementation-report.md` plus proof-bundle update.
- Review: `review.md` with acceptance checks and findings.
- Report: `lib/memory/features/phase-4-dogfood-proof-bundle-evidence-index/delivery-report.md`.
- Ship: staged delivery artifact copy under `lib/inbox/out/`.
- Index: feature index update and final closure artifacts for the nested run.

## Required citations

- Stage progression and per-stage auditable artifact requirement: `{kind: lines, path: lib/inbox/in/phase-4-dogfood-proof-bundle-index.md, range: [48, 48], contentHash: ccf9748cc364505754017e9d57ad777e9bd90e78ecfffe3222a64733049ac76c}`.
- Implement-stage proof-bundle update requirement: `{kind: lines, path: lib/inbox/in/phase-4-dogfood-proof-bundle-index.md, range: [43, 43], contentHash: ccf9748cc364505754017e9d57ad777e9bd90e78ecfffe3222a64733049ac76c}`.
- Phoenix and ratification acceptance gates: `{kind: lines, path: lib/inbox/in/phase-4-dogfood-proof-bundle-index.md, range: [50, 51], contentHash: ccf9748cc364505754017e9d57ad777e9bd90e78ecfffe3222a64733049ac76c}`.
- Parent feature gate this nested run satisfies: `{kind: lines, path: lib/memory/features/us-1-dogfood-phase-4-exit/spec.md, range: [131, 151], contentHash: 8796dd7d32f015073e2d95484a5dda802809c2109f82091bf892159bf551f360}`.

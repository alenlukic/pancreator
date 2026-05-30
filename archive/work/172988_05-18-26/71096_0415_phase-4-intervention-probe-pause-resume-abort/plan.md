# Plan: Phase 4 Intervention Probe (Pause, Resume, Abort)

## Architecture summary

This run SHALL execute one real nested `feature-delivery` workflow for task `71096_0415_phase-4-intervention-probe-pause-resume-abort`, stop at a live `plan` stage, and preserve auditable state transitions for `pause`, `resume`, and `abort` before any implement-stage execution begins. The implement stage MUST produce structured intervention evidence at `lib/memory/features/us-1-dogfood-phase-4-exit/pause-resume-abort-evidence.json` and MUST update `lib/memory/features/us-1-dogfood-phase-4-exit/phase-4-proof-bundle.md` so the evidence path is discoverable from the Phase 4 proof index. `{kind: lines, path: lib/memory/features/phase-4-intervention-probe-pause-resume-abort/spec.md, range: [66, 77], contentHash: 970e45fb321244d98ddde62ee2ca1f9fa05f264b5b6ce84aace2470ec2f00f5b}` `{kind: lines, path: lib/memory/features/phase-4-intervention-probe-pause-resume-abort/spec.md, range: [103, 132], contentHash: 970e45fb321244d98ddde62ee2ca1f9fa05f264b5b6ce84aace2470ec2f00f5b}` `{kind: lines, path: lib/memory/features/us-1-dogfood-phase-4-exit/spec.md, range: [208, 232], contentHash: 8796dd7d32f015073e2d95484a5dda802809c2109f82091bf892159bf551f360}`

## Plan-stage decisions

1. The executor SHALL treat `pause -> resume -> abort` as a strict sequence and SHALL NOT perform implementation changes before abort evidence is complete.
2. The executor SHALL capture before/after state snapshots for each CLI intervention and SHALL cite matching `run.log.jsonl` event identifiers in the evidence record.
3. The implementation touch-set SHALL allow writes under `lib/memory/features/us-1-dogfood-phase-4-exit/` only for `pause-resume-abort-evidence.json` and `phase-4-proof-bundle.md`.
4. The run SHALL preserve stage-local artifacts for implement, review, report, and ship so ratification can audit every acceptance criterion with path-level traceability.

## Implementation tasks

1. Read the feature spec and touch-set, then create `implementation-report.md` that states how each acceptance criterion maps to concrete evidence fields and run-log citations. `{kind: lines, path: lib/memory/features/phase-4-intervention-probe-pause-resume-abort/spec.md, range: [79, 113], contentHash: 970e45fb321244d98ddde62ee2ca1f9fa05f264b5b6ce84aace2470ec2f00f5b}`
2. When the run is at live `plan`, record snapshots immediately before and after `pan pause`, `pan resume`, and `pan abort --reason <text>` and preserve the snapshot paths in task artifacts. `{kind: lines, path: lib/inbox/in/phase-4-intervention-probe.md, range: [39, 43], contentHash: 970e45fb321244d98ddde62ee2ca1f9fa05f264b5b6ce84aace2470ec2f00f5b}`
3. Populate `lib/memory/features/us-1-dogfood-phase-4-exit/pause-resume-abort-evidence.json` with task id, stage ids, timestamps, reason text, state diffs, and `run.log.jsonl` event-id citations for each intervention. `{kind: lines, path: lib/memory/features/us-1-dogfood-phase-4-exit/spec.md, range: [228, 232], contentHash: 8796dd7d32f015073e2d95484a5dda802809c2109f82091bf892159bf551f360}`
4. Update `lib/memory/features/us-1-dogfood-phase-4-exit/phase-4-proof-bundle.md` so the intervention-probe section references the finalized evidence file path instead of pending placeholders. `{kind: lines, path: lib/memory/features/phase-4-intervention-probe-pause-resume-abort/spec.md, range: [103, 106], contentHash: 970e45fb321244d98ddde62ee2ca1f9fa05f264b5b6ce84aace2470ec2f00f5b}`
5. Preserve non-goal boundaries: do not start Phase 5 work, do not replace the end-to-end proof-bundle run, and do not widen writes to unrelated `us-1` artifacts. `{kind: lines, path: lib/memory/features/phase-4-intervention-probe-pause-resume-abort/spec.md, range: [114, 132], contentHash: 970e45fb321244d98ddde62ee2ca1f9fa05f264b5b6ce84aace2470ec2f00f5b}`

## Stage-artifact expectations by pipeline stage

- Intake: canonical feature spec remains authoritative.
- Plan: `plan.md`, `adr-draft.md`, `touch-set.json`, and updated `handoff.md`.
- Implement: `implementation-report.md` plus evidence-file and proof-bundle updates.
- Review: `review.md` with acceptance-criteria verification and evidence integrity checks.
- Report: `lib/memory/features/phase-4-intervention-probe-pause-resume-abort/delivery-report.md`.
- Ship: timestamped delivery-report copy under `lib/inbox/out/`.

## Required citations

- Directive execution order and state-snapshot requirement: `{kind: lines, path: lib/inbox/in/phase-4-intervention-probe.md, range: [39, 43], contentHash: 970e45fb321244d98ddde62ee2ca1f9fa05f264b5b6ce84aace2470ec2f00f5b}`.
- Pause/resume/abort acceptance criteria: `{kind: lines, path: lib/memory/features/phase-4-intervention-probe-pause-resume-abort/spec.md, range: [81, 112], contentHash: 970e45fb321244d98ddde62ee2ca1f9fa05f264b5b6ce84aace2470ec2f00f5b}`.
- Parent feature acceptance group this nested run satisfies: `{kind: lines, path: lib/memory/features/us-1-dogfood-phase-4-exit/spec.md, range: [208, 232], contentHash: 8796dd7d32f015073e2d95484a5dda802809c2109f82091bf892159bf551f360}`.

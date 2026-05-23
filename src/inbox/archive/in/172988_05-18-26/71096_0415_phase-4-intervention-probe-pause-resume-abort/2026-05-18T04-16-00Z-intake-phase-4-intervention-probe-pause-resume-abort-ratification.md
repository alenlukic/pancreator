---
title: Intake Ratification Request — phase-4-intervention-probe-pause-resume-abort
feature_id: phase-4-intervention-probe-pause-resume-abort
nested_task_id: 71096_0415_phase-4-intervention-probe-pause-resume-abort
stage: intake
action_required: human_ratification
created_at: 2026-05-18T04:16:00Z
spec_path: src/memory/features/phase-4-intervention-probe-pause-resume-abort/spec.md
advance_command: pnpm -w exec tess advance 71096_0415_phase-4-intervention-probe-pause-resume-abort --artifact src/memory/features/phase-4-intervention-probe-pause-resume-abort/spec.md
---

# Intake Ratification Request

The `intake-analyst` has canonicalized the source directive at
`src/inbox/in/phase-4-intervention-probe.md` into an Engineering Spec at
`src/memory/features/phase-4-intervention-probe-pause-resume-abort/spec.md`.

## Summary

**Feature:** Phase 4 Intervention Probe (Pause, Resume, Abort)
**Feature id:** `phase-4-intervention-probe-pause-resume-abort`
**Nested task id:** `71096_0415_phase-4-intervention-probe-pause-resume-abort`
**Clarifying rounds:** 0 (directive fully specified; loop not opened)
**Open questions:** None

## Acceptance criteria captured in spec.md

1. When the operator invokes `tess pause` at a live plan stage, the Pipeline
   ledger state MUST transition to `paused` with task id, stage, timestamp, and
   state diff recorded in evidence.
2. When the operator invokes `tess resume`, the Pipeline ledger state MUST
   transition back to the prior plan stage with task id, resumed stage,
   timestamp, and state diff recorded in evidence.
3. When the operator invokes `tess abort --reason <text>` after resume and
   before implement begins, the Pipeline ledger state MUST transition to
   `aborted` with task id, stage, reason text, timestamp, and state diff
   recorded in evidence.
4. When every intervention record is complete, the evidence file paths MUST be
   referenced from `src/memory/features/us-1-dogfood-phase-4-exit/phase-4-proof-bundle.md`.
5. Each intervention record MUST cite matching `run.log.jsonl` event identifiers.

## Artifacts

- Spec: `src/memory/features/phase-4-intervention-probe-pause-resume-abort/spec.md`
- Index placeholder: `src/memory/features/phase-4-intervention-probe-pause-resume-abort/index.json`
- Source directive: `src/inbox/in/phase-4-intervention-probe.md`

## Closed questions deferred to plan stage

None. The directive is self-contained. No plan-stage decision slots are
required; all acceptance criteria are machine-checkable.

## Action required

Review the spec at the path above, then run the advance command to proceed to
the plan stage:

```
pnpm -w exec tess advance 71096_0415_phase-4-intervention-probe-pause-resume-abort --artifact src/memory/features/phase-4-intervention-probe-pause-resume-abort/spec.md
```

This intake ratification **does not** produce `pause-resume-abort-evidence.json`.
That file is populated during the nested `feature-delivery` run when pause,
resume, and abort are exercised; see
`src/memory/features/us-1-dogfood-phase-4-exit/phase-4-ratification-request.md`.

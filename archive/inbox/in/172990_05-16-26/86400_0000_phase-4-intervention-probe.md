---
title: Phase 4 Intervention Probe (Pause, Resume, Abort)
feature_id: phase-4-intervention-probe
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-16T00:00:00Z
references:
  - kind: path
    path: lib/memory/features/us-1-dogfood-phase-4-exit/spec.md
    note: Spec acceptance group requires empirical pause, resume, and abort evidence distinct from the end-to-end dogfood run.
  - kind: path
    path: work/172990_05-16-26/20004_1826_us-1-dogfood-phase-4-exit/plan.md
    note: Plan decision D3 defines this probe directive path and live plan-stage interventions.
---

# Phase 4 Intervention Probe (Pause, Resume, Abort)

## Problem

Phase 4 exit requires a second real `feature-delivery` invocation that exercises
`pan pause`, `pan resume`, and `pan abort` against live ledger state.

## Goal

Start `pnpm -w exec pan run feature-delivery lib/inbox/in/phase-4-intervention-probe.md`,
advance until the nested run reaches live `plan`, then pause, resume to the same
stage, and abort before implementation using `pan abort <task-id> --reason <text>`.
Record outcomes in `lib/memory/features/us-1-dogfood-phase-4-exit/pause-resume-abort-evidence.json`.

## Non-goals

This directive SHALL NOT substitute for the end-to-end nested proof-bundle-index run.

This directive SHALL NOT start Phase 5 M1 backlog delivery.

Empirical CLI execution for pause, resume, and abort transitions belongs to nested feature slice `us-1-dogfood-phase-4-exit-evidence` after scaffold review completes.

## Required execution

1. Run the pipeline through intake into plan for this probe feature id.
2. At live `plan`, capture state snapshots immediately before and after each CLI intervention.
3. Populate `pause-resume-abort-evidence.json` with task id, timestamps, stage identifiers, reasons, state diffs, and citations to matching `run.log.jsonl` event identifiers.

## Acceptance criteria

1. Pause transitions ledger state to `paused` with captured evidence fields per spec.
2. Resume restores prior stage context with captured evidence fields per spec.
3. Abort transitions ledger state to `aborted` after resume and before implementation begins.
4. Evidence file paths are referenced from `phase-4-proof-bundle.md`.

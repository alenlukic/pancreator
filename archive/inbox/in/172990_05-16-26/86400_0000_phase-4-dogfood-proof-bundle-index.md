---
title: Phase 4 Dogfood Proof Bundle Evidence Index
feature_id: phase-4-dogfood-proof-bundle-index
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-16T00:00:00Z
references:
  - kind: path
    path: lib/memory/features/us-1-dogfood-phase-4-exit/spec.md
    note: Parent Phase 4 exit feature defines empirical proof obligations for bootstrap.
  - kind: path
    path: work/172990_05-16-26/20004_1826_us-1-dogfood-phase-4-exit/plan.md
    note: Plan decision D1 scopes this nested dogfood directive and proof-bundle root.
---

# Phase 4 Dogfood Proof Bundle Evidence Index

## Problem

Phase 4 exit requires one nested real `feature-delivery` run that produces durable
proof pointers under `lib/memory/features/us-1-dogfood-phase-4-exit/` without
starting Phase 5 backlog delivery.

## Goal

Run this inbox item through `feature-delivery` end-to-end so the implementation
adds or updates the Phase 4 proof-bundle evidence index (`phase-4-proof-bundle.md`)
and companion artifacts declared in `phase-4-proof-bundle.md`, anchored at the
proof-bundle root above.

## Non-goals

This directive SHALL NOT start Phase 5 M1 backlog delivery.

This directive SHALL NOT redefine Phase 4 exit criteria.

This directive SHALL NOT treat simulated or replayed telemetry as sufficient proof.

## Required execution

1. Canonicalize this directive through intake into `lib/memory/features/phase-4-dogfood-proof-bundle-index/spec.md` when that path is created by the pipeline.
2. During implement, ensure `lib/memory/features/us-1-dogfood-phase-4-exit/phase-4-proof-bundle.md` lists every proof artifact path with accurate status lines after each evidence capture step.
3. Preserve every nested stage artifact under `work/<day>/<nested-task-id>/` unchanged for Phoenix import of `run.log.jsonl`.

## Acceptance criteria

1. Nested task advances through intake, plan, implement, review, report, ship, and index stages with auditable artifacts.
2. `phase-4-proof-bundle.md` references the nested task identifier and its `run.log.jsonl` path.
3. Operator completes Phoenix verification and attaches evidence per `phoenix-trace-evidence.md`.
4. Human operators gate advancement using existing Phase 4 ratification workflow.

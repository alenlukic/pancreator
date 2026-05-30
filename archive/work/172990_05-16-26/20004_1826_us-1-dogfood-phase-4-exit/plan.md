# Plan: US-1 Dogfood Phase 4 Exit

## Architecture Summary

This task run is a scaffold-only slice for the Phase 4 exit proof bundle. The implementation MUST create the two nested dogfood directives, stage the proof-bundle file structure under `lib/memory/features/us-1-dogfood-phase-4-exit/`, update the feature index, record policy compliance, record validation outcomes, and emit `test-report.md` for reviewer coverage accounting. The implementation MUST NOT treat placeholders as empirical proof. The follow-on slice `us-1-dogfood-phase-4-exit-evidence` owns nested `pan run` execution, Phoenix capture, pause/resume/abort evidence, ship staging, delivery reporting, human ratification, and conditional documentation updates. The full feature spec remains authoritative for Phase 4 exit; this plan narrows only the acceptance gate for task `20004_1826_us-1-dogfood-phase-4-exit`.

## Plan-Stage Decisions

- D1: The scaffold slice SHALL create `lib/inbox/in/phase-4-dogfood-proof-bundle-index.md`. The follow-on evidence slice SHALL run that directive through all `feature-delivery` stages.
- D2: The external observability tool SHALL remain Phoenix. The scaffold slice SHALL create only the Phoenix evidence placeholder, and the follow-on evidence slice SHALL import the preserved nested run log and attach a screenshot or export.
- D3: The scaffold slice SHALL create `lib/inbox/in/phase-4-intervention-probe.md`. The follow-on evidence slice SHALL pause the second run at its live `plan` stage, resume it to the same stage, and abort it before implementation with a recorded reason.
- D4: The proof-bundle root SHALL remain `lib/memory/features/us-1-dogfood-phase-4-exit/`.
- D5: The Phase 5 readiness ADR SHALL remain deferred until the first Phase 5 feature-delivery run because Phase 5 work remains blocked until human ratification.
- D6: The reviewer gate for this task SHALL be scaffold-only. It passes when the two directives, proof-bundle skeleton, feature index update, policy-compliance artifact, implementation report, validation outcomes, and `test-report.md` exist. Empirical proof obligations move to follow-on slice `us-1-dogfood-phase-4-exit-evidence`.

## Implementation Tasks

1. Create `lib/inbox/in/phase-4-dogfood-proof-bundle-index.md` with a bounded directive that asks the pipeline to add or update a proof-bundle evidence index under `lib/memory/features/us-1-dogfood-phase-4-exit/`. The directive MUST state that it does not start Phase 5 work.
2. Create `lib/inbox/in/phase-4-intervention-probe.md` with a bounded directive for the follow-on pause/resume/abort probe. The directive MUST state that empirical CLI execution belongs to `us-1-dogfood-phase-4-exit-evidence`.
3. Assemble the scaffold proof bundle under `lib/memory/features/us-1-dogfood-phase-4-exit/` with `phase-4-proof-bundle.md`, `phoenix-trace-evidence.md`, `pause-resume-abort-evidence.json`, `phase-4-ratification-request.md`, `delivery-report.md`, and `index.json` updates. Placeholder files MUST state that evidence remains pending and MUST NOT mark Phase 4 exit complete.
4. Record the documentation-impact decision for `AGENTS.md`, `docs/M1.index.md`, `pancreator.yaml`, and `lib/memory/active/current.md` in `policy-compliance.json`. The scaffold slice MUST defer those updates until accepted evidence and human ratification exist.
5. Run the handoff validation commands and record each exit code in `work/172990_05-16-26/20004_1826_us-1-dogfood-phase-4-exit/implementation-report.md`.
6. Create `work/172990_05-16-26/20004_1826_us-1-dogfood-phase-4-exit/test-report.md` with prose-only coverage accounting. The report MUST state that this markdown-and-JSON scaffold slice has no changed executable lines, list the validation commands, and cite the implementation report command outcomes.

## Deferred Evidence Slice

Follow-on slice `us-1-dogfood-phase-4-exit-evidence` SHALL run both nested directives through the required empirical workflow. It SHALL capture nested task identifiers, preserve run logs, import the proof-index run into Phoenix, attach a screenshot or export, populate pause/resume/abort evidence JSON, stage supervisor ship output, produce the tech-writer delivery report and inbox/out copy, request human ratification, and apply conditional updates to `AGENTS.md`, `docs/M1.index.md`, `pancreator.yaml`, and `lib/memory/active/current.md` only after ratification.

## Required Citations

- Spec overview and non-goals: `{kind: lines, path: lib/memory/features/us-1-dogfood-phase-4-exit/spec.md, range: [131, 151], contentHash: 8796dd7d32f015073e2d95484a5dda802809c2109f82091bf892159bf551f360}`.
- Real dogfood run acceptance group: `{kind: lines, path: lib/memory/features/us-1-dogfood-phase-4-exit/spec.md, range: [155, 189], contentHash: 8796dd7d32f015073e2d95484a5dda802809c2109f82091bf892159bf551f360}`.
- External observability acceptance group: `{kind: lines, path: lib/memory/features/us-1-dogfood-phase-4-exit/spec.md, range: [191, 206], contentHash: 8796dd7d32f015073e2d95484a5dda802809c2109f82091bf892159bf551f360}`.
- Pause, resume, and abort acceptance group: `{kind: lines, path: lib/memory/features/us-1-dogfood-phase-4-exit/spec.md, range: [208, 232], contentHash: 8796dd7d32f015073e2d95484a5dda802809c2109f82091bf892159bf551f360}`.
- Proof-bundle and human-ratification acceptance groups: `{kind: lines, path: lib/memory/features/us-1-dogfood-phase-4-exit/spec.md, range: [234, 270], contentHash: 8796dd7d32f015073e2d95484a5dda802809c2109f82091bf892159bf551f360}`.
- Stage and policy invariants: `{kind: lines, path: lib/memory/features/us-1-dogfood-phase-4-exit/spec.md, range: [272, 291], contentHash: 8796dd7d32f015073e2d95484a5dda802809c2109f82091bf892159bf551f360}`.
- Plan-stage decision slots: `{kind: lines, path: lib/memory/features/us-1-dogfood-phase-4-exit/spec.md, range: [319, 343], contentHash: 8796dd7d32f015073e2d95484a5dda802809c2109f82091bf892159bf551f360}`.

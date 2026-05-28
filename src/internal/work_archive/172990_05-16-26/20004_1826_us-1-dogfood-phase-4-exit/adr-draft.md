# ADR Draft: Phase 4 Dogfood Proof Bundle Architecture

## Status

Draft for plan-stage review.

## Context

Phase 4 remains open until the repository proves a real US-1 dogfood run, external run-log observability, pause/resume/abort behavior, a complete proof bundle, and human ratification. The current spec forbids Phase 5 work before ratification and forbids simulated or partial runs as proof: `{kind: lines, path: src/memory/features/us-1-dogfood-phase-4-exit/spec.md, range: [131, 151], contentHash: 8796dd7d32f015073e2d95484a5dda802809c2109f82091bf892159bf551f360}`.

The proof bundle depends on inbox lifecycle discipline because the dogfood run starts from `src/inbox/in/` and ends with delivery artifacts under `src/inbox/out/`. ADR 0003 records the active inbox queue and archive boundaries: `{kind: lines, path: src/memory/adr/0003-inbox-lifecycle-and-archival.md, range: [66, 91], contentHash: fbd44e8b8627bd14c06e8e86d720984f2cf34f25669737289d43ac92e9678995}`.

The proof bundle also depends on documentation-impact discipline because Phase 4 ratification can update `daedaline.yaml`, active memory, and operator guidance. ADR 0004 requires each task to record documentation and reference impact: `{kind: lines, path: src/memory/adr/0004-documentation-impact-contract.md, range: [49, 75], contentHash: f0ee449a848d71b22c21dec91d0581392e8e556c2537fc3dfe169e02db642a8c}`.

## Decision

The current task run SHALL be a scaffold-only slice. It SHALL create the nested dogfood directives, proof-bundle skeleton, feature index update, policy-compliance artifact, implementation report, validation outcomes, and reviewer `test-report.md`.

The implementation SHALL create `src/inbox/in/phase-4-dogfood-proof-bundle-index.md` as the future end-to-end US-1 dogfood proof directive. The follow-on evidence slice SHALL run that directive through all `feature-delivery` stages.

The implementation SHALL preserve Phoenix as the external run-log verification tool. The scaffold slice SHALL stage only the Phoenix evidence placeholder, and follow-on slice `us-1-dogfood-phase-4-exit-evidence` SHALL import the nested run log and attach one screenshot or exported trace artifact under `src/memory/features/us-1-dogfood-phase-4-exit/`.

The implementation SHALL create `src/inbox/in/phase-4-intervention-probe.md` as the future intervention directive. The follow-on evidence slice SHALL pause, resume, and abort the run at the live `plan` stage.

The proof-bundle root SHALL be `src/memory/features/us-1-dogfood-phase-4-exit/`. The scaffold bundle SHALL include placeholders for nested staged PR outcome, delivery-report path, Phoenix trace evidence, pause/resume/abort evidence, residual-gap statement, and human-ratification request.

The Phase 5 readiness ADR SHALL be deferred until the first Phase 5 feature-delivery run. Phase 5 work remains blocked until the Phase 4 proof bundle is ratified.

D6: The plan SHALL split current acceptance into scaffold slice `20004_1826_us-1-dogfood-phase-4-exit` and evidence slice `us-1-dogfood-phase-4-exit-evidence`. The split resolves reviewer gate ambiguity without weakening the full Phase 4 exit criteria in `src/memory/features/us-1-dogfood-phase-4-exit/spec.md`.

## Consequences

- Positive: The Phase 4 exit evidence remains auditable from one real inbox item through every persona stage.
- Positive: Phoenix verification supplies an external trace check without requiring a SaaS credential during bootstrap.
- Positive: The existing per-feature directory gives the proof bundle one durable root before archival closure.
- Positive: The scaffold slice gives reviewer a deterministic gate: directives, bundle skeleton, validation records, and `test-report.md`.
- Negative: The implementation requires operator-driven stage advancement and manual Phoenix evidence capture.
- Negative: Phase 4 exit remains open until the follow-on evidence slice produces empirical nested-run, Phoenix, intervention, ship, delivery, and ratification artifacts.
- Neutral: The decision does not change Persona role boundaries, Pipeline definitions, or runtime transport automation.

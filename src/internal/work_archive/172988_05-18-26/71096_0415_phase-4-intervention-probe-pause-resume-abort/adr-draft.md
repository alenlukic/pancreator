# ADR Draft: Intervention-Probe Evidence Boundary at Live Plan Stage

## Status

Proposed

## Context

The nested feature exists to provide empirical evidence that a live
`feature-delivery` run supports `pause`, `resume`, and `abort` transitions while
the run is halted at `plan`. The acceptance criteria require task identifiers,
timestamps, stage identifiers, state diffs, and `run.log.jsonl` event-id
citations for each intervention. `{kind: lines, path: src/memory/features/phase-4-intervention-probe-pause-resume-abort/spec.md, range: [81, 113], contentHash: 970e45fb321244d98ddde62ee2ca1f9fa05f264b5b6ce84aace2470ec2f00f5b}` `{kind: lines, path: src/memory/features/us-1-dogfood-phase-4-exit/spec.md, range: [208, 232], contentHash: 8796dd7d32f015073e2d95484a5dda802809c2109f82091bf892159bf551f360}`

The directive is intentionally bounded: the run SHALL NOT substitute for the
end-to-end proof-bundle run, SHALL NOT start Phase 5 work, and SHALL keep
cross-feature writes narrowly constrained. `{kind: lines, path: src/inbox/in/phase-4-intervention-probe.md, range: [31, 37], contentHash: 970e45fb321244d98ddde62ee2ca1f9fa05f264b5b6ce84aace2470ec2f00f5b}` `{kind: lines, path: src/memory/features/phase-4-intervention-probe-pause-resume-abort/spec.md, range: [114, 132], contentHash: 970e45fb321244d98ddde62ee2ca1f9fa05f264b5b6ce84aace2470ec2f00f5b}`

The repository already requires explicit documentation-impact accounting per
task, so this run must preserve evidence clarity without widening scope. `{kind: lines, path: src/memory/adr/0004-documentation-impact-contract.md, range: [49, 75], contentHash: f0ee449a848d71b22c21dec91d0581392e8e556c2537fc3dfe169e02db642a8c}`

## Decision

The plan stage SHALL enforce a minimal-surface evidence decision:

1. The run SHALL perform CLI intervention only at live `plan`, and the
   intervention order SHALL be `pause -> resume -> abort`.
2. The implement stage SHALL update only
   `src/memory/features/us-1-dogfood-phase-4-exit/pause-resume-abort-evidence.json`
   and `src/memory/features/us-1-dogfood-phase-4-exit/phase-4-proof-bundle.md`
   under the parent `us-1` feature tree.
3. Each intervention record SHALL include before/after state snapshots and
   matching `run.log.jsonl` event-id citations.
4. The stage artifacts SHALL retain clear audit traceability across implement,
   review, report, and ship without claiming completion of unrelated Phase 4
   or Phase 5 objectives.

## Consequences

- Positive: Evidence remains directly auditable against acceptance criteria
  because transitions and citations are captured from one live run boundary.
- Positive: Scope remains safe because parent-feature writes are limited to
  two explicitly named files.
- Positive: Human ratification can validate readiness from stable artifacts
  before any subsequent `tess advance`.
- Negative: The bounded scope requires follow-on work for any unrelated
  evidence gaps discovered during review.
- Negative: Operators must maintain strict sequencing and snapshot discipline
  at runtime to avoid invalidating empirical claims.

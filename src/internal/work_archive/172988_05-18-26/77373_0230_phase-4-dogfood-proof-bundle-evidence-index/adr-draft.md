# ADR Draft: Proof-Bundle Boundary for Nested Phase 4 Evidence Run

## Status

Proposed

## Context

The nested feature requires one end-to-end `feature-delivery` run with auditable
artifacts across seven stages and a deterministic proof-bundle update during
implement. Scope is constrained so this run does not modify other `us-1`
artifacts beyond `phase-4-proof-bundle.md`, while Phoenix verification and
ratification remain mandatory workflow gates after artifacts are produced.
`{kind: lines, path: src/inbox/in/phase-4-dogfood-proof-bundle-index.md, range: [48, 51], contentHash: ccf9748cc364505754017e9d57ad777e9bd90e78ecfffe3222a64733049ac76c}` `{kind: lines, path: src/memory/features/us-1-dogfood-phase-4-exit/phase-4-proof-bundle.md, range: [7, 15], contentHash: d6dc74c48b595edd3d9bd0f9b7bb43de358324eaaf7002237417e9987372ea82}`

The repository already uses explicit post-task documentation and evidence-impact
recording to keep workflow state auditable at phase boundaries.
`{kind: lines, path: src/memory/adr/0004-documentation-impact-contract.md, range: [51, 75], contentHash: TBD-on-commit}`

## Decision

The plan stage SHALL enforce a single-writer boundary for the nested
implementation:

1. The implement stage SHALL update only
   `src/memory/features/us-1-dogfood-phase-4-exit/phase-4-proof-bundle.md`
   under the `us-1-dogfood-phase-4-exit` tree.
2. The nested task id and run-log path SHALL be treated as immutable evidence
   identifiers across all stage artifacts.
3. Phoenix import and human ratification SHALL be represented as explicit
   acceptance workflow obligations, not as simulated or inferred completion.

## Consequences

- Positive: The nested run remains tightly scoped, reducing accidental edits
  across parent `us-1` artifacts.
- Positive: Evidence provenance remains stable because the task id and run-log
  path are fixed in all references.
- Positive: Reviewer and ship owners can audit completion from stage artifacts
  and explicit post-run Phoenix/ratification evidence requirements.
- Negative: Additional operator actions are required after stage artifact
  production before the Phase 4 gate can be closed.
- Negative: Any discovered evidence gaps will require a follow-on bounded
  update instead of widening this implementation scope.

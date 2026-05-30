# ADR Draft — Deferred protocol and operator tooling batch

- Status: Proposed
- Date: 2026-05-25
- Deciders: tech-lead (plan stage), human ratifier
- Task id: 22411_1746_cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref

## Context

Current CLI and MCP stubs emit `{status:"stub"}` responses that do not encode milestone ownership, tracking context, or deterministic non-success signaling. Operators also lack first-class CLI entrypoints for creating intake directives with canonical timestamp naming and for refreshing active-memory sections deterministically. The spec requires these as one batch so recurring operator friction is addressed with one ratified touch-set.

## Decision

1. Deferred contract unification  
   The implementation SHALL replace ad-hoc stub responses with one structured deferred envelope format for both CLI and MCP stubs, with stable non-zero signaling for deferred outcomes.
2. CLI-first intake creation  
   The implementation SHALL add `pan intake new <slug>` and compute day-bucket/SID/HHMM values from UTC-derived logic aligned with existing timestamp naming conventions.
3. Deterministic active-memory refresh  
   The implementation SHALL add `pan refresh-active-memory [--dry-run]` and rewrite only the three labeled sections, refusing silent overwrite when computed and current section bodies diverge.
4. Documentation co-shipping  
   The implementation SHALL include required cross-cutting updates in `AGENTS.md` and `lib/personas/compliance-auditor.md` inside the same change set.

## Consequences

### Positive

- Operators receive machine-readable deferred outcomes with stable handling semantics.
- Intake creation and active-memory refresh become reproducible CLI workflows.
- Compliance audits gain explicit remediation guidance for active-memory drift findings.

### Negative

- CLI command surface and help output gain new branches that increase test maintenance.
- Deferred-code semantics require careful parity between CLI and MCP transports.

### Neutral

- Underlying milestone feature delivery remains deferred; only operator tooling and signaling improve in this batch.

## Alternatives considered

1. Keep `{status:"stub"}` and add only docs guidance  
   Rejected because it does not satisfy acceptance criteria for non-zero stable deferred signaling.
2. Deliver WP-2/WP-3 first and defer WP-1  
   Rejected because spec defines one combined friction-reduction batch with shared validation expectations.

## Human ratification prompts

1. Confirm stable deferred exit code policy (single repository-wide code for all deferred CLI verbs).
2. Confirm MCP non-success mapping strategy (transport-level error vs structured non-success payload with retained envelope fields).

## References

- kind: lines
  path: lib/memory/features/cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref/spec.md
  range: [66, 85]
  contentHash: TBD-on-commit
  note: Feature scope and three work packages.
- kind: lines
  path: lib/memory/features/cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref/spec.md
  range: [91, 177]
  contentHash: TBD-on-commit
  note: Deferred envelope, intake scaffolder, refresher, and tests.
- kind: lines
  path: lib/memory/features/cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref/spec.md
  range: [181, 187]
  contentHash: TBD-on-commit
  note: Required AGENTS and compliance-auditor updates.
- kind: lines
  path: lib/memory/handbook/documentation-impact-contract.md
  range: [49, 98]
  contentHash: TBD-on-commit
  note: Mandatory documentation impact decision and deferral linkage rules.

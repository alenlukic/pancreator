---
title: ADR Draft - Sequence CI gate hardening and MCP read-surface activation
task_id: 24959_1704_ci-best-practices-batch
feature_id: ci-best-practices-batch
status: proposed
date: 2026-05-26
deciders: [tech-lead, LocalUserAuthorizer]
references:
  - kind: lines
    path: lib/memory/features/ci-best-practices-batch/spec.md
    range: [88, 120]
    contentHash: 22be0fb
    note: Batch objective and strict A -> B -> C -> D delivery ordering.
  - kind: lines
    path: lib/memory/features/ci-best-practices-batch/spec.md
    range: [123, 210]
    contentHash: 22be0fb
    note: Acceptance criteria for CI aggregation, compliance runner, citation refresh, and MCP read handlers.
  - kind: lines
    path: lib/memory/adr/0004-documentation-impact-contract.md
    range: [49, 91]
    contentHash: 1fa849a
    note: Existing ADR pattern requiring explicit post-task documentation-impact decisions.
---

## Context

The repository currently lacks one cohesive quality-ratchet path that links
full test aggregation, compliance descriptor enforcement, citation integrity,
and typed MCP read tooling. The spec defines these as one batch feature and
requires delivery order A -> B -> C -> D so each subsequent package depends on
validated prior gates.

The current MCP read commands still rely on deferred or stub-like behavior for
high-value queries, while citation freshness debt and compliance execution
gating remain partially manual. CI workflow integrity and operator confidence
depend on deterministic sequencing, typed outputs, and evidence-oriented tests.

## Decision

This feature SHALL be implemented as one ordered plan where each work package
is a hard gate for the next package:

1. WP-A SHALL establish the canonical `pnpm test` aggregation and CI invocation
   ordering.
2. WP-B SHALL add `run-compliance.mjs` and SHALL run it after `pnpm test`.
3. WP-C SHALL add idempotent citation-refresh tooling and SHALL execute after
   test and compliance gates are available.
4. WP-D SHALL wire the four read-only MCP tools with typed envelopes and SHALL
   include transport-level tests that forbid `{"status":"stub"}` responses.

The implementation SHALL treat this as one touch-set with explicit validation
commands and one delivery report that measures CI wallclock delta against the
3-minute cap.

## Status

Proposed for human ratification at the `plan` stage gate for task
`24959_1704_ci-best-practices-batch`.

## Consequences

- **Positive:** CI becomes a stronger required gate because tests and
  compliance checks run in declared order on each PR.
- **Positive:** Citation refresh and MCP read handlers become deterministic and
  test-backed, reducing manual drift and operator ambiguity.
- **Negative:** The batch touch-set spans CI, tooling, tests, package scripts,
  and MCP modules, which increases implementation coordination effort.
- **Negative:** CI wallclock may increase; the implementation stage SHALL
  measure and report runtime impact to enforce the <=3-minute constraint.
- **Neutral:** Write-side MCP tools remain deferred and unchanged by this ADR.

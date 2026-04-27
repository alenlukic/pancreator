---
title: ADR Draft - Canonical Compliance Test Relocation
seq: "draft-compliance-tests-0001"
status: proposed
date: 2026-04-27
deciders: [tech-lead, LocalUserAuthorizer]
supersedes: null
superseded-by: null
feature_id: compliance-tests
references:
  - kind: lines
    path: memory/features/compliance-tests/spec.md
    range: [55, 60]
    contentHash: TBD-on-commit
    note: Round-05 approval closes remediation and authorizes plan handoff.
  - kind: lines
    path: memory/features/compliance-tests/spec.md
    range: [62, 69]
    contentHash: TBD-on-commit
    note: Spec requires canonical test storage and schema versioning under tests/compliance.
  - kind: lines
    path: memory/features/compliance-tests/spec.md
    range: [70, 81]
    contentHash: TBD-on-commit
    note: Spec defines invocation modes, manual-first execution, cadence default, and trigger classes.
  - kind: lines
    path: memory/features/compliance-tests/spec.md
    range: [82, 94]
    contentHash: TBD-on-commit
    note: Spec defines severity routing, run persistence, and AGENTS guidance.
  - kind: lines
    path: inbox/threads/compliance-tests/68576_0457_round-04-human-reject.md
    range: [8, 17]
    contentHash: TBD-on-commit
    note: Rejection requires corrected paths, agent invocation policy, and documentation updates.
  - kind: lines
    path: inbox/threads/compliance-tests/68576_0457_round-05-human-approve.md
    range: [1, 3]
    contentHash: TBD-on-commit
    note: Human approval authorizes the remediated plan.
  - kind: lines
    path: PRD.md
    range: [655, 658]
    contentHash: 3f8e5fca0653a15f80e65081ce6e5c520894f0711dcf8e06f0395852c6fd30ff
    note: Plan-stage gate requires the plan artifact trio before implement starts.
  - kind: lines
    path: memory/adr/0002-system-architecture-map.md
    range: [132, 142]
    contentHash: de4a4cbc04784ed29aa44b1c848b075f35bbebb889b8c06d87798942d72dda3b
    note: Repository state is document-first and runtime execution wiring remains deferred.
  - kind: lines
    path: memory/handbook/documentation-impact-contract.md
    range: [47, 60]
    contentHash: TBD-on-commit
    note: Documentation-impact obligations apply when workflow guidance changes.
---

## Context

The round-04 rejection found that prior planning sent compliance test assets to a noncanonical feature-contract tree and omitted agent-invokable behavior. The round-05 approval accepts the corrected intake state. The repository now contains canonical `tests/compliance/` assets, manual runbook guidance, severity routing, AGENTS trigger guidance, and deferred automation backlog linkage.

The bootstrap workspace does not yet run scheduler automation or automatic structure-change triggers. ADR-0002 classifies that runtime as future work, so this slice uses governed artifacts and manual invocation.

## Decision

Tesseract SHALL use `tests/compliance/` for compliance descriptors and `tests/compliance/schemas/` for descriptor schemas.

When duplicate descriptors or schemas exist under `memory/features/compliance-tests/contracts/`, the implement stage MUST remove them or exclude them from staged output.

When automation is unavailable, operators and agents MUST invoke compliance runs through the manual runbook and MUST persist run results with timestamp, trigger mode, test identifier, severity, and pass/fail outcome fields.

When structure-change policy is evaluated, invocation rules MUST cover persona, skill, pipeline, documented operational primitive, testing infrastructure, operator interface, and milestone-ratification changes.

When severity is `high`, routing policy MUST require remediation plus one rerun with zero `high` findings before review or human approval proceeds.

When severity is `medium`, routing policy MUST create a backlog item and MUST default operator escalation to `off`.

When severity is `low`, routing policy MUST create a backlog item and MUST emit warnings to `console` and `inbox/out`.

The first slice SHALL defer automatic 4-hour scheduler execution and automatic structure-change execution to backlog, and SHALL preserve `AGENTS.md` trigger guidance during that deferred period.

## Status

Status is proposed on 2026-04-27 for `coder` implement-stage execution.

## Consequences

- positive: The implementation path aligns with the approved operator guidance.
- positive: Agents and operators can invoke compliance checks in slice one.
- positive: Trigger and severity rules remain auditable through feature artifacts and `AGENTS.md`.
- negative: Automated 4-hour scheduling remains deferred.
- negative: Manual invocation requires operator or agent action until automation lands.

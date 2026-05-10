---
title: Compliance Tests Intake Spec
feature_id: compliance-tests
status: delivery-reported
next_owner: librarian
next_stage: index
source_inbox_item: src/inbox/archive/in/68576_0457_compliance-tests.md
intake_round: 6
approval_artifact: src/inbox/threads/compliance-tests/68576_0457_round-06-human-approve.md
prior_approval_artifact: src/inbox/threads/compliance-tests/68576_0457_round-05-human-approve.md
initial_approval_artifact: src/inbox/threads/compliance-tests/68576_0457_round-03-approval.md
rejection_artifact: src/inbox/threads/compliance-tests/68576_0457_round-04-human-reject.md
delivery_report: src/memory/features/compliance-tests/delivery-report.md
references:
  - kind: lines
    path: src/inbox/archive/in/68576_0457_compliance-tests.md
    range: [1, 10]
    contentHash: d1c2765a013eb9296690f516031f8e04dc1228b355a9dc97b92f83b289988a64
    note: Human directive that defines compliance-test scope and severity routing.
  - kind: lines
    path: docs/PRD.md
    range: [633, 649]
    contentHash: 6a838ec1879ea8c1c83dc5c4dd24618637ff3f7522043775cc123f3751b18f37
    note: Intake-stage loop cap and human-approval gate constraints.
  - kind: lines
    path: src/memory/handbook/glossary.md
    range: [222, 235]
    contentHash: aae7388df950d4aa27ab2eda452cabcc4e746875e7dcfa21565116b4d45344dd
    note: Feature-folder and Spec Kit v0.8 path conventions.
  - kind: lines
    path: src/inbox/threads/compliance-tests/68576_0457_round-01.md
    range: [1, 30]
    contentHash: 31a70528685506d06e58660095b3024e87844a14cbeee56f55445bbcb976e77c
    note: Operator clarifications that resolve intake round-01 questions.
  - kind: lines
    path: src/inbox/threads/compliance-tests/68576_0457_round-02.md
    range: [1, 17]
    contentHash: 79664d8a4f2bd9cf076104398d85f644b85e390ee68e1fae76b98a976dc07585
    note: Interim canonical fallback that resolves blocked gate identifiers.
  - kind: lines
    path: src/inbox/threads/compliance-tests/68576_0457_round-03-approval.md
    range: [1, 8]
    contentHash: bff1c881dfd10428cf5a4d3a4c74f7399e6dcb5b42ec97595b172687a9bf8452
    note: Initial human approval artifact that authorizes intake exit to plan.
  - kind: lines
    path: src/inbox/threads/compliance-tests/68576_0457_round-04-human-reject.md
    range: [1, 17]
    contentHash: TBD-on-commit
    note: Human rejection artifact that reopens remediation and constrains plan-level corrections.
  - kind: lines
    path: src/inbox/threads/compliance-tests/68576_0457_round-05-human-approve.md
    range: [1, 3]
    contentHash: TBD-on-commit
    note: Human approval artifact that closes intake remediation and reaffirms plan handoff.
  - kind: lines
    path: src/inbox/threads/compliance-tests/68576_0457_round-06-human-approve.md
    range: [1, 3]
    contentHash: TBD-on-commit
    note: Human approval artifact that supersedes round 05 and confirms the plan handoff remains approved.
---

# Spec

This spec canonicalizes the `src/inbox/archive/in/68576_0457_compliance-tests.md` directive into a
governed compliance-test capability for Tesseract. The round-04 rejection
artifact reopened this feature for plan-stage remediation, the round-05
approval artifact ratified remediation closure, and the round-06 approval
artifact confirmed the handoff to planning remains in force.

## Acceptance criteria

- WHEN a maintainer defines a compliance test suite, the system MUST store
  compliance tests under `tests/compliance/` and MUST validate each test file
  against a schema under `tests/compliance/schemas/`.
- WHEN a maintainer versions schemas, the system MUST require the newest schema
  file to be named `latest.yaml` and SHOULD keep version snapshots such as
  `v0.yaml` and `v1.yaml` in the same directory.
- WHEN compliance tests run, the runner MUST support three invocation modes:
  scheduled cadence, structure-change-triggered cadence, and operator-invoked
  on-demand execution.
- WHEN scheduled automation is unavailable, the system MUST support manual
  invocation by an operator or an agent from the first delivery slice and MUST
  defer automation-only cadence execution to the backlog.
- WHEN no explicit scheduled cadence is configured and automation is available,
  the scheduler MUST default to a 4-hour interval.
- WHEN a structure-change trigger is evaluated, the system MUST run compliance
  tests after adding, modifying, or deleting a persona, skill, pipeline
  definition, other documented operational primitive, testing infrastructure,
  operator interface, or milestone ratification artifact.
- WHEN a test fails with `high` severity, the system MUST trigger a remediation
  workflow, MUST block `review_passes`, and MUST block `human_approval` until
  remediation controls are staged and one rerun reports zero `high` findings.
- WHEN a test fails with `medium` severity, the system MUST create a backlog
  item, MUST default operator escalation to `off`, and MUST support
  configuration to enable escalation.
- WHEN a test fails with `low` severity, the system MUST create a backlog item
  and MUST emit warnings to both `console` and `src/inbox/out` by default.
- WHEN a compliance run completes, the system MUST persist run timestamp,
  trigger mode, test identifiers, and pass/fail outcomes.
- WHEN trigger policies or invocation behavior change, the feature delivery
  slice MUST update `AGENTS.md` policy guidance so agent-trigger conditions for
  compliance runs remain explicit and current.

## Out of scope

- Designing the final remediation pipeline internals beyond the trigger and
  handoff contract.
- Defining a long-term reporting dashboard or analytics warehouse for results.
- Migrating pre-existing ad hoc checks into the new schema format.

## Open questions

- None.

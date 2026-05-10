# Compliance Tests Manual Runbook

## Purpose

This runbook defines first-slice execution for compliance tests while scheduler
automation and automatic structure-change execution remain deferred.

## Invocation Modes

### `scheduled-cadence`

- Status: deferred automation in the first delivery slice.
- Action: maintain backlog linkage for 4-hour scheduler default enforcement and
  automatic structure-change execution wiring.

### `structure-change`

- Trigger surface: run after create, modify, or delete events across required
  structure classes.
- First-slice action: operator or agent manually runs descriptors in
  `src/internal/tests/compliance/` immediately after the structure change lands.

### `operator-on-demand`

- Trigger: operator or agent requests an ad hoc compliance run.
- First-slice action: operator or agent manually runs all descriptors in
  `src/internal/tests/compliance/`.

## Structure-Change Trigger Matrix

| Structure class | Required trigger behavior |
|---|---|
| Persona | Run compliance tests after persona add/modify/delete. |
| Skill | Run compliance tests after skill add/modify/delete. |
| Pipeline | Run compliance tests after pipeline definition add/modify/delete. |
| Operational primitive | Run compliance tests after documented primitive add/modify/delete. |
| Testing infrastructure | Run compliance tests after testing infrastructure add/modify/delete. |
| Operator interface | Run compliance tests after operator interface add/modify/delete. |
| Milestone ratification artifact | Run compliance tests after milestone-ratification artifact add/modify/delete. |

## Manual Execution Protocol

1. Record run start time in UTC ISO 8601 format.
2. Select trigger mode: `structure-change` or `operator-on-demand`; keep
   `scheduled-cadence` as backlog-deferred automation until scheduler wiring
   lands.
3. Evaluate each descriptor in `src/internal/tests/compliance/*.yaml` against
   `src/internal/tests/compliance/schemas/latest.yaml`.
4. For each test, record pass or fail outcome and supporting evidence.
5. Route failures by severity using `high`/`medium`/`low` policy from the spec.
6. Record run completion in a run log document using
   `src/memory/features/compliance-tests/run-template.json`.

## Timestamp Capture

- Required fields for each run record:
  - `run_timestamp`
  - `trigger_mode`
  - `test_id` (in `test_results[]`)
  - `outcome` (in `test_results[]`)

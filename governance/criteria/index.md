# Criteria catalog

The shared vocabulary for stage criteria. Each stage in a workflow declares its
own `criteria[]` inline (now in the per-stage files under
`library/workflows/<slug>/stages/`). This catalog documents the naming
conventions and the reusable criterion families so that criteria stay
consistent across workflows. It is documentation, not a runtime input.

## How criteria work

A criterion is one checkable claim about a stage's output or its effect on the
workspace. Every criterion has:

- `id` - dotted, namespaced identifier, `<area>.<claim>` (for example
  `review.tests_correct`).
- `type` - how it is evaluated:
  - `judgment` - evaluated by a reasoning agent (the worker self-evaluates;
    a supervisor independently re-judges these at a `supervisor` gate).
  - `shell` - evaluated by the harness rerunning a declared command; the
    worker's self-claim is never accepted as proof.
  - `state` - evaluated by the harness against run state and workspace
    fingerprints.
- `hard` - if true, a failure (or `not_applicable`) blocks the stage. Soft
  criteria inform judgment but do not block on their own.
- `statement` - the claim, written so that "pass" is unambiguous.

A stage succeeds only when its output shape is valid, every declared criterion
has a self-evaluation, no hard criterion is failed or not applicable, the
workspace mutation policy is respected, and every hard deterministic check
passes. See [`docs/runtime-protocol.md`](../../docs/runtime-protocol.md).

## Naming conventions

- Namespace by area: `record.*` (operator legibility), `scope.*` (mutation
  boundaries), `intake.*`, `plan.*`, `implement.*`, `review.*`, `test.*`,
  `ship.*`, `preflight.*`.
- One claim per id. If a statement contains "and" across two independently
  checkable things, split it.
- Keep ids stable. Evidence and records reference them; renaming an id breaks
  history.

## Reusable families

These claims recur across stages; reuse the id and tailor the statement.

- `record.operator_readable` (judgment, hard) - the output gives the operator a
  concise outcome, blockers, evidence pointers, and the next action.
- `scope.no_unapproved_changes` (state, hard) - the stage respected its declared
  workspace mutation policy. Injected automatically by the harness for any stage
  whose `workspace_policy` is not `source_allowed`.
- `*.acceptance_met` (judgment, hard) - the relevant acceptance criteria are
  satisfied and independently verifiable, not merely asserted.
- `*.tests_correct` (judgment, hard) - tests are meaningful, correctly scoped,
  and resistant to false positives.
- `*.maintainable` (judgment, hard) - structural and maintenance risk is
  appropriate for the requested scope.
- `*.full_suite` / `*.coverage` (shell, hard) - the complete automated suite and
  coverage thresholds pass when rerun by the harness.

## Deterministic vs judgment

Prefer a deterministic (`shell`/`state`) criterion whenever the claim can be
checked by a command or by state. Reserve `judgment` for claims that genuinely
require reasoning - faithfulness, proportionality, maintainability - and route
those through an independent gate rather than self-certification.

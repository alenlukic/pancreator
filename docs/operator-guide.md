# Operator guide

## The normal interaction

Use `/pan-start` for a new request and `/pan-resume <run-id>` thereafter. The supervisor should always show:

1. current run and stage
2. what completed or failed
3. where the evidence lives
4. what decision or action is required next

Raw JSONL and shell output are diagnostic surfaces, not the default conversation.

## Targeting a deliverable outside the repository root

If the work lands somewhere other than the Pancreator repository root — most commonly a gitignored project capsule under `workdesk/` that is its own Git repository — start the run with `./bin/pan init ... --workspace workdesk/<project>`. The harness then fingerprints, runs gate commands against, and enforces scope boundaries on that directory. If you omit it for such a run, every "passing" check measured the Pancreator repository instead of your deliverable, and the green status proves nothing about the actual work. The active workspace appears on each invocation card; confirm it matches the deliverable before trusting any gate result.

## Intake approval

Check that the product specification:

- preserves the request without broadening it
- describes observable user outcomes
- names constraints and out-of-scope behavior
- exposes open questions rather than hiding assumptions

Approve only with an explicit instruction. Rejection routes back to intake and carries your `--note` forward as a required input for the retry.

## Pauses

A pause is not a generic failure. Read `last_decision_path` in `state.json` or use `/pan-status`. Typical causes are missing evidence, an agent-declared blocker, or a circuit breaker.

Resume from the stage that owns the remediation. Do not resume from review or test when the defect belongs to implementation.

## Release approval

The ship packet is a proposal. Before approval, confirm:

- review and QA passed against the current workspace
- residual risks are acceptable
- rollback guidance is credible
- the proposed commit/PR text accurately describes the diff

Approval marks the workflow succeeded. It does not itself create a commit, PR, merge, or deployment.

### Rejecting a release packet

Rejection routes remediation to the stage that owns the fix and carries your feedback forward to that stage's worker as a required input.

- `./bin/pan decide <run-id> reject --note "<what is wrong>"` sends the run back to implementation by default, then naturally re-runs review, QA, and ship.
- `./bin/pan decide <run-id> reject --stage plan --note "<what is wrong>"` sends it back to planning when the defect is architectural rather than a coding error.
- `--stage <slug>` may target any stage in the workflow. The chosen stage and every stage after it restart with fresh attempt budgets, since you are deliberately reworking that segment.

Always include a `--note`. The feedback is written to `artifacts/operator-feedback-<n>.md` and attached to the remediation invocation; without it the worker only knows the prior output was unacceptable.

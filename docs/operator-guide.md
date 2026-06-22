# Operator guide

## The normal interaction

Use `/pan-start` for a new request and `/pan-resume <run-id>` thereafter. The supervisor should always show:

1. current run and stage
2. what completed or failed
3. where the evidence lives
4. what decision or action is required next

Raw JSONL and shell output are diagnostic surfaces, not the default conversation.

## Intake approval

Check that the product specification:

- preserves the request without broadening it
- describes observable user outcomes
- names constraints and out-of-scope behavior
- exposes open questions rather than hiding assumptions

Approve only with an explicit instruction. Rejection routes back to intake.

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

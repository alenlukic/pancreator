# Compliance Tests Severity Routing

## `high` severity

- The runner MUST trigger remediation workflow guidance before handoff.
- The runner MUST set `review_passes` to blocked while any open `high` finding remains.
- The runner MUST set `human_approval` to blocked while any open `high` finding remains.
- The operator MUST attach remediation controls and one rerun output with zero open `high` findings before unblocking.

## `medium` severity

- The runner MUST create one backlog item per `medium` finding.
- The runner MUST default operator escalation to `off`.
- The runner MUST support explicit configuration that enables escalation when the operator turns it on.

## `low` severity

- The runner MUST create one backlog item per `low` finding.
- The runner MUST emit warning output to `console`.
- The runner MUST emit warning output to `src/inbox/out`.

## Deferred automation linkage

- Manual and agent invocation remain the executable first-slice paths.
- Scheduler default enforcement for the 4-hour cadence is deferred to backlog automation follow-up.
- Structure-change auto-trigger wiring is deferred to backlog automation follow-up.

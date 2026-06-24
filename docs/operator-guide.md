# Operator guide

## The normal interaction

Use `/pan-start` for a new request and `/pan-resume <run-id>` thereafter. The supervisor should always show:

1. current run and stage
2. what completed or failed
3. where the evidence lives
4. what decision or action is required next

Raw JSONL and shell output are diagnostic surfaces, not the default conversation.

## Choose a work mode

Use `systematic` by default. `/pan-start` executes the governed `dev` workflow
with planning, implementation, independent review, QA, and release preparation.

Use `/pan-debug <problem>` when the cause or remediation scope is unclear. The
investigator does not modify source; it returns root cause, proposed remediation,
numbered acceptance criteria, and a `lightweight` or `systematic` recommendation.

Use `/pan-spotfix <request>` only when the operator deliberately selects
lightweight execution and the request satisfies `WORK-001`: one coherent change,
no unresolved structural decision, no more than three core implementation files
in one bounded subsystem, and existing checks that can prove correctness. The
spotfixer performs at most three implementation-validation cycles. Failure or
scope expansion creates `runtime/inbox/spotfix-escalation-*.md` for systematic
routing. Do not run it while a mutating workflow agent is active in the same
workspace.

## Select pipeline models

`project.json` is the source of truth for named persona-to-model mappings. Set `active_config` to one of the declared configurations, then project that mapping into the Cursor worker agents:

```sh
./bin/pan models --sync
./bin/pan validate
```

Run `./bin/pan models` without `--sync` to preview the active mapping and any drift without changing files.

Each new run snapshots the active configuration in `runtime/logs/workflows/<run-id>/pipeline-config.snapshot.json`. Invocation cards resolve their model from that snapshot. Because Cursor executes the model declared in `.cursor/agents/<persona>.md`, preparing an older run after switching configurations is blocked until the projected agent models again match that run's snapshot. This prevents the card from claiming one model while Cursor launches another.

## Targeting a deliverable outside the repository root

If the work lands somewhere other than the Pancreator repository root — most commonly a gitignored project capsule under `workdesk/` that is its own Git repository — start the run with `./bin/pan init ... --workspace workdesk/<project>`. The harness then fingerprints, runs gate commands against, and enforces scope boundaries on that directory. If you omit it for such a run, every "passing" check measured the Pancreator repository instead of your deliverable, and the green status proves nothing about the actual work. The active workspace appears on each invocation card; confirm it matches the deliverable before trusting any gate result.

To bootstrap Pancreator configuration in a new target repository, run `./bin/pancreator-install --target <path>` from the Pancreator checkout. See [`docs/embedded-installation.md`](embedded-installation.md) for verification, partial-install prompts, and cleanup.

## Intake approval

Check that the product specification:

- preserves the request without broadening it
- describes observable user outcomes
- names constraints and out-of-scope behavior
- exposes open questions rather than hiding assumptions

Approve only with an explicit instruction. Rejection routes back to intake and carries your `--note` forward as a required input for the retry.

## Pauses

A pause is not a generic failure. Read `last_decision_path` in `state.json` or use `/pan-status`. Typical causes are missing evidence, an agent-declared blocker, a circuit breaker, or an explicit operator pause.

### Operator pause

Operators MAY pause any non-terminal run at any time:

```sh
./bin/pan pause <run-id> [--note "<reason>"]
```

While paused, you MAY modify tracked files in the deliverable workspace as you see fit without using the changes protocol. Resume with `./bin/pan resume <run-id>` to continue from the saved gate (supervisor assessment, operator approval, or prepare). Use `./bin/pan resume <run-id> --stage <slug>` when you intentionally want to restart at a different stage instead.

Resume from the stage that owns the remediation when the pause was harness-initiated (blocker, circuit breaker, or ledger anomaly). Do not resume from review or test when the defect belongs to implementation.

- `./bin/pan resume <run-id> --stage implement --note "<required changes>"` restarts implementation and attaches the note to the next invocation card as remediation input.

### Operator stage repair

`./bin/pan set-stage <run-id> --stage <stage> --note "<reason for repair>"`
moves the run directly to any stage without following the current transition. It
clears the active invocation, resets the target segment's attempt budget and the
transition/failure circuit-breaker counters, records an `operator_stage_set`
event, and attaches the repair note to the next invocation.

This command is operator-only. Never invoke it while a pipeline agent is still
executing; terminate that process first so an obsolete worker cannot continue
writing after the run has moved. Use it for deliberate state repair, not normal
review or QA remediation.

## Cooperative lock contract

While a mutating workflow is active, avoid editing tracked files outside
Pancreator. Pancreator locks are cooperative evidence records only; they do not
prevent editors, scripts, or other processes from writing files. External edits
may surface as unledgered anomalies during `validate-changes`.

Use the protocol commands when a worker modifies tracked files:

- `./bin/pan changes begin <run-id> <path>`
- `./bin/pan changes commit <run-id> <path> --lock <lock-id>`
- `./bin/pan changes cancel <run-id> <path> --lock <lock-id>`

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

# Operator guide

## The normal interaction

Use `/pan-start` for a new request and `/pan-resume <run-id>` thereafter. The supervisor should always show:

1. current run and stage
2. what completed or failed
3. where the evidence lives
4. what decision or action is required next

Raw JSONL and shell output are diagnostic surfaces, not the default conversation.

### Supervisor continuation

`ORCH-001` is the normative continuation policy. In practice, keep advancing
supervisor-owned `pending_action` values and stop only at an operator-owned or
terminal action.

## Invocation and delegation validation

`INVOCATION-001` is the normative invocation-card and delegation policy. Each
prepared invocation writes
`invocations/<invocation-id>.invocation-validation.json`. If prepare fails,
read that artifact for the failing checks before retrying.

When `pending_action` is `invoke_agent`, deliver the canonical invocation card
according to `INVOCATION-001` and persist its delegation audit artifact. Before
`./bin/pan submit`, confirm delegation validation passed. Rejection with
`DELEGATION_ARTIFACT_MISSING` or `DELEGATION_VALIDATION_FAILED` leaves the run
on the same invocation so delivery can be corrected and resubmitted.

`./bin/pan status` includes a dedicated validation section with invocation and
delegation validation state, artifact paths, and short failure reasons.

## Assess unusually large intake

Use `/pan-decompose <intake spec>` before starting a workflow when the request may contain multiple independently valuable outcomes or prerequisite decisions. `DECOMP-001` is intentionally conservative: the decomposer defaults to one larger run, requires every proposed chunk to be independently testable and safely completable, and then requires either a hard decomposition trigger or broad complexity pressure across several dimensions. File count, frontend/backend boundaries, tests, documentation, and implementation phases are not valid split boundaries by themselves.

The decomposer also compares reduced implementation, review, and remediation risk against the repeated intake, planning, review, QA, release, and coordination cost of additional runs. Marginal cases remain intact. Valid decompositions normally contain two to four dependency-ordered chunks, preserve requirement traceability, and write a validated packet under `runtime/inbox/` whose chunks can be passed directly to `/pan-start`.

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

For ordinary target work, install Pancreator into the target repository and open that target in Cursor. `.pancreator/project.json` sets `workspace_root` to `..`, so workflow fingerprints, gate commands, and scope guards apply to the target automatically. Confirm the workspace shown on each invocation card before trusting gate results. `--workspace` remains an explicit override for exceptional self-development or migration work, not the default deployment model.

Bootstrap a target with `./bin/install --target <path>` from the Pancreator source checkout, then run `./.pancreator/bin/pan doctor` and `./.pancreator/bin/pan validate` from the target. See [`docs/embedded-installation.md`](embedded-installation.md) for Cursor merge semantics, versioned updates, partial-install prompts, and cleanup.

## Intake approval

Check that the product specification:

- preserves the request without broadening it
- describes observable user outcomes
- names constraints and out-of-scope behavior
- exposes open questions rather than hiding assumptions

Approve only with an explicit instruction. Rejection routes back to intake and carries your latest `--note` forward as a required input for the retry; older feedback remains in the generated context manifest.

## Pauses

A pause is not a generic failure. Read `last_decision_path` in `state.json` or use `/pan-status`. Typical causes are missing evidence, an agent-declared blocker, a circuit breaker, or an explicit operator pause.

### Operator pause

Operators MAY pause any non-terminal run at any time:

```sh
./bin/pan pause <run-id> [--note "<reason>"]
```

While paused, you MAY modify tracked files in the deliverable workspace without
using the changes protocol. On resume, including resume with `--stage`,
Pancreator compares the workspace to the pause-start snapshot. Authorized
changes are added to the workspace ledger under a ratification artifact, the
new fingerprint is accepted, and any prepared invocation is invalidated so it
can be regenerated against the changed workspace. Changes that predated the
pause are not silently ratified. Resume with `./bin/pan resume <run-id>` or
deliberately restart at a different stage with `--stage <slug>`.

Resume from the stage that owns the remediation when the pause was harness-initiated (blocker, circuit breaker, or ledger anomaly). Do not resume from review or test when the defect belongs to implementation.

- `./bin/pan resume <run-id> --stage implement --note "<required changes>"` restarts implementation and attaches the latest note to the next invocation card as required remediation input.

### Waiving a failed workflow gate

Use a gate waiver only for a failed non-harness workflow stage whose remaining
misses are understood and intentionally accepted:

```sh
./bin/pan waive-gate <run-id> \
  --criteria <failed-id[,failed-id...]> \
  --note "<reason>" \
  [--stage <stage>] \
  [--defer <acceptance-id[,acceptance-id...]> --spotfix]
```

`WAIVER-001` is normative. The command is fail-closed: the listed criterion IDs
must exactly match every failed hard criterion from the latest failed attempt,
and the workspace must still match that attempt's fingerprint. A generic resume
note is not a waiver. Harness anomalies continue to use their purpose-built
operator commands.

When bounded acceptance misses are deferred with `--defer ... --spotfix`, the
waiver creates an inbox case recording the misses and source evidence. The case
is intake evidence only: it must still satisfy `WORK-001` before lightweight
execution. Waivers and open follow-up cases remain visible in status and the
release packet.

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

- review and QA passed against the current workspace, or any exceptions are
  explicit fingerprint-bound waivers
- deferred acceptance criteria have an owned follow-up case
- residual risks are acceptable
- rollback guidance is credible
- the proposed commit/PR text accurately describes the diff

Approval marks the workflow succeeded. It does not itself create a commit, PR, merge, or deployment.

### Rejecting a release packet

Rejection routes remediation to the stage that owns the fix and carries your feedback forward to that stage's worker as a required input.

- `./bin/pan decide <run-id> reject --note "<what is wrong>"` sends the run back to implementation by default, then naturally re-runs review, QA, and ship.
- `./bin/pan decide <run-id> reject --stage plan --note "<what is wrong>"` sends it back to planning when the defect is architectural rather than a coding error.
- `--stage <slug>` may target any stage in the workflow. The chosen stage and every stage after it restart with fresh attempt budgets, since you are deliberately reworking that segment.

Always include a `--note`. The feedback is written to `artifacts/markdown/operator-feedback-<n>.md` and attached to the remediation invocation; without it the worker only knows the prior output was unacceptable.

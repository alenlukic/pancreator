# Runtime protocol

## Run invariants

- One run executes one workflow snapshot and one pipeline model-config snapshot.
- A run has exactly one current stage or a terminal status.
- A run exposes exactly one pending action.
- State changes occur under a per-run exclusive file lock.
- `state.json` is atomically replaced; `events.jsonl` is append-only.
- Every invocation has a unique ID and one canonical output path.
- Repeating `pan prepare` while an invocation is pending returns the same invocation.
- Output from any other invocation ID is rejected.
- Every prepared invocation writes `invocations/<invocation-id>.invocation-validation.json` beside the invocation files. Prepare fails closed when the rendered card omits required policy snapshot text.
- Every delegated worker invocation requires `invocations/<invocation-id>.delegation.md` containing the unchanged canonical invocation card. Submit rejects advancement when delegation validation is missing or failed and writes `invocations/<invocation-id>.delegation-validation.json`.

## Invocation and delegation validation

During `prepare`, the harness validates the rendered invocation markdown against the invocation-time policy snapshot and writes `invocations/<invocation-id>.invocation-validation.json`. Prepare fails closed when validation fails; the artifact records the failing checks.

During `submit`, the harness validates `invocations/<invocation-id>.delegation.md` against the canonical invocation markdown, writes `invocations/<invocation-id>.delegation-validation.json`, and rejects advancement before stage history changes when the delegation artifact is missing or invalid. Orchestrator-owned stages that complete in the current chat do not require a delegation artifact.

`./bin/pan status` renders a dedicated validation section from the active invocation's validation artifacts. Missing or malformed artifacts are reported as observable state rather than crashing status.

## Pending actions

| Action                  | Owner                     | Meaning                                           |
| ----------------------- | ------------------------- | ------------------------------------------------- |
| `prepare_invocation`    | supervisor/CLI            | Generate the next immutable invocation card       |
| `invoke_agent`          | supervisor + named worker | Execute the card and write its declared output    |
| `supervisor_assessment` | supervisor                | Judge only the listed prose criteria              |
| `operator_approval`     | operator                  | Ratify intake or release preparation              |
| `operator_decision`     | operator                  | Resolve a pause/circuit breaker or operator pause |
| `none`                  | nobody                    | Run is terminal                                   |

### Supervisor continuation contract

- The supervisor MUST run a continuation loop for every non-terminal run:
  1. inspect `pending_action`,
  2. perform only that action,
  3. re-check `pending_action`.
- The supervisor MUST continue without operator handoff while `pending_action` is one of:
  `prepare_invocation`, `invoke_agent`, `supervisor_assessment`.
- The supervisor MUST stop and request operator input only when `pending_action` is one of:
  `operator_approval`, `operator_decision`, or when the run is terminal (`none`).
- The supervisor MUST NOT ask the operator to run `/pan-resume` or equivalent while a supervisor-owned pending action remains.

## Effective stage outcome

A stage is successful only when all of the following hold:

1. Output shape is valid and belongs to the active invocation.
2. Every declared criterion has a self-evaluation.
3. No hard self-evaluated criterion is failed or marked not applicable.
4. Workspace mutation policy is respected.
5. Every hard deterministic criterion passes.
6. The worker result is `success`.

A `blocked` result pauses. A failure follows the declared remediation transition. A successful result may still wait at a supervisor or operator gate.

## Workspace change tracking

Pancreator tracks accepted workspace state with a checksum index at
`<state-root>/workspace/index.json`, a per-workflow immutable baseline at
`<state-root>/workflows/<run-id>/baseline.json`, cooperative file locks under
`<state-root>/locks/`, and an append-only ledger at
`<state-root>/workflows/<run-id>/modifications.jsonl`.

Mutating workflows run a harness-owned deterministic `validate-changes` stage
before ship. The stage compares baseline, ledger, accepted index, filesystem,
and active locks. Any hard anomaly yields
`operator-review-required` in `ledger-validation.json` and pauses the run for
operator adjudication.

## Operator rejection

At an operator gate, `./bin/pan decide <run-id> reject` follows the stage's declared `failure` transition (the ship stage routes to `implement`, intake retries `intake`). The operator MAY override the remediation target with `--stage <slug>`, which is restricted to a real stage in the workflow. An overridden target, and every stage declared after it, restarts with a fresh attempt budget, and consecutive-failure tracking is cleared because the rewind is an explicit human decision rather than an automated retry. In all cases the operator's `--note` is written to `artifacts/operator-feedback-<n>.md` and attached to the remediation invocation as a required input reference.

## Operator stage repair

`./bin/pan set-stage <run-id> --stage <stage> --note "<reason>"` is an
operator-only escape hatch that may target any stage regardless of the run's
current stage or status. It validates the target against the run's immutable
workflow snapshot, clears the active invocation, resets attempts from the target
forward, resets transition and consecutive-failure budgets, and makes
`prepare_invocation` the next action.

The command writes an operator-feedback artifact and an `operator_stage_set`
event. The artifact is included in the next invocation's input references, so
the target worker receives the reason for repair. Durable state cannot observe
whether a Cursor worker process is still executing; the operator MUST terminate
any executing pipeline agent before invoking the command. Agents MUST NOT invoke
it.

## Deliverable workspace

Each run declares a deliverable workspace at `./bin/pan init --workspace <dir>`, stored as `workspace_root` in `state.json` and defaulting to the repository root (`.`). The harness fingerprints that directory's Git state, runs every shell gate command with that directory as the working directory, and evaluates `scope.no_unapproved_changes` against it. The target MAY be a nested Git repository, including one the surrounding repository ignores; Git runs with that directory as its working directory and is scoped with a `.` pathspec, so changes inside the deliverable are observed even when the outer repository ignores the path. Each invocation card states the active workspace so the worker and operator can see what is being fingerprinted and gated. A run whose deliverable is not its declared workspace produces deterministic evidence about the wrong files; declare the workspace so the gates measure the actual work.

## Gate overrides

Deterministic shell gates default to the commands declared in the workflow snapshot, which assume a particular project shape. A run MAY supply `./bin/pan init --gates <file>` mapping a shell criterion id to a replacement command, or to `false` to disable that gate. Overrides are stored in `state.gate_overrides`, listed on each invocation card, and recorded on every deterministic result (`overridden` or `disabled`) so a customized or skipped gate is never silent. Use overrides to make gates measure the actual deliverable rather than weakening assurance; disabling a hard gate is an explicit, audited operator choice.

## Evidence and invalidation

Every deterministic check records:

- exact command
- start and finish time
- exit code or signal
- stdout and stderr
- workspace fingerprint

Review and QA records also carry a workspace fingerprint. Ship refuses stale QA evidence if the Git-visible workspace changed after QA.

## Circuit breakers

Each workflow declares:

- maximum total transitions
- maximum attempts per stage
- maximum consecutive failures

Exceeding a limit pauses the run and writes a decision record. The operator may resume from an explicit stage or abort. The harness never silently resets a budget.

## Recovery

- Inspect: `./bin/pan status <run-id> --json`
- Operator pause: `./bin/pan pause <run-id> [--note "reason"]`
- Resume same stage: `./bin/pan resume <run-id>`
- Resume chosen stage: `./bin/pan resume <run-id> --stage implement`
- Repair directly to any stage: `./bin/pan set-stage <run-id> --stage <stage> --note "reason"`
- Accept an intentional change: `./bin/pan accept-change <run-id> --note "reason"`
- Abort: `./bin/pan abort <run-id> --note "reason"`

### Operator pause

Operators MAY pause any non-terminal run at any time with `./bin/pan pause <run-id> [--note "reason"]`. The harness saves the current gate (`running`, `awaiting_supervisor`, or `awaiting_operator`) and its pending action. While paused, operators MAY modify tracked files in the deliverable workspace without the changes protocol. `./bin/pan resume <run-id>` restores the saved gate; `--stage` overrides that restoration and restarts at the chosen stage with `prepare_invocation`, matching harness-pause resume semantics.

### Accepting an intentional workspace change

The `ship.prior_gates_current` gate requires that review and QA evidence was produced against the workspace fingerprint that ship sees. If the operator intentionally changed tracked files (so the current fingerprint differs from the one review/QA certified), the run pauses for an operator decision.

`./bin/pan accept-change <run-id>` lets the operator attest that the current workspace is intentional. It:

- requires the run to be `paused` with a pending `operator_decision`,
- pins the current workspace fingerprint into `accepted_workspace_fingerprint`,
- returns the run to `running` at the same stage (no review/test re-loop), and
- records an auditable decision plus a `workspace_change_accepted` event.

Acceptance is pinned to the exact accepted fingerprint: review and QA must already have passed, and any _further_ tracked-file change after acceptance re-flags the gate. Acceptance only excuses a stale fingerprint; it never substitutes for missing review/QA evidence.

Do not repair state by editing files. Use `pan set-stage` for an audited stage repair and preserve the reason in `--note`.

## Pipeline model snapshot

At run creation, the harness resolves `project.json` `active_config`, verifies
that projected Cursor agent models are synchronized, and writes
`pipeline-config.snapshot.json` into the run directory. Each invocation resolves
its persona from that snapshot and records both `stage.model` and
`stage.model_config`. Preparing a snapshotted run requires the live active mapping and projected
Cursor-agent frontmatter to still match that snapshot. A configuration switch
therefore blocks older runs until their mapping is restored; this prevents an
invocation card from claiming one model while Cursor executes another. Runs
created before model snapshots use the current live mapping for backward
compatibility.

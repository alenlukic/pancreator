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
- Invocation preparation and delegation conform to `INVOCATION-001`; their
  validation artifacts make policy delivery observable and fail closed.

## Runtime naming

`DATETIME_ANCHOR` is `2200-01-01T00:00:00.000Z`. A run ID is
`<days-to-anchor>_<MMM-DD>_<uuid-suffix>`, where days-to-anchor is the floor of
the UTC duration from the run creation instant to the anchor divided by one day.

Stage-scoped artifact IDs are
`<reverse-step>_<stage>-<stage-iteration>_<uuid-suffix>`. While a run is open,
the reverse step is the two-digit value `99 - stage sequence in the run`, where
the first stage occurrence is sequence `0`. Each prepared worker invocation and
executed harness stage consumes the next sequence. Sequence `0` is `99` and
sequence `8` is `91`. Retries and workflow loops receive their actual
chronological sequence rather than reusing the stage's position in the workflow
definition.

When a run becomes terminal (`succeeded`, `failed`, or `canceled`), the harness
automatically invokes the artifact finalizer. It renumbers all stage occurrences
against the actual count so the final occurrence is `00`; a seven-stage run is
renumbered from `99` through `93` to `06` through `00`. A workflow run supports
at most 100 stage occurrences. The finalizer is idempotent and can be invoked
manually with `npm run finalize:workflow-artifacts -- <run-id> [root]`.

Execution records are stored only as machine-readable JSON in
`artifacts/json/<artifact-id>.json`. Stage-authored Markdown and other
operator-facing documents are stored under `artifacts/markdown/`.

Supervisor assessment files retain the invocation artifact ID as their sortable
prefix: `<invocation-id>.assessment-request.json` and
`<invocation-id>.assessment.json`.

Legacy runtime records are migrated with `npm run migrate:workflow-names`. The
migration is idempotent, chooses open or terminal numbering from run status,
consolidates legacy `records/` and flat `artifacts/` contents, removes redundant
rendered execution-record Markdown, removes an empty
legacy `--help` run directory, and updates persisted references alongside names.

## Invocation and delegation validation

During `prepare`, the harness validates the rendered invocation markdown against
the invocation-time policy snapshot and writes
`invocations/<invocation-id>.invocation-validation.json`. During `submit`, it
validates the delegation audit artifact and writes
`invocations/<invocation-id>.delegation-validation.json` before stage history
can advance. `INVOCATION-001` defines the canonical delivery contract and the
orchestrator-owned-stage exception.

`./bin/pan status` renders a dedicated validation section from the active
invocation's validation artifacts. Missing or malformed artifacts are reported
as observable state rather than crashing status.

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

`ORCH-001` defines how the supervisor consumes `pending_action`, which actions it
must continue through, and where operator handoff is required.

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

At an operator gate, `./bin/pan decide <run-id> reject` follows the stage's declared `failure` transition (the ship stage routes to `implement`, intake retries `intake`). The operator MAY override the remediation target with `--stage <slug>`, which is restricted to a real stage in the workflow. An overridden target, and every stage declared after it, restarts with a fresh attempt budget, and consecutive-failure tracking is cleared because the rewind is an explicit human decision rather than an automated retry. In all cases the operator's `--note` is written to `artifacts/markdown/operator-feedback-<n>.md` and attached to the remediation invocation as a required input reference.

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

## Operator gate waivers

An operator MAY waive failed hard criteria from a non-harness workflow stage
with `./bin/pan waive-gate`. `WAIVER-001` defines the constraints. The waiver is
bound to the failed attempt, the complete set of failed hard criterion IDs, and
that attempt's exact workspace fingerprint. Missing or malformed output,
workspace drift, partial criterion selection, and harness-stage failures are not
waivable through this mechanism.

The waiver becomes stage-history evidence rather than rewriting the failed
attempt as successful. Downstream gates may honor the explicit waiver, while
status and release artifacts continue to identify the exception. Deferred
acceptance criteria require `--spotfix`, which creates a linked inbox case; that
case must independently qualify for lightweight work under `WORK-001`.

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
- Waive a failed workflow gate: `./bin/pan waive-gate <run-id> --criteria <ids> --note "reason"`
- Abort: `./bin/pan abort <run-id> --note "reason"`

### Operator pause

Operators MAY pause any non-terminal run at any time with `./bin/pan pause <run-id> [--note "reason"]`. The harness saves the current gate, pending action, and workspace snapshot. While paused, operators MAY modify tracked files in the deliverable workspace without the changes protocol. Every resume, including one with `--stage`, reconciles pause-period changes into the workspace ledger, records a ratification artifact, accepts the resulting fingerprint, and invalidates a stale prepared invocation. A normal resume restores the saved gate; `--stage` restarts at the chosen stage with `prepare_invocation`. The harness refuses to auto-ratify divergence that already existed when the pause began.

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

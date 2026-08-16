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
`<days-to-anchor>_<MMM-DD>-<minutes-to-end-of-UTC-day>_<keyword-suffix>`, where
days-to-anchor is the floor of the UTC duration from the run creation instant to
the anchor divided by one day. The minute component is the ceiling of the
remaining duration to the next UTC midnight, zero-padded to four digits. For
example, a run created at `2026-07-03T23:00:00Z` is named
`63368_Jul-03-0060_<keyword-suffix>`.

The suffix is a hyphenated high-signal keyword slug of at most 12 characters
derived from the request name (falling back to request content), so a listing
reveals what each run was about at a glance; abrupt mid-word cutoffs are
accepted. Timestamps, stopwords, and UUID/commit hex fragments are stripped
from the seed. When two same-minute runs derive identical keywords the later
one takes an ordinal (`…_fixture-2`), and when no keywords are derivable the
suffix falls back to the legacy 8-hex UUID fragment, which remains valid.
Best-of-N session and standalone session directories use the same convention.

Every non-durable file under `runtime/inbox/` and `runtime/pr-descriptions/`
uses the same temporal prefix: `<prefix>_<slug>.<ext>`. Operator-chosen keyword
slugs are kept verbatim; only missing or opaque hex slugs are re-derived from
file content.

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

New runs use layout v2. Machine state and evidence live under `agent/`.
Operator-readable files live under `operator/`. The request and rendered stage
briefs are operator files. State, events, snapshots, invocations, outputs,
assessments, decisions, validations, and task records are agent files.

The harness scaffolds brief source JSON under `agent/artifacts/json/`. During
submission, it renders the operator HTML and validates both the output and
brief. A successful validation records the source checksum and deletes the
source. A failed render or validation retains the source for diagnosis. Layout
v1 runs retain their original root-level directories and artifact lifecycle.

Supervisor assessment files retain the invocation artifact ID as their sortable
prefix: `<invocation-id>.assessment-request.json` and
`<invocation-id>.assessment.json`.

`./bin/pan archive` performs idempotent runtime maintenance in four passes:

1. **Name standardization** renames non-compliant files under `runtime/inbox/`
   and `runtime/pr-descriptions/` onto the temporal prefix scheme, recovering
   the timestamp from the legacy name when one is embedded and from file
   modification time otherwise, then rewrites persisted references.
2. **Prefix migration** migrates recognized legacy workflow directory names,
   chooses open or terminal artifact numbering from run status, consolidates
   legacy `records/` and flat `artifacts/` contents, removes redundant rendered
   execution-record Markdown, removes an empty legacy `--help` run directory,
   and updates persisted references alongside names.
3. **Suffix migration** replaces legacy 8-hex directory suffixes under
   `runtime/logs/workflows/`, `runtime/logs/best-of-n/`, and
   `runtime/logs/sessions/` (archives included) with keyword suffixes derived
   from run state, again rewriting references. Directories without a derivable
   seed, and best-of-N sessions whose worktrees still exist on disk, keep their
   hash suffix and are reported as skipped.
4. **Archiving** moves everything non-durable older than the retention window
   into the owning directory's `archive/` child: workflow directories from both
   `runtime/logs/workflows/` and the legacy `runtime/workflows/` mirror,
   standalone session directories, best-of-N session directories, and temporal
   files in `runtime/inbox/` and `runtime/pr-descriptions/` (their prefix is
   the age authority). Archived items are excluded from active discovery.

The default retention window is seven days. Use `--days <positive-integer>`
only when deliberately overriding it. Embedded installs run the same
maintenance on every refresh and update.

## Invocation and delegation validation

During `prepare`, the harness validates the rendered invocation markdown against
the invocation-time policy snapshot. Layout v2 writes the result under
`agent/validations/`. During `submit`, it validates the delegation audit before
stage history can advance. `INVOCATION-001` defines the canonical delivery
contract and the supervisor-owned-stage exception.

Every prepared worker card also ends with a **Supervisor delivery procedure**
section carrying that policy with this invocation's resolved paths. The
supervisor holds no card of its own during the continuation loop, so the contract
travels on the artifact it must already read to deliver the card. The section is
part of the canonical body: removing it breaks delegation equality, and its
presence is checked by the invocation validator.

## External stage executors

A persona mapping may carry an executor prefix from a closed set: `cursor`
(the default, no prefix required) or `claude-code`, as in
`"reviewer": "claude-code:claude-opus-5[permission-mode=default,session-resume=true]"`.
A stage whose persona resolves to `claude-code` is not delegated by the
supervisor. Instead, `pending_action: invoke_agent` is fulfilled by running
`pan delegate <run-id>`: the harness pipes the complete canonical card to the
operator-installed Claude Code CLI (`claude -p --output-format json`), working
directory set to the run's workspace root, and awaits the result. Verbatim
delivery becomes a property of code, so no delivery prompt, contract manifest,
or read attestation is generated for external invocations.

The harness authors the delegation audit itself: the delivered prompt body byte
for byte at `agent/invocations/<invocation-id>.delegation.md`, and an execution
record at `agent/invocations/<invocation-id>.delegation-execution.json` carrying
executor identity, the resolved argument vector (excluding the prompt body),
exit status, duration, and the returned `session_id`. Executor stdout and
stderr are captured under `agent/evidence/` per the OUTPUT-001 pattern.
`delegation-validate` passes on these harness-authored records.

Delegation is preflighted fail-closed per `EXECUTOR-001`: run creation verifies
the binary exists at or above the tested minimum version, and the first
delegation of a run verifies credentials with a no-op invocation. A failed
preflight pauses the run with an `operator_decision`; the harness never
silently substitutes an executor, because that would falsify the model
snapshot. The spawned process runs non-interactively under a stage-derived
tool policy — stages that do not permit source mutation receive write tools
only inside the harness runtime tree — while `scope.no_unapproved_changes`
remains the gate of record for workspace mutation.

Sessions persist beside the invocation artifacts
(`agent/invocations/<invocation-id>.session.json`) and on the run state. When
`pan decide <run-id> revise` re-runs an external stage, the harness resumes the
recorded session with the operator directive (`--resume <session_id>`) so the
author keeps its full context; the delivered directive is persisted as both the
delivery prompt and the delegation artifact. A failed resume falls back to a
fresh full-card delegation and is audited as `resume_fallback`. A retry after a
_failed_ attempt never resumes: the retry contract requires confronting the
recorded failure, and `prior_failure` inlining serves that. Mapping option
`session-resume=false` disables resumption for a persona.

`./bin/pan status` renders a dedicated validation section from the active
invocation's validation artifacts. Missing or malformed artifacts are reported
as observable state rather than crashing status.

## Invocation context projection

Each agent stage declares a `context` projection in its stage definition. During
`prepare`, the harness resolves only the effective stage outputs, bounded prior
attempts, targeted operator feedback, and active exception evidence required by
that stage.

Invocation references have three retrieval classes:

- `required`: the worker MUST read the artifact before stage work.
- `conditional`: the worker reads the artifact only when its rendered condition
  applies.
- `index_only`: the worker MUST NOT expand the reference merely because it is
  listed.

The harness writes
`agent/invocations/<invocation-id>.context-manifest.json` when workflow records are
omitted from the card or required context is unavailable. The manifest preserves
full traceability without making superseded history part of the default model
context. It may be opened only to resolve a named inconsistency, missing
disposition, provenance question, or missing required input.

For selected stage outputs, the semantic output is the primary reference. The
matching execution record is conditional provenance evidence rather than a
second required read. A required selector that cannot be resolved is surfaced
under `Missing required context`; the worker MUST report the gap instead of
inventing state.

Immutable workflow snapshots created before context projections existed retain
legacy all-history input behavior for compatibility. New runs use the scoped
`context` declarations in the current workflow files.

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

### Same-reason circuit breaker

The broad workflow attempt and consecutive-failure limits are not the only retry
controls. Pancreator tracks normalized hard-failure signatures for review, test,
and every stage whose failure transition loops directly to itself. The second
consecutive failure with the same signature pauses the run for
`operator_decision` before another invocation is prepared. A successful attempt,
an operator waiver, or an explicit operator rewind clears the tracker.

For an implementation self-loop, the retry invocation includes the prior failed
attempt and requires `implementation.remediation`. The coder must identify the
recorded cause, make a targeted change that addresses it, and provide evidence.
An unchanged or paperwork-only retry is invalid even when the general attempt
budget has capacity.

### Pre-implementation repository-check baseline

Baselines cover every repository-check profile referenced by any shell criterion anywhere in the run's workflow, captured once before the first `source_allowed` stage edits anything — not only the profiles of the stage being prepared. A terminal gate such as a QA stage's `full` profile otherwise has nothing to compare against, so pre-existing target breakage unrelated to the change under test hard-fails the run. Capturing all profiles up front also amortizes the slow ones.

Immediately before the first coder invocation, the harness runs every configured
repository-check profile referenced by deterministic stage gates (for example
implementation `static`/`fast`, QA `full`, and ship `configuration`) and saves
run-scoped baseline evidence. The same profiles run again at submission for
their owning stages. A profile that still reports only normalized diagnostics
already present in the baseline is recorded as a visible
`preexisting_failure` but passes the workflow gate. Any new command failure,
changed exit behavior, or new/changed diagnostic fails the gate. A passing
baseline that later fails always blocks.

Baselines are captured only for attempt 1. An upgraded in-flight run that has
already entered a later implementation attempt does not retroactively baseline
its modified workspace.

## Workspace boundaries

Pancreator fingerprints Git-visible source state without recursively indexing the filesystem. Compiled artifacts, caches, virtual environments, and third-party dependency/package directories are excluded from fingerprints and are outside agent remit. There is no pre-ship workspace-audit stage.

Governance, invocation, delegation, path-resolution, and operator-artifact diagnostics are non-blocking before ship and are accumulated for release-steward review. The release steward repairs safe runtime-only issues and continues; a materially concerning implementation, test, security, or release issue returns `blocked` and pauses for the operator. These diagnostics never route the workflow back to implementation.

## Operator rejection

At an operator gate, `./bin/pan decide <run-id> reject` follows the stage's declared `failure` transition (ship pauses for operator-directed remediation; intake retries `intake`). The operator MAY override the remediation target with `--stage <slug>`, which is restricted to a real stage in the workflow. An overridden target, and every stage declared after it, restarts with a fresh attempt budget, and consecutive-failure tracking is cleared because the rewind is an explicit human decision rather than an automated retry. In all cases the operator's `--note` is written to `agent/decisions/operator-feedback-<n>.md` (`decisions/` in a legacy-layout run). The most recent feedback targeting the remediation stage is attached as a required input; older feedback remains discoverable through the context manifest.

## Operator stage repair

`./bin/pan set-stage <run-id> --stage <stage> --note "<reason>"` is an
operator-owned escape hatch that may target any stage regardless of the run's
current stage or status. It validates the target against the run's immutable
workflow snapshot, clears the active invocation, resets attempts from the target
forward, resets transition and consecutive-failure budgets, and makes
`prepare_invocation` the next action.

The command writes an operator-feedback artifact and an `operator_stage_set`
event. The most recent artifact targeting the repaired stage is included as a required
input, so the target worker receives the repair reason without inheriting older,
superseded feedback by default. Durable state cannot observe whether a Cursor worker process is still executing. Stopping an obsolete worker first is operationally prudent, but it is not a restriction on operator authority. Agents MUST NOT originate the decision, but MUST invoke the command when the operator explicitly directs it.

## Deliverable workspace

Each run declares a deliverable workspace at `./bin/pan init --workspace <dir>`, stored as `workspace_root` in `state.json` and defaulting to the repository root (`.`). The harness fingerprints that directory's Git state, runs every shell gate command with that directory as the working directory, and evaluates `scope.no_unapproved_changes` against it as an external-contamination check. A worker may declare `workspace_changes.attribution: internal` with every changed path to show that the delta came from the active stage; those traced changes remain visible but do not block. External, mixed, unknown, or unattributed deltas still fail the gate. The target MAY be a nested Git repository, including one the surrounding repository ignores; Git runs with that directory as its working directory and is scoped with a `.` pathspec, so changes inside the deliverable are observed even when the outer repository ignores the path. Each invocation card states the active workspace so the worker and operator can see what is being fingerprinted and gated. A run whose deliverable is not its declared workspace produces deterministic evidence about the wrong files; declare the workspace so the gates measure the actual work.

## Gate overrides

Deterministic shell gates default to the commands declared in the workflow snapshot, which assume a particular project shape. A run MAY supply `./bin/pan init --gates <file>` mapping a shell criterion id to a replacement command, or to `false` to disable that gate. Overrides are stored in `state.gate_overrides`, listed on each invocation card, and recorded on every deterministic result (`overridden` or `disabled`) so a customized or skipped gate is never silent. Use overrides to make gates measure the actual deliverable rather than weakening assurance; disabling a hard gate is an explicit, audited operator choice.

## Operator involvement and run contracts

A run resolves one operator-involvement profile at `./bin/pan init [--involvement <profile>]` from `config.json.operator_involvement`, rewrites the gates in its own `workflow.snapshot.json`, and records the resolution in `state.operator_involvement` (`profile`, `summary`, `contracts`, and `applied_gates` for every stage whose gate differs from the workflow default). Because the snapshot is authoritative for the run, a later edit to `config.json` cannot change a run in flight. Each invocation card renders the profile, active contracts, and applied gates so the worker and operator see where the run will stop.

Gates resolve by ascending specificity: the workflow's declared gate, then the profile's `*` gate, then run-contract escalations keyed by stage `checkpoint`, then the profile's explicit per-stage gate. A stage declaring `gate_relaxable: false` rejects any assignment that lowers operator involvement; escalation is always permitted.

A run contract is orthogonal to workflow choice and attaches by stage `checkpoint` role rather than stage slug. `technical_director` escalates `technical_plan` and `independent_review` checkpoints to operator gates and activates the `contract`-scoped policy lookup row that loads `DIRECTOR-001`, keeping run contracts inside the single policy applicability map rather than a second one that could drift. An operator gate reached under an active contract carries `pending_action.checkpoint` so the supervisor presents refinement options rather than a plain approve/reject.

## Review mode

A run resolves one review mode at `./bin/pan init [--review-mode <mode>]` from `config.json.review_mode`, and records it in `state.review_mode` and on every invocation card. `default` is one reviewer reading the whole change, which is what the review stage prompt and `REVIEW-001` describe on their own. `squad` activates a `review_mode`-scoped policy lookup row that loads `REVIEW-002`, whose `guidance_sources` reference `library/skills/review-squad.md` on the reviewer's card. The run snapshots the resolution, so a later edit to `config.json` cannot change a run in flight.

Review mode selects the method by which findings are gathered, not the authority over them. Under `squad` the reviewer stays the coordinator: it captures the diff once, writes an intent brief, delegates one agent per review dimension in parallel, and joins the returned findings into one ranked set. `REVIEW-001` continues to own the verdict, the reviewer remediation boundary, and routing to implementation, and a dimension agent never edits a file. The mode is a scalar rather than a profile map, because the only decision it carries is which review method a run adopts.

## Operator revisions

`./bin/pan decide <run-id> revise --note <directive>` records an operator refinement of otherwise acceptable work. It writes an operator-feedback artifact, re-runs the same stage with that directive as required input, clears the stage's same-reason tracker, and transitions as operator-directed so run-wide limit counters are unaffected. Each revision increments `state.operator_revisions[<stage>]`, which raises that stage's attempt ceiling by one: a refinement round is not a failed attempt and must not consume budget reserved for failures. `reject` remains the path for work the operator declares unacceptable.

## Attempt accounting

`max_stage_attempts` bounds retries of the stage a run is currently on rather than lifetime visits. Leaving a stage for a different target clears `state.attempts[<stage>]` and its granted revisions, so a later return to that stage starts fresh; the per-attempt record remains in `stage_history`. Because a transition only reaches a different stage after the stage's gate has passed, this is equivalent to resetting when a stage is fully gated. An invocation prepared but never submitted performed no work and does not consume an attempt: the next `prepare` reuses that attempt number. Run-wide looping stays bounded by `max_total_transitions`, `max_consecutive_failures`, and the same-reason circuit breaker.

## Retry failure disclosure

When a stage retries after a failure, its invocation carries `prior_failure` and the card renders a **Why the previous attempt failed** section inlining the failed hard criteria with their recorded explanations, the failed deterministic checks with commands and evidence paths, output validation errors, and governance diagnostics. `stage_history` records each attempt's `self_criteria` so a failure caused solely by a judgment criterion is recoverable from durable state. Invocation validation asserts every recorded reason is actually inlined. A path reference to the prior output is not sufficient: a worker handed only a pointer tends to resubmit the same defect.

## Bounded evidence

Deterministic-gate evidence logs and pre-implementation baselines bound each captured stream to a head and tail window with an explicit elision marker, and write the untruncated capture to a sibling artifact (`*.full.log`, `*.full.json`, referenced by `full_result_path`). The bounded artifact is what an invocation promotes to required reading; a multi-megabyte transcript promoted to required reading crowds out the contract it is meant to support.

## Operator gate waivers

`./bin/pan waive-gate` records and executes a flexible operator directive that bypasses ordinary process or checks. It may target the current stage or a historical stage, including a harness-owned stage, whether or not the run is paused or terminal. Malformed output, missing evidence, partial criterion selection, workspace drift, and a previously chosen failure transition do not make a waiver unavailable.

The operator note is the directive. `--criteria` is optional descriptive scope, `--stage` selects the source stage when needed, and `--to` optionally selects the destination; otherwise the waived stage's success transition is used. The harness records known failures, source and directive-time fingerprints, the operator's terms, and the resulting route, but does not reinterpret those facts as restrictions. A waiver remains active until a later attempt of the same stage supersedes it. Deferred criteria and linked spotfix cases are optional operator choices.

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
- Waive or bypass a stage/gate: `./bin/pan waive-gate <run-id> --note "directive" [--stage <stage>] [--to <stage>] [--criteria <ids>]`
- Abort: `./bin/pan abort <run-id> --note "reason"`

### Operator pause

Operators MAY pause any non-terminal run at any time with `./bin/pan pause <run-id> [--note "reason"]`. The harness saves the current gate, pending action, and workspace snapshot. While paused, operators MAY modify tracked files in the deliverable workspace directly. Every resume, including one with `--stage`, compares the pause-start snapshot with the current workspace, records a ratification artifact for pause-only changes, updates the accepted workspace fingerprint, and invalidates a stale prepared invocation. A normal resume restores the saved gate; `--stage` restarts at the chosen stage with `prepare_invocation`. The harness refuses to auto-ratify divergence that already existed when the pause began.

### Intentional operator changes

Pause before operator-authored tracked changes. Resume records the pause-only delta, updates the accepted fingerprint, and invalidates a stale invocation. If later review or QA evidence is stale, the operator may route or waive the gate explicitly with `pan set-stage` or `pan waive-gate`; agents must execute that directive.

## Pipeline model snapshot

At run creation, the harness resolves `config.json` `active_config`, verifies
that projected Cursor agent models are synchronized, and writes
`pipeline-config.snapshot.json` into the run directory. The snapshot records
each persona's executor alongside its mapping string. Each invocation resolves
its persona from that snapshot and records `stage.model`,
`stage.model_config`, and — for external personas — `stage.persona_executor`;
`stage_history` records the executor per attempt. Preparing a snapshotted run
requires the live active mapping to still match that snapshot, and projected
Cursor-agent frontmatter to match for `cursor`-executor personas; external
personas have no projected frontmatter, and `pan models --sync` removes a stale
projected agent file when a persona moves to an external executor. A
configuration switch therefore blocks older runs until their mapping is
restored; this prevents an invocation card from claiming one model while
another executes. Runs created before model snapshots use the current live
mapping for backward compatibility.

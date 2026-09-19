# Operator guide

## The normal interaction

Use `/pan-start` for a new request and `/pan-resume <run-id> [prompt]` thereafter.
Both commands adopt the supervisor brief in the operator's current session.
`/pan-start` receives your preserved request. `/pan-resume` receives the run id
and your optional prompt. The session advances the run and reports decisions
without delegating a nested `pan-orchestrator`. Each report should always show:

1. the outcome
2. the consequence
3. the next action

Stage reports do not create HTML briefs by default. Machine records and chat
reports remain available for every stage.

Raw JSONL and shell output are diagnostic surfaces, not the default conversation.

Use `/pan-summarize-context` before moving work into a fresh Cursor conversation.
It emits one copyable Markdown block containing the current goal, material
conversation history, decisions, completed work, validation, open issues, and
next actions without modifying repository state.

Run `./bin/pan archive` to migrate recognized legacy workflow names and move
workflow directories older than seven days into `archive/` under both runtime
workflow roots. The command updates persisted path references and is idempotent;
it never overwrites an existing archive target.

## Run the agent hypervisor

Start one detached hypervisor process after installation:

```sh
./bin/pan hypervisor start
./bin/pan hypervisor status
```

The process runs one non-overlapping health tick every 15 minutes. Each tick
reconciles active invocations with transcript, process, executor, and terminal
evidence. The materialized registry is
`runtime/logs/hypervisor/registry.json`; health changes and recovery evidence
append to `runtime/logs/hypervisor/events.jsonl`.

Run one foreground scan for diagnosis, or stop the detached process:

```sh
./bin/pan hypervisor tick
./bin/pan hypervisor stop
```

The hypervisor never recovers an agent whose health is unknown. It requires two
unchanged scans before a stalled verdict and quarantines the second matching
recovery failure.

## Configure away mode

Away mode is disabled by default. Enable it in `config.json` with optional
guardrails:

```json
{
  "away_mode": {
    "enabled": true,
    "guardrails": {
      "allowed_actions": [
        "approve",
        "reject",
        "revise",
        "resume",
        "set-stage",
        "waive-gate"
      ],
      "max_decisions_per_run": 3,
      "max_remediation_attempts_per_agent": 2
    }
  }
}
```

Each new run snapshots the resolved block and its digest. Existing runs without
that snapshot remain disabled. Guardrails can narrow safe actions but cannot
permit push, publication, deployment, or branch deletion. A guarded `approve`
action can apply a recorded ship-stage outcome and its workflow transition. It
cannot perform an external release action.

`waive-gate` is in the default set, so away mode can clear a gate rather than
end the session at one. It is the action to remove first when you want a
narrower absence. A waiver fits a blocker with a mechanical or administrative
root cause, or one whose blast radius is small enough to repair separately; the
evaluator states that reason in the option note, and the recorded waiver
carries the note as its directive with away authorship rather than yours.

Inspect and evaluate one named blocker:

```sh
./bin/pan away status <run-id>
./bin/pan away evaluate <run-id>
./bin/pan away apply <run-id> --decision <decision-id>
```

The evaluator ranks bounded options without tools. The ranking it grades
carries what the stage output itself declares unsettled, and an output whose
declared next action names an operator decision cannot be approved. Add
`--action <action>` to `apply` to name the action the apply must take: it is
honored when it matches the recorded recommendation and refused with
`AWAY_ACTION_REFUSED` when it does not, so the apply never substitutes a
different action. An option an away subcommand does not accept is refused with
`UNKNOWN_OPTION`. Pan validates the selected action and its rollback plan before
apply. Each evaluator transport or parse attempt writes distinct
`away-evaluator-*.json` exchange evidence, and an invalid reply is retried once.
Only a valid decision or one generic exhausted evaluator failure appends to
`runtime/logs/away-mode/decisions.jsonl`; apply results append there too. The
ledger contains neither raw malformed replies nor per-attempt parse errors, and
no command rewrites prior records. Use the selected record's `rollback_plan` for
manual reversal, then append a linked record through the same decision service.

A successful ship packet uses a deterministic approval record. That record does
not consume the evaluated decision budget. The approval changes workflow state
only and cannot authorize an external release action.

### Supervisor continuation

`ORCH-001` is the normative continuation policy. In practice, keep advancing
supervisor-owned `pending_action` values in the operator's top-level session.
When away mode is enabled, evaluate an unresolved operator action, apply one
permitted decision, inspect status, and continue from the new action. Stop only
at a real blocker or terminal state.

Real blockers include failed evaluation or apply, rejected options, exhausted
limits, failed model or delegation proof, unresolved blocked stages, and
unrecovered agent incidents. The workflow transition, stage-attempt,
consecutive-failure, away-decision, and remediation limits bound the loop.

The hypervisor reports agent health and runs bounded recovery. It does not
evaluate or apply ordinary workflow decisions.

When away mode is disabled, stop at each unresolved operator gate as before.
When the active request already supplies a decision, execute it instead of
asking again.

### Harness-owned headless driver

`driveRun` in `src/lib/headless-driver.ts` advances one run through the same
pending-action loop the eval runner uses. A harness-owned caller supplies any
operator-decision resolver and explicit authority to attest the supervisor
card. The driver prepares, delegates, and submits one stage at a time, returns
a typed operator pause instead of retrying it, and stops at a terminal state or
the caller's step bound. A caller that advances several runs starts a fresh
driver process for each run; no counters or stop reason cross that boundary.

The headless delegation option lets this driver dispatch a `cursor` persona
through the installed `cursor-agent` binary. Preflight requires the binary, a
resolved `CURSOR_API_KEY`, and a help text that still declares every flag a
stage delegation emits, so a CLI release that drops one pauses the run with a
named remedy instead of failing at spawn time. The same option reaches the
stage's parallel evidence workers: without it a Cursor evidence worker stays
skipped, and a driven run cannot advance any stage that declares one. Those
workers launch before the stage delegation, so the same preflight runs ahead
of the first of them and pauses the run with the same remedy.

The adapter pipes the rendered `<invocation-id>.delivery.md` body on stdin and
preserves the snapshotted model spec verbatim. It compares the stream's
`system/init` model against the local Cursor catalog prediction and fails on a
mismatch. The catalog is operator-local and optional, so the delegation record
states which of the two happened: `model_verification` is `compared` with the
predicted variant, or `unverifiable` with the reason no prediction existed.
Run `./bin/pan models --sync` to turn an `unverifiable` record into a real
drift check.

Cursor's CLI exposes workspace roots but no per-path write policy. The process
therefore receives the stage workspace through `--workspace` and the harness
runtime tree through `--add-dir`. Its delegation record names both roots and
states that no per-path policy was applied. `scope.no_unapproved_changes`
remains the gate of record for workspace mutation.

### Supervisor governance card and attestation

A supervisor session receives its policies the same way a worker does: as one
harness-resolved card, never as a list of policy ids to look up. After
`pan init`, or before the first `pan prepare` of a resumed run, the supervisor
runs:

```bash
./bin/pan governance card --mode supervisor --run <run-id>
./bin/pan governance attest-supervisor <run-id> --sha256 <digest>
```

The first command writes
`runtime/logs/workflows/<run-id>/agent/supervisor-card.md` and reports its
`sha256`. The supervisor reads the card in full, then attests that digest.
`pan prepare` and `pan submit` refuse with `SUPERVISOR_CARD_UNATTESTED` until
the current digest is attested. When a policy changes mid-run, the next
`pan prepare` reports a new digest and refuses until the supervisor re-reads and
re-attests. `pan status <run-id> --json` shows the `supervisor_card` record.

The same rule covers every standalone command. `/pan-release`, `/pan-write-pr`,
`/pan-build-docs`, `/pan-build-briefs`, and `/pan-qa-workflow` start with
`pan governance card --mode <mode>` and paste the card into the delegated
prompt. Only `/pan-status`, `/pan-validate`, and `/pan-summarize-context` run
without a card, and `pan validate` enforces that list from
`governance/registries/command_governance.json`.

### Watch a worker launch

A worker launch can return before the worker's declared output exists. Cursor
can also turn a foreground subagent call into a background launch and tell the
supervisor not to poll or await it. Run 63311 lost its supervisor to exactly
that text. The polling therefore no longer depends on model judgment:

```bash
./bin/pan watch <run-id> [--invocation <invocation-id>] [--cadence-seconds <n>] [--stall-wakes <n>] [--timeout-seconds <n>] [--mark-background] [--launched-at <iso-8601>] [--handle <platform-handle>] [--agent <name>] [--model <name>] [--agent-state running|completed] [--json]
```

The command resolves the run's pending invocation, sleeps one cadence, and
inspects the invocation's output path and evidence files. The delegation
artifact is not among them. `pan prepare` writes it, and it is the worker's
input rather than its product, so a change to it is the supervisor
re-rendering a card and not evidence that the worker is still producing.
The command appends one JSONL line per arming and per wake to
`agent/evidence/<invocation-id>-watch.jsonl`, with the wall-clock time, the
invocation watched, and the observed state. That file is the `DELEGATE-001`
arming and wake record, written by the harness. The default cadence is 60
seconds, and it is the same for every worker however long the work is expected
to run. `--cadence-seconds` overrides it only when the operator directs a
different cadence. Fractional seconds are accepted.

Exit codes: `0` and `{"state":"completed"}` when the output is present and
names the invocation. `2` and `stalled` after `--stall-wakes` (default 2)
consecutive wakes with no change. `3` and `timed_out` at `--timeout-seconds`.
The command is safe to await in the foreground and safe to re-run. It returns
`completed` at once when the output already exists. Wake lines print to
stderr only on an interactive terminal.

The first arming writes the launch record
`agent/evidence/<invocation-id>-launch.json`, and every launch-relative
number the harness reports reads it. `--launched-at` supplies the time the
supervisor launched the worker and is recorded with source `supervisor`.
Without it the arming time is recorded with source `watch_arm`, the earliest
moment the harness itself can witness — and because an arming is then its own
launch time, `DELEGATION_WATCH_LATE` cannot fire. `--handle` records the
platform identity of the launched worker, which `pan worker record` otherwise
asks for in a separate call, and `--agent` and `--model` name what that handle
belongs to. An arming with no handle still succeeds and records that none was
supplied. `--agent-state` reports what the supervisor saw when it inspected
the launched agent itself.

`--mark-background` records that the platform turned the launch into a
background subagent. A launch that returns with the worker output already
present exposes no observation point to watch, so the supervisor records its
return instead:

```bash
./bin/pan watch <run-id> --foreground-returned [--invocation <invocation-id>] [--launched-at <iso-8601>] [--json]
```

The command writes `agent/evidence/<invocation-id>-foreground-return.json`
with the launch and return wall-clock times, the elapsed seconds, and a
terminal-state inspection of the output and evidence paths. The launch time
comes from the invocation's launch record: `--launched-at` writes that record
here when no watch armed earlier, and an attestation with neither a
supervisor time nor a prior arming falls back to the invocation record's
modification time, which is an upper bound on the launch rather than the
launch itself. An elapsed time shorter than the watch record's own
first-to-last wake span is labeled `elapsed_implausible` and names both
numbers. `--foreground-returned` and `--mark-background` are exclusive.

`pan submit` accepts one of three records for every worker invocation an
operator session delegated:

1. `watch_completed` — a watch record that ends in a completed wake.
2. `watch_observed_final_output` — a watch record that reached no verdict of
   its own, whose last wake saw a terminal output that has not moved since.
   The platform's completion notice routinely lands between two wakes and
   leaves the supervisor with no completed record; this path accepts that
   watch rather than the attestation the supervisor used to write for a
   launch nobody watched return. A watch that did reach a verdict, including
   `unverified` and `stalled`, keeps it.
3. `foreground_return` — the foreground-return attestation.

A submission with none of the three fails with the hard error
`DELEGATION_UNOBSERVED` before any validator or gate runs and consumes
no stage attempt; the supervisor records the missing observation and submits
again. A harness-delegated stage is exempt only when its delegation execution
record names the run and invocation, whichever executor ran it. The refusal
message points at `pan delegate` only for a stage that command dispatches; a
Cursor stage an operator session delegated is told about the watch record and
the attestation instead. The stage record carries the observation as
`delegation_observation`, naming which record proved the worker reached a
terminal state.

`pan output validate <run-id> --file <path> --invocation <path>` runs every
validator `pan submit` runs before its shell gates — the evidence-report,
attestation, and structural checks plus the harness-authoritative policy
validators such as `IMPLEMENTATION-CLAIMS-VALIDATE-001` — from the same
resolved requirement set, without persisting a validation record. A defect it
reports would otherwise reject the submission after the static and fast gates
had already run, so the supervisor repairs mechanical defects from its
`ORCH-001` list before it submits.

### Platform-guidance redline

An agent cannot delete platform-injected text from its own context or from a
subagent's. What it can do is pre-commit, in a harness record, that named
categories of platform guidance are non-authoritative before it meets them:

```bash
./bin/pan status <run-id> --redline [--occasion pan-start|pan-resume]
```

The command writes `agent/evidence/platform-guidance-redline.json` and appends
one declaration per call. The record names the categories (polling, awaiting,
and backgrounding text, session-mode text, model and tool suggestions, hints
not to run commands), the authority order from `AGENTS.md`, and the policies
that own the duty. `OPERATOR-001` requires the supervisor to write it at
`/pan-start` and every `/pan-resume` and to quote the path in its first
report. The duty is enforced: each `pan governance attest-supervisor` opens a
supervisor session generation, and `pan prepare` and `pan submit` refuse with
`REDLINE_MISSING` until the record carries a declaration for the current
generation. A later conflict is still recorded under `OPERATOR-001`.

### Run top-level workflow QA

`/pan-qa-workflow` adopts both the orchestrator and harness workflow QA briefs
in the current top-level session. It never delegates the supervisor role. This
keeps every mapped worker launch at the top level and preserves model routing.

The command can apply a temporary QA waiver for surgical repair, governance,
workflow, and verification work. The waiver expires immediately after the
first successful `test` stage record. After expiry, the supervisor uses only
away-mode decisions and normal harness actions through `ship`.

The final ship approval applies only the recorded ship outcome. It completes
the workflow without a push, publication, deployment, or branch deletion.

After the run reaches a terminal state, the QA agent investigates each flagged
issue. It separates a verified root-cause repair from a retry, workaround,
configuration patch, rollback, reconciliation, or containment action. It puts
one implementation-ready remediation intake in `runtime/inbox/queue/` when an
issue does not have a verified root-cause repair.

### Trace newly merged harness functionality

Use `/pan-trace <feature | PR link | commit hash> [--worktree <name>]` for a
cheap smoke trace of newly merged harness functionality. The trace learns the
intended design from repository evidence, drives the core mechanics through
their normal entry points, exercises one sanctioned failure path, and cleans up
its throwaway artifacts. It does not add the per-stage checklists, root-cause
analysis, or waiver bookkeeping that `/pan-qa-workflow` requires.

Choose the instrument by the evidence you need:

- Use `/pan-trace` for one inexpensive, passthrough check of core mechanics
  after a merge.
- Use `/pan-qa-workflow` for full checklisted workflow validation and
  root-cause analysis.
- Use `pan eval` for a repeatable toy scenario with deterministic graders.

A trace writes
`runtime/logs/traces/<UTC-timestamp>-<target-slug>/report.md`. The report has
these sections in order: `Summary`, `Target`, `Mechanics`, `Exercise`,
`Evidence`, `Failure injection`, `Verdicts`, `Cleanup`, and `Defects`.
Each mechanic has a verdict of `worked`, `failed`, `not exercised`, or
`blocked`. A blocked verdict means the environment prevented a product
verdict.

## Invocation and delegation validation

`INVOCATION-001` is the normative invocation-card and delegation policy. Each
prepared invocation writes `<invocation-id>.invocation-validation.json` under
`agent/validations/`, or under `invocations/` in a layout v1 run. If prepare
fails, read that artifact for the failing checks before retrying.

When `pending_action` is `invoke_agent`, deliver the canonical invocation card
according to the `<invocation-id>.supervisor.md` procedure document that the
card's **Supervisor delivery procedure** section names — it carries
`INVOCATION-001` with resolved paths and every lifecycle command, keeping the
worker-visible card free of them — and persist the
delegation audit artifact. Before
`./bin/pan submit`, confirm delegation validation passed. Rejection with
`DELEGATION_ARTIFACT_MISSING` or `DELEGATION_VALIDATION_FAILED` leaves the run
on the same invocation so delivery can be corrected and resubmitted.

`./bin/pan status` includes a dedicated validation section with invocation and
delegation validation state, artifact paths, and short failure reasons.

Applicable durable handbooks and static skills are resolved through policy
`guidance_sources` and delivered on the invocation card as audited references.
Each reference names the source path, the selected heading range, the content
digest, and the read trigger that makes the guidance apply. The exact selected
content stays in the invocation JSON snapshot for audit, so the card stays
compact without weakening policy authority. Language-specific
policies MAY also be selected from detected target-workspace technology signals;
for example, Python source or packaging markers activate `PY-001` for implementation,
review, QA, and spotfix work without imposing Python guidance on unrelated targets.
A worker MUST read a referenced range before the work its trigger names, and MUST
NOT act on a remembered version of it. Digests cover the selected text after
leading and trailing whitespace is trimmed, and the reference states that basis.
The read itself is attested: the contract manifest indexes every referenced
selection, the stage-output scaffold prefills one
`invocation_attestation.guidance` entry per selection with status `pending`, and
submission rejects `pending` — the worker must declare `read`, or `skipped` with
the reason the trigger did not apply, or `reference_failed` with the concrete
error (which fails the attestation). Cards prepared before progressive
disclosure keep their inline guidance bodies and stay valid, and invocations
prepared before guidance attestation existed carry no guidance index and require
no entries.

## Build the target repository primer

Run `/pan-build-docs` after installation, after major architectural or administrative changes, or when the existing primer is materially stale. The command creates the primer when absent and regenerates it when present. The librarian inventories target-owned documentation, incorporates useful verified details into the appropriate sections, and reconciles those claims against representative code, setup/build/install/test scripts, manifests, and bounded Git history before writing the validated primer to `docs/target-repo-primer.md` (`.pancreator/docs/target-repo-primer.md` when embedded).

Every agent reads this primer before expanding repository context. It is a navigation aid rather than an instruction to preload all referenced files: agents may follow a primer path only when the active task creates a concrete need for that file.

## Build the operator brief system

Run `/pan-build-briefs` after installation and whenever recurring operator-facing use cases or project visual conventions materially change. The command scaffolds missing files, then asks the librarian to derive a minimal target-specific ontology and design-token layer from bounded repository evidence. It writes `docs/operator-briefs/project.json` and `docs/operator-briefs/project.css` (`.pancreator/docs/operator-briefs/` when embedded) and validates collisions and emoji consistency.

Use `pan briefs build --force` only when deliberately resetting the project layer to templates before regeneration. Existing historical Markdown artifacts are not migrated.

New workflow runs suppress stage briefs and workflow PR copy by default. Request briefs for every stage when the run starts:

```sh
./bin/pan init --request runtime/inbox/queue/request.md --operator-artifacts
```

Request a brief for only the current stage before its invocation exists:

```sh
./bin/pan prepare <run-id> --operator-artifacts
```

Requested invocations declare exact brief JSON and HTML paths. Submission renders and validates the HTML, then deletes a valid transient source.

Generate one submitted stage brief later without rerunning its worker:

```sh
./bin/pan briefs generate --run <run-id> --stage <stage-slug>
```

Omit `--stage` to generate each missing latest-stage brief. Existing HTML stays unchanged unless `--force` is present. A failed render or validation keeps the source JSON and preserves existing HTML.

The ship stage creates workflow PR copy only when its invocation requests operator artifacts. `/pan-write-pr` remains available independently.

New run directories separate their contents. Open `operator/` for the preserved
request and explicitly requested outputs. Harness records remain under `agent/`.
Existing runs keep their original layout.

## Assess unusually large intake

Use `/pan-decompose <intake spec>` before starting a workflow when the request may contain multiple independently valuable outcomes or prerequisite decisions. `DECOMP-001` is intentionally conservative: the decomposer defaults to one larger run, requires every proposed chunk to be independently testable and safely completable, and then requires either a hard decomposition trigger or broad complexity pressure across several dimensions. File count, frontend/backend boundaries, tests, documentation, and implementation phases are not valid split boundaries by themselves.

The decomposer also compares reduced implementation, review, and remediation risk against the repeated intake, planning, review, QA, release, and coordination cost of additional runs. Marginal cases remain intact. Valid decompositions normally contain two to four dependency-ordered chunks, preserve requirement traceability, and write a validated packet under `runtime/inbox/queue/` whose chunks can be passed directly to `/pan-start`.

## Choose a work mode

Use `systematic` by default. `/pan-start` executes the governed `planning`
workflow, the entry point for delivery work: one ratified plan stage that
writes the specification hierarchy and the cohort plan. Approving that plan
routes the work by harness rule, into one `delivery` run (implementation, joint
verification with parallel review and QA evidence workers, verdict-routed
remediation, and release preparation) when the plan holds one chunk, or into a
cohort of parallel `delivery-chunk` runs followed by one release run when it
holds more. See **Plan once, then deliver** for the state machine.

Use `/pan-debug <problem>` when the cause or remediation scope is unclear. The
investigator does not modify source; it returns root cause, proposed remediation,
numbered acceptance criteria, and a `lightweight` or `systematic` recommendation.

Use `/pan-repair <problem-or-artifact>` when the suspected defect is in
Pancreator itself or when a workflow run needs a harness-level audit. The harness
technician accepts prose, a file, or a run directory; reconstructs run behavior
from state, events, snapshots, invocations, outputs, assessments, validations,
and artifacts; and augments those records with the relevant agent transcripts.
Delegation prompts are treated as prompt-delivery evidence rather than as
transcripts. The audit assesses every issue category in
`governance/registries/harness_repair_categories.json` and writes one validated
`harness-repair-<UTC timestamp>-<category-slug>-<detail-slug>.md` intake under
`runtime/inbox/queue/` for each category that produced a confirmed finding. It
reports the categories that produced none. Most intakes can be passed directly
to `/pan-start` in the Pancreator self-development checkout; an out-of-band
intake names supervised execution outside the harness instead. Ask for a single
intake, a named subset of categories, or a fixed count when you want a
different set. The command does not modify the investigated run or implement
the repair.

### Sweep registered embedded installations

Keep machine-local installation roots in the untracked
`config_overrides.json`, not in the tracked `config.json`:

```json
{
  "installations": [
    { "id": "rowspace", "path": "/Users/alen/Dev/rowspace/.pancreator" },
    { "id": "cumulus", "path": "/Users/alen/Dev/cumulus/.pancreator" },
    {
      "id": "portfolio-demo",
      "path": "/Users/alen/Dev/portfolio-demo/.pancreator"
    },
    { "id": "skills", "path": "/Users/alen/Dev/skills/.pancreator" }
  ]
}
```

Each entry has a stable lowercase `id` and an absolute harness-root `path`.
Inspect the registry with `./bin/pan installs list --json`. A missing or
unreadable installation is reported on its own row and does not hide the other
entries. Each row carries the installation's `version`, the `harness_version`
of this checkout, and `stale`, which is `true` when the two differ and `null`
when either is unknown, so an installation that fell behind is visible without
a manual comparison.

Run `/pan-repair installs` to sweep every registered installation, or append a
comma-separated id list to narrow the sweep. The technician classifies queued
items as harness-directed or target-owned and consolidates only harness work in
the source checkout. After every consolidated intake passes its validator, the
supervising session uses `pan installs archive`; the command refuses any inbox
item whose file name the validated intake does not cite. The installed harness
versions do not need updates.

Use `/pan-spotfix <request>` only when the operator deliberately selects
lightweight execution and the request satisfies `WORK-001`: one coherent change,
no unresolved structural decision, no more than three core implementation files
in one bounded subsystem, and existing checks that can prove correctness. The
spotfixer performs at most three implementation-validation cycles. Failure or
scope expansion creates
`runtime/inbox/queue/spotfix-escalation-<UTC timestamp>-<slug>.md` for
systematic routing. Do not run it while a mutating workflow agent is active in
the same workspace.

Use `/pan-pair <directive>` when you want to drive the work yourself. The agent
applies the governance the coder persona carries — engineering baseline, language
handbooks, safety boundaries — but is bound to no workflow, stage contract, gate,
or run contract. It makes the change you asked for, runs the narrowest useful
check, reports what it did and did not verify, and stops for your next
directive. It will not create a run, produce stage outputs or briefs, or convert
the session into a workflow on its own. Do not run it while a mutating workflow
agent is active in the same workspace.

Use `/pan-shepherd <pr-number-or-url>` after you open a pull request that review
bots or teammates will comment on. The shepherd polls the PR's reviews and
comments in 60-second cycles. A watch window runs 15 cycles and closes only
after one quiet cycle, so a burst of feedback is assessed as one batch rather
than item by item. It judges each item against the code and against a durable
per-session ledger of every reviewer's history — repeated items keep their
prior disposition, a bot's self-contradictions and induced findings are
rejected as thrash rather than ping-ponged, and inter-bot conflicts are decided
on the merits with the losing side recorded. Accepted items are implemented
with proportionate tests, gated through the review squad coordinated by the
`pan-shepherd-reviewer` subagent (its model comes from the `shepherd-reviewer`
mapping in `config.json`, separate from the run-time `reviewer`), and pushed to
the PR head branch only after the review passes. When the reviewed repository is
Pancreator itself, the squad swaps its dimensions for the harness lineup in
`library/skills/review-squad-pancreator.md` — correctness and consistency,
agentic practice, and performance. That lineup is not installed into a target
repository. The session ends after a quiet
window, a fully rejected batch, or at most 8 windows, and always closes with a
full report and the ledger path. Invoking the command authorizes commits and
pushes to that PR's head branch only; merging stays with you. Do not run it
while a mutating workflow agent is active in the same workspace.

Use `/pan-review [<target>]` when you want the review squad without a pull
request. It resolves one target — a ref range, a single ref against its merge
base, a PR, or a path set, defaulting to the current branch — captures it once,
and delegates the same `pan-shepherd-reviewer` coordinator `/pan-shepherd` uses.
When the target is Pancreator itself, the squad swaps to the harness lineup.

By default the squad runs every dimension of that lineup. Add
`--dimensions <a,b,c>` to run a subset — for example
`/pan-review main...my-branch --dimensions security,correctness`. The value is
a comma-separated list of dimension slugs: `correctness`, `security`,
`architecture`, `simplification`, `operations`, and `frontend` from the core
lineup, plus `correctness-consistency`, `agentic-practice`, and `performance`
from the harness lineup in a Pancreator checkout. The session passes the
selection to `pan governance card --mode review --dimensions <a,b,c>`, which
refuses an unknown slug with the accepted list before any agent launches,
collapses duplicates, and records the selection in the review card beside the
default-lineup dimensions it leaves out. A selected set is the whole lineup:
activation rules and the harness swap do not apply to it, and each selected
dimension runs with the charter that defines it. A partial review stays
visibly partial — the report names the dimensions it did not cover and states
that the verdict covers the selected dimensions only. The shepherd's per-batch
review gate takes no selection and always runs the full lineup.

Two things the session settles before it delegates. It binds the workspace to
the target's head, resolving a worktree when your checkout sits elsewhere, so
the agents verify findings against the tree the diff applies to rather than
whatever you happen to have open. And it runs
`pan governance review-scope --target <ref>`, which reports every conflict of
interest the target carries, by tier. Its `closure_tracking` field is `tracked`
when `closure_revision` names the closure commit and `untracked` when an
installed closure sits outside the target's revisions; the latter reports a null
`closure_revision`. **Instrument** paths — the lineup, a
charter, the coordinator, the mode policy, an entry point, the scope check, or
the reviewer's model mapping — leave the squad's verdict for an independent
`pan-reviewer`, because a charter cannot find a defect introduced into that
charter. **Conduct** paths — a policy on the reviewer's own card, computed from
the card rather than a hand-kept list — stay in scope, and the session rebuilds
its card with `--base` so it follows the rule in force before the change.
**Substrate** paths — validators, test helpers, check wrappers, exemption
registries — stay in scope and taint any verification that leans on them. The
command also prints a standards delta for every changed policy: the
instructions it removed and added. A rule that differs from its base is never a
finding; the report puts the delta in front of you, and the merits of a rule
change are yours to ratify.

The session changes nothing: it returns ranked findings and a pass or fail
verdict, and acting on them is a separate `/pan-spotfix` or a systematic run. Do not run
it while a mutating workflow agent is active in the same workspace.

Use `/pan-harden [scope hint]` when a burst of ad-hoc agent work in the current
session is done and the working tree needs to reach a mergeable state. The
session resolves the scope from the working tree and the merge base, exercises
the changed behavior with the narrowest deterministic checks, delegates exactly
one `pan-reviewer` over a single capture, inspects a rendered surface under
`BROWSER-001` when one changed, and closes the ranked gaps. It then prepares
the branch and names the integration command you would run next — it never
commits, merges, rebases, pushes, or runs the integration itself. It creates no
run and gates nothing. Do not run it while a mutating workflow agent is active
in the same workspace.

Use `/pan-polish [design task]` to bring UI and design work into conformance
with the design handbook and the design system that owns each touched surface.
With no argument the session takes the working tree's UI and design changes;
with an argument it performs that design task under the same rules. Operator
briefs conform to the project design system in `docs/operator-briefs/`, target
UI to the target's own tokens or style guide, and the ux-guide heuristics apply
on every surface. When a surface has no design system, the session proposes a
minimal token set and generates it only after your recorded approval. Do not
run it while a mutating workflow agent is active in the same workspace.

Both commands accept `--worktree <name>` to bind the session to a named
worktree.

Invoke `/pan-pair` **once per conversation**, not once per turn. It opens the
session by generating the governance card; after that, every directive is an
ordinary chat message and the agent loops on its own. Re-invoking is harmless but
unnecessary — the agent reuses the existing card rather than generating another.

Start a new conversation and you start a new session, so invoke it again there.
If a long session gets summarized and the agent appears to drift, the card is a
durable file under `runtime/logs/sessions/<id>/`; telling the agent to re-read it
restores the full contract without regenerating anything. Session directories
follow the same seven-day `RUNTIME-001` retention as workflow runs.

Every non-workflow mode takes its governance from a generated card rather than
hand-assembled policy text:

```sh
./bin/pan governance card --mode pair
```

The card resolves the same policy applicability map the workflow path uses, so a
standalone session is auditable and nothing is inlined by hand.

## Prototype instead of delivering

Use the `prototype` workflow when the question is whether an approach works, not
whether it ships:

```sh
./bin/pan init --workflow prototype --request runtime/inbox/queue/<spike-request>.md
```

It runs intake → approach → build → evaluate. Compared with `delivery` it:

- frames technical questions and observable success signals instead of user
  stories and acceptance criteria,
- keeps the approach stage thin and ungated rather than producing an
  implementation-ready plan behind a supervisor gate,
- gates only the `static` repository-check profile and reports `fast` as
  advisory, so a spike is not blocked on production test coverage,
- expects deliberate shortcuts and requires each one declared with the reason it
  was acceptable,
- ends with an operator-ratified evaluation giving a `validated`,
  `invalidated`, `inconclusive`, or `environment_blocked` verdict, the
  productionization gap, and a recommendation.

`PROTO-001` prohibits representing a spike as production-ready. When you adopt an
approach, start a separate systematic `delivery` run scoped from the evaluation's
productionization gap; the prototype run does not productionize its own output.

An `invalidated` verdict is a successful prototype. The evaluation names the
spike code to delete either way.

An `environment_blocked` verdict means environment gaps prevented a decision and
no product discard condition was met. The spike has not answered its questions.
Provision the environment the evaluation names, then rerun, rather than treating
the approach as adopted or discarded.

## Set how heavily you gate a run

`config.json.operator_involvement` declares named involvement profiles. List
them with:

```sh
./bin/pan involvement
```

Select one per run:

```sh
./bin/pan init --request runtime/inbox/queue/<request>.md --involvement technical-director
```

Shipped profiles:

- `standard` — workflow-declared gates. You ratify the plan and approve release.
- `hands-off` — the supervisor ratifies the plan instead of you; release still
  stops for your explicit approval.
- `long-horizon` — the supervisor ratifies the plan, the run carries the
  `long_horizon` contract, and profile-scoped away mode handles bounded
  decisions until post-run review. Release still stops for your approval.
- `technical-director` — you refine the technical plan with its author before
  implementation and respond to the independent review before the run continues.
- `high-touch` — every stage stops for your explicit approval.

`init` reports the resolved profile, active contracts, and any gate that replaced
a workflow default, so you know where the run will stop before it starts. The run
snapshots that resolution, so editing `config.json` afterwards never changes a
run in flight. A planning run also passes its recorded profile to every delivery,
chunk, and release run it starts, so the route cannot fall back to a later
configuration default.

Selecting `long-horizon` snapshots its away-mode guardrails. If a custom profile
carries the `long_horizon` contract with away mode disabled or omitted, run
creation forces the snapshot on and records the configured value, applied value,
and reason without editing `config.json`. The mode changes gate ownership and the
mode-scoped policy set only. It does not lower verification, review depth,
correctness checks, the release boundary, or any operator-owned irreversible
action.

A long-horizon task stops for four hard blocks and nothing else: an action an
invariant reserves for you (push, publication, deployment, history rewrite,
destructive reset, branch deletion, external release), a secret or authorization
that is genuinely absent, a correctness or security failure no permitted action
can repair, and a destructive action you did not direct. A cost-, speed-, or
wall-time-backed criterion (a wall ceiling, a rolling average, a budget), a
condition the worker caused itself, a transient evaluator or executor failure,
and any ordinary judgment call are decided and recorded, never deferred. To
make that hold, the shipped profile allows `waive-gate`, sizes the decision
budget at 12 per run, re-evaluates a failed evaluator reply, and falls through
to the next ranked option when a selected option does not apply.

No function ends a task. Every stop that is not a terminal success passes to
the session arbiter, a model exchange that reasons about the stop against the
four hard blocks and overrides by default (`resume`, `set-stage`, `decide`,
`waive-gate`, or `restart-task`, each with a directive the next worker acts
on). A task defers only when the arbiter names the hard block it confirmed, or
when the arbiter and its deterministic fallback both fail to act past the
override bound; the deferral record carries that classification
(`hard_block`, `harness_unrecoverable`, or `operator`). Every arbiter round is
in `runtime/logs/horizon/<session-id>/arbiter.jsonl`. After the run,
`pan horizon reinstate <session-id> --task <id> --action <...> --note <directive> --reason <text>`
is your override of a deferral you do not confirm; it frees the task's
dependents and returns the session to `running` so `horizon start` drives it
again. Read `governance/handbooks/horizon/long-horizon.md` for the hard-block
and arbiter tables.

### Long-horizon sessions

A long-horizon session owns an ordered queue of workflow tasks and one-off prompt
tasks. The worktree-capable surface is `horizon init --queue <path> --worktree <name>`.
The queue is a JSON file with `tasks` and optional dependency `edges`. A
workflow task names `workflow` and `request_path`; a prompt task names `prompt`.
Each task may name `workspace` or `worktree`, and `depends_on` adds direct
dependencies. Initialization rejects unknown dependencies and reports a cycle by
its task ids.

```sh
./bin/pan horizon init --queue runtime/inbox/queue/<queue>.json --involvement long-horizon --worktree <name> --json
./bin/pan horizon start <session-id> --attest-supervisor-card --json
```

Start is one preflight operation. It records the selected involvement profile,
arms away mode for the session, records the override, and records permission to
attest each task run's supervisor card. Without `--attest-supervisor-card`,
preflight refuses before any task starts. Start then returns: your chat session
(`/pan-horizon`) is the supervisor of the session, of every task run it opens,
and of every run a task's plan approval routes to. `horizon status --json`
names the next session command (`horizon next` to open the eligible task,
`horizon reconcile` after a wake), lists every live run under `live_runs` with
its bootstrap commands (card, attest, redline, model evidence), and lists the
cohort commands the active task's route offers under `route_commands`. The
supervisor advances the live runs with the ordinary lifecycle commands, launches
routed chunk runs in parallel up to the cohort's limit, and reasons about every
stop itself as the arbiter; nothing publishes, deploys, or takes an operator-only
release decision.

`horizon start --headless` is the substrate for a scheduled job with no chat
open: the harness advances tasks in one driver process per task until the
session is terminal or no eligible task remains, and the harness arbiter reasons
about each stop. `pan schedule` passes that flag itself.

The session state lives at
`runtime/logs/horizon/<session-id>/session.json`. An append-only `events.jsonl`
sits beside it. Only one task runs at a time, and a task finishes when its
route finishes: a planning task whose approval starts one delivery run or a
cohort stays `running`, with `route` recorded on the task, until that run or
the cohort's release run succeeds. A task becomes eligible when all of its
dependencies succeeded; declared queue order breaks ties. Deferring a task
requires the authority the command enforces: `--hard-block <LH-H1..LH-H4>`
with your reasoning, or `--operator-directive` when you asked for it yourself.
Deferral marks only the task's transitive dependents blocked and leaves
unrelated tasks eligible. The deferral is written both to `deferred.jsonl`,
with its classification, and to an actionable request under
`runtime/inbox/queue/`. Deferring the active task pauses its run before
the session releases the slot, and the session refuses to open the next task
while any task's run is still in flight, so two workflows never mutate one
workspace at the same time. A run already resting in a pause keeps the pending
decision you own.

Failures use one fixed per-task ladder:

1. Two transient signatures may retry.
2. A repeated signature, or the first failure after those retries, spends one
   strategy switch and routes to the workflow's declared repair stage.
3. The next exhaustion starts one planning run from the structured failure
   record, scoped to the task and its dependents.
4. A second exhaustion reaches the arbiter, which defers the task only by
   naming one of the four hard blocks.

The failure signature is the sorted set of failed hard criteria, or the
validation-only marker. The counters live on the task's run and survive ordinary
run resume. A long-horizon run that belongs to no session pauses after the engine
rungs because no queue exists to receive a deferral.

Every started, finished, deferred, excluded, and quiescent transition writes a
JSON handoff and a readable companion under `handoffs/`. The handoff carries the
queue shape, last task, open deferrals, and one next action. Cursor summarizes
the supervising conversation itself when its context window fills; the session
record, the handoff, and each run's state are what the supervisor rebuilds from
afterwards. Under `--headless`, each task instead runs in a new driver process
that reads the latest handoff. `pan horizon resume <session-id>` reads the
latest handoff for inspection.

Useful inspection and post-run controls:

```sh
./bin/pan horizon status <session-id> --json
./bin/pan horizon reconcile <session-id> --json
./bin/pan horizon resume <session-id> --json
./bin/pan horizon defer <session-id> --task <id> --hard-block LH-H2 --reason '<reason>' --json
./bin/pan horizon reinstate <session-id> --task <id> --action resume --note '<directive>' --reason '<reason>' --json
./bin/pan horizon abandon <session-id> --reason '<reason>' --json
```

A prompt task writes its text to the request inbox and resolves the `unbound`
standalone card with the session's snapshotted contracts. An ordinary unbound
card outside a session still resolves with no run contract.

## Scheduled jobs

Scheduling is opt-in. The tracked `config.json` ships this block disabled, with
no jobs:

```json
{
  "schedule": {
    "enabled": false,
    "catch_up_window_minutes": 360,
    "grace_period_minutes": 60,
    "jobs": []
  }
}
```

A job names a unique `id`, `enabled`, `hour`, `minute`, one target (`workspace`
or `worktree`), and one `action`. Optional `weekdays` use `0` for Sunday through
`6` for Saturday. `timezone` is an IANA name; without it, the machine's local
zone defines the wall-clock hour. A job may override the block's catch-up window
and grace period.

Actions have four shapes:

```json
{ "kind": "command", "command": "./bin/pan validate" }
{ "kind": "workflow", "workflow": "planning", "request_path": "docs/scheduled-workflow-request.md", "involvement": "long-horizon", "verification": "light", "pipeline_config": "advanced", "attest_supervisor_card": true }
{ "kind": "session", "queue_path": "runtime/inbox/queue/session.json", "involvement": "long-horizon" }
{ "kind": "prompt", "prompt": "Prepare the weekly dependency report.", "workflow": "planning", "attest_supervisor_card": true }
```

A workflow job does not attest its supervisor card unless
`attest_supervisor_card` is true. A session uses its own long-horizon preflight
arming. A prompt is written under `runtime/inbox/queue/` and then starts the
named workflow against that request.

Use the command family directly or call `tick` from any external trigger:

```sh
./bin/pan schedule list --json
./bin/pan schedule validate --json
./bin/pan schedule tick --json
./bin/pan schedule run <job-id> --json
./bin/pan schedule status --json
./bin/pan schedule install-agent --json
./bin/pan schedule uninstall-agent --json
```

The tick owns all decisions. A start within five minutes of the scheduled
minute records `fired`, a later start inside the bounded window records
`caught_up`, the first instant past that window records `dropped`, and any
non-terminal run holding the target records `deferred`. The five-minute
tolerance matches the trigger interval, so an ordinary poll is not reported as
a late catch-up. A deferred occurrence stays eligible until its window closes.

Each decision appends to `runtime/logs/schedule/<job-id>.jsonl`. A later poll
of an occurrence the ledger already decided reports the skip in the command
output and appends nothing, so the ledger grows with the schedule rather than
with the trigger interval. A job whose evaluation fails records that failure
and does not stop its peers; a ledger line that no longer parses is skipped and
counted in the next record's `damaged_ledger_lines`.

At the end of each tick, a missing timely success opens an alert in the
atomically replaced `runtime/logs/schedule/alerts.json`. Only a success
recorded after the alert opened clears it, so a job that never runs keeps its
notice open across every later occurrence. Open and clear events append to
`alerts.jsonl`. `schedule status` reads the same current open set; no
notification service is required.

On macOS, `install-agent` renders `library/templates/launchd-schedule.plist`
into `~/Library/LaunchAgents/com.pancreator.schedule.plist` and loads it.
`uninstall-agent` unloads and removes that file. A failed load removes the
plist it rendered and names the command to rerun. Installation and update never
run either command. On other platforms, `install-agent` refuses and names
`pan schedule tick` as the portable entry point.

## Set how thoroughly a run verifies

`config.json.verification` selects a named verification level: which
repository-check profile each shell gate actually runs. List the levels with
`./bin/pan verification`, select one per run with
`./bin/pan init --verification <level>`, and inspect or change an in-flight
run with `./bin/pan verification <run-id> [set <level>]`.

Built-in levels:

- `minimal` — static and fast checks gate the implement and remediate loops;
  no submission gate runs `full`. QA argues from manual cases and prior gate
  evidence.
- `light` (default) — as minimal, plus the verify submission gate runs the
  complete `full` profile once on a passing verdict, and the remediate
  submission gate runs it once when the repair is ready to ship. When
  remediation returns to verify, the verify gate accepts that recorded pass at
  an unchanged fingerprint instead of running `full` again. `full` is judged on
  its own result and never baselined before implementation, so a pre-existing
  failure needs an operator decision.
- `thorough` — an alias of `light` kept for existing run snapshots and
  operator scripts; every submission gate keeps its workflow-declared profile.

Who runs which suite: the coder and the remediator iterate with
`./bin/pan tests impacted` (the `impacted` profile — static import-graph
analysis selects the test modules the change set reaches; it is an iteration
profile, never a gate) plus the tests they added, and fall back to blast-radius
judgment only for a target without an `impacted` profile. The two verify
evidence workers (reviewer and QA) iterate on blast-radius tests. Each of the
four then runs the `fast` profile once as validation; the remediator may run
it earlier when the impacted selection is large or a failure reproduces only
under the fast lane, and a repeat run after validation needs an exceptionally
large blast radius. A retry that changed only claims or evidence runs no suite. The
evidence-worker brief names the harness root and asks for a `fast` run only
when no gate has already passed `fast` at the current workspace fingerprint. A
worker's check is recorded in the run's
`agent/evidence/repository-check-runs.jsonl` only when the command names the
run with `--run <run-id>` or `--worktree <name>`; a bare
`pan repository-check <profile>` records nothing on any run, and
`pan output validate` reports an advisory diagnostic when one invocation ran
`fast` more than once. The consolidating
verifier runs neither `fast` nor `full`: its passing verdict is what triggers
the single `full` run as the verify gate, and a failing verdict forwards to
remediation without running it. The plan worker may recommend a different
level for a risky change; the run pauses once with the exact apply command,
and resuming declines it. Runs snapshot the resolved level at init.

`ship` cannot be relaxed by a profile: `SHIP-001` requires a pause before commit,
push, merge, publication, or deployment. You keep every in-the-moment override
under `OPERATOR-001`.

### Technical director mode

`technical-director` is a run contract, not a separate workflow — any workflow
run abides by it when active. It attaches to stage _roles_ rather than slugs, so
it escalates `planning/plan` and `prototype/approach` (the `technical_plan`
checkpoint) and `delivery/verify` and `design/review` (the `independent_review`
checkpoint) to operator gates.

At a checkpoint the supervisor presents the stage's substance in full and stops.
You have three responses:

```sh
./bin/pan decide <run-id> approve
./bin/pan decide <run-id> revise --note "Use the existing adapter; drop the new registry."
./bin/pan decide <run-id> reject --note "Wrong subsystem entirely."
```

`revise` is the refinement path: it re-runs the same stage with your directive as
required input, tells the worker to keep everything you did not ask it to change,
and does **not** consume the stage's failure retry budget — each revision raises
that stage's attempt ceiling by one. Use `reject` only for work you consider
unacceptable; it routes to the stage's failure target.

`DIRECTOR-001` forbids inferring approval from silence, from the absence of
objections, or from discussing the plan with you.

## Include design in development or run it separately

For development work that needs one design specification across planning and delivery, pass `--with-design` when starting the default planning workflow. The planning run gains a design stage before `plan`; routed `delivery` and `delivery-chunk` runs gain design review and design QA evidence workers on `verify`.

```sh
./bin/pan init --with-design --request runtime/inbox/queue/<request>.md
```

The standalone `design` workflow remains available when design should produce a separately ratified handoff package before development starts:

```sh
./bin/pan init --workflow design --request runtime/inbox/queue/<design-request>.md
```

After intake → design → design review → design QA → handoff succeed and you
approve handoff, the design package lists stable paths for the design spec, HTML
mocks index, and acceptance criteria. Start `delivery` with a request that cites
those paths so planning preserves the design acceptance criteria:

```sh
./bin/pan init --request runtime/inbox/queue/<request-referencing-design-package>.md
```

The first live standalone design run after enabling this capability is an operator checklist item.

### Browser inspection MCP setup (self-development)

`BROWSER-001` (`governance/policies/BROWSER-001.json`) is the single source of the
agent-facing browser contract; this section covers only the operator-owned setup it
depends on.

Canonical MCP config lives at `library/cursor/mcp.json` and projects to
`.cursor/mcp.json` only in `self_development` mode:

```sh
./bin/pan models --sync
```

Installed servers: `chrome-devtools` (primary) and `playwright` (explicit fallback
only). Both fetch on first `npx` run, so the first use needs network.

`BROWSER-001` requires a Chrome for Testing bundle — a distinct install, never the
operator's personal `com.google.Chrome` identity. Point the server at it and check
readiness:

```sh
./bin/pan doctor   # reports browser_automation.chrome_for_testing
```

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "chrome-devtools-mcp@latest",
        "--executablePath=/path/to/chrome-for-testing",
        "--isolated"
      ]
    }
  }
}
```

Do not put long-lived MCP customizations only in `.cursor/mcp.json`; that file is
projection-owned and will be overwritten on sync. Edit `library/cursor/mcp.json`
instead. Embedded target repositories own their own MCP config; Pancreator
documents the hardening above but does not install or overwrite target
`.cursor/mcp.json`.

## Select pipeline models

`config.json` is the source of truth for named persona-to-model mappings and carries the recommended defaults a release can update. Canonical Cursor artifacts live under `library/cursor/`; `.cursor/` is ignored local output. Set `active_config` to one of the declared configurations, then regenerate the Cursor surface:

```sh
./bin/pan models --sync
./bin/pan validate
```

When the local Cursor model catalog is stale or incomplete, `./bin/pan models --sync --force` still projects the configured specs. Grammar still applies. `pan validate` and run start still enforce the catalog.

Run `./bin/pan models` without `--sync` to preview the active mapping and any drift without changing files.

Per-checkout preferences belong in `config_overrides.json` next to `config.json` (the legacy name `config.local.json` still reads until you rename it). The file is untracked (keep it out of version control, e.g. via `.gitignore` or `.git/info/exclude`) and merges over `config.json`: objects merge recursively, any other value replaces the checked-in one. Use it for `active_config`, persona model overrides, or an `operator_involvement.active` selection, so `config.json` stays at the recommended defaults releases update. A local preference behaves exactly as if it were edited into `config.json`, including drift detection against in-flight runs. An empty string in a named config inherits the `defaults` entry for that persona, so `config_overrides.json` needs to name only the personas a config changes. An empty string in `defaults` is rejected.

Define aliases in the four top-level family maps. Each map accepts the optional keys `balanced`, `advanced`, and `ultra`:

```json
{
  "anthropic": {
    "balanced": "claude-sonnet-5",
    "advanced": "claude-opus-5[thinking=true,context=300k,effort=high,fast=false]"
  },
  "oai": {
    "balanced": "gpt-5.6-terra[context=272k,reasoning=high,fast=false]"
  },
  "open": {
    "balanced": "glm-5.2"
  },
  "cursor": {
    "balanced": "composer-2.5"
  }
}
```

A `config.json` persona mapping can reference tier aliases such as `anthropic:balanced`, `oai:advanced`, `open:balanced`, and `cursor:advanced`. Pancreator expands those aliases into explicit model specs before it snapshots runs, projects Cursor agents, or delegates to executors.

In `config.json` Pancreator always reserves exact `cursor:balanced`, `cursor:advanced`, and `cursor:ultra` values for alias resolution. A reference to an undefined tier is a configuration error. Every other `cursor:<model>` value keeps its existing executor-routing behavior. The best-of-N configs file accepts no tier alias and rejects an alias-shaped value. That file is `best-of-n-config.json` in the repository root, or another path that `pan best-of-n init --configs` names. A best-of-N candidate map MUST name an explicit model spec. The file is operator-local and untracked, and no command generates it: copy [`library/templates/best-of-n-config.example.json`](../library/templates/best-of-n-config.example.json) to create it, and see [`docs/best-of-n.md`](best-of-n.md) for the full shape.

Each new run snapshots the active configuration in `runtime/logs/workflows/<run-id>/agent/pipeline-config.snapshot.json`. Invocation cards resolve their model from that snapshot. Because Cursor executes the model declared in `.cursor/agents/pan-<persona>.md`, preparing an older run after switching configurations is blocked until the projected agent models again match that run's snapshot. This prevents the card from claiming one model while Cursor launches another.

## Route a persona to an external executor

A persona mapping may name its executor with a prefix from a closed set — `cursor` (the default), `claude-code`, or `openai`:

```json
{
  "configs": {
    "balanced": {
      "planner": "claude-code:claude-opus-5[permission-mode=default,session-resume=true]",
      "reviewer": "openai:gpt-6-astra[effort=high,session-resume=true]",
      "coder": "claude-opus-5[context=300k,effort=high]"
    }
  }
}
```

For compatibility, Pancreator still reads a legacy nested `personas` object in a named configuration. A nested entry wins over a flat key for the same persona. Pancreator emits only the flat shape.

An external-executor persona is executed by that runtime instead of a Cursor subagent, so the same model can author a stage under another harness while Pancreator's run state, gates, and operator contracts stay authoritative. Any stage may be routed this way, including mutating ones; non-mutating stages run with file-write tools restricted to the harness runtime tree, and `scope.no_unapproved_changes` remains the gate of record either way. The `orchestrator` persona is the exception — it is the supervisor itself and must stay on `cursor`.

Note that `openai:` names a runtime, while `oai:` names a tier alias family of Cursor models. They are unrelated, and an alias family value may never carry an executor prefix.

Behavior shared by every harness-dispatched executor:

- Run creation verifies the executor is reachable; the first delegation of a run verifies credentials. A failed preflight pauses the run with an operator decision — it is an operator-visible stop, not an error to work around, and the harness never silently substitutes Cursor.
- When a run reaches an external stage, the supervisor runs `./bin/pan delegate <run-id>` instead of invoking a subagent. The harness delivers the canonical card, writes the delegation evidence itself, and records the executor session.
- `./bin/pan decide <run-id> revise --note "<directive>"` on an external stage resumes the author's recorded session with your directive, so refinement rounds keep full context. Retries after failures always start fresh.
- `./bin/pan models --sync` skips projecting external personas into `.cursor/` and removes a stale projected agent when a persona moves to an external executor.

### `claude-code`

Supported bracket options: `permission-mode` (`default`, `acceptEdits`, `plan`, `bypassPermissions`), `session-resume` (`true`/`false`, default `true`), and `timeout-ms`.

The `claude` CLI must be installed and authenticated on each machine that runs delegations (set `PANCREATOR_CLAUDE_BIN` if the binary is not on `PATH`). `./bin/pan doctor` reports availability when the active mapping uses `claude-code`.

### `openai`

An `openai` persona is executed directly against the OpenAI Responses API — `openai:gpt-6-astra` is the primary example. There is no CLI to install: the harness runs the tool loop itself, offering the author a fixed catalog of file and shell tools bounded by the stage's own write policy.

Supported bracket options:

| Option              | Values                                                     | Default                 |
| ------------------- | ---------------------------------------------------------- | ----------------------- |
| `context`           | `auto`, `current_turn`, `all_turns`                        | the API's own default   |
| `effort`            | `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` | the model's own default |
| `max-output-tokens` | a positive integer                                         | the model's own default |
| `max-tool-rounds`   | a positive integer                                         | `60`                    |
| `mode`              | `standard`, `pro`                                          | the model's own default |
| `session-resume`    | `true`, `false`                                            | `true`                  |
| `summary`           | `auto`, `concise`, `detailed`                              | no summary              |
| `timeout-ms`        | an integer of at least `1000`                              | `3600000`               |
| `verbosity`         | `low`, `medium`, `high`                                    | the model's own default |

`effort`, `mode`, `context`, and `summary` set the Responses `reasoning` parameter; `verbosity` sets `text.verbosity`. Each is sent only when the mapping names it, so an option you omit leaves the API default in place. `verbosity` shapes answer detail and is not a token bound — `max-output-tokens` is that one.

Every enum is validated against the set above rather than against a per-model catalog, so a specific model may still reject a value the harness accepts; the API error names that model's own set. `gpt-6-astra`, for example, rejects `effort=none` and `effort=minimal`, and bounds `max-output-tokens` to 16–128000. The tool-result cap is a fixed harness bound of `262144` bytes, not a mapping option.

`context` has a harness-side caveat. The API is called with retention disabled, and the local transcript replays only messages and tool calls, so no reasoning item from an earlier turn is ever resent. `all_turns` and `auto` therefore have nothing earlier to reuse, and they behave like `current_turn` until the transcript also replays encrypted reasoning items. The option is accepted and forwarded so a mapping is ready when that lands; set it today only if you want that recorded intent.

Do not read `context` here as the Cursor `context` option, which sizes a model's context window. Executor prefixes select independent option sets, and this one names the Responses `reasoning.context` parameter.

Requirements and behavior:

- `OPENAI_API_KEY` must be readable from the process environment or a `.env` file Pancreator inspects. `./bin/pan doctor` reports readiness when the active mapping uses `openai`, and never prints the key itself. No credential value is written to run state, evidence, or a captured stream; a redaction marker takes its place.
- The API is called with retention disabled, so no conversation is stored server-side. Continuation for a `revise` decision is local: the harness replays the prior conversation from a transcript under the run's evidence directory. A transcript that outgrows its cap drops its oldest turns and says so; one that is missing or unreadable falls back to a fresh full-card delegation.
- The author gets no MCP tool, which means no isolated browser inspection. Route a stage that owes a browser verdict to a Cursor persona, which `BROWSER-001` requires. The delegation record states the offered capability set on every run.
- A delegation that exhausts its round limit, session timeout, or tool-result cap fails with that reason named in the record rather than returning a partial result.

## Targeting a deliverable outside the repository root

For ordinary target work, install Pancreator into the target repository and open that target in Cursor. `.pancreator/config.json` sets `workspace_root` to `..`, so workflow fingerprints, gate commands, and scope guards apply to the target automatically. Confirm the workspace shown on each invocation card before trusting gate results. `--workspace` remains an explicit override for exceptional self-development or migration work, not the default deployment model.

Bootstrap a target with `./bin/install --target <path>` from the Pancreator source checkout, then run `./.pancreator/bin/pan doctor` and `./.pancreator/bin/pan validate` from the target. See [`docs/embedded-installation.md`](embedded-installation.md) for Cursor merge semantics, versioned updates, partial-install prompts, and cleanup.

## Working in operator worktrees

A worktree is a second working directory of the same repository. Every worktree is created with `git worktree`, so all worktrees share one object store and one set of branches; only the checked-out files are duplicated. Use one when you want a run to work on a line of work the main checkout is not holding, or when you want several independent lines of work side by side.

```sh
./bin/pan worktree create feature-login --description "Rework the login flow"
./bin/pan worktree list
./bin/pan init --request runtime/inbox/queue/request.md --worktree feature-login
```

- `create` makes the exact branch `<name>` from `--from` (a branch, a revision, or another recorded worktree) and defaults to the commit the main checkout currently holds. Names use lowercase letters, digits, and single hyphens, because the name becomes both a directory and a branch.
- Worktrees live under `worktrees/operator/<name>` and are recorded in `worktrees/operator/index.json` with branch, commit, description, and creation date. That index is harness-owned generated state; change it only through these commands. Installations that still hold only `runtime/worktrees/operator/index.json` continue to use that legacy index in place, and new worktrees are created under `worktrees/operator/`. A `worktrees.root` you declare in `config.json` overrides both locations and is never relocated.
- `list` adds live state to the recorded fields: whether Git still registers the directory, the current head commit, and whether the worktree is dirty. `--json` returns the same records for scripting.
- `--worktree <name>` is one shared option with one contract: every workspace-aware command accepts it, resolves the name the same way, and creates the worktree when the index does not hold it. The workspace-aware commands are `init`, `prepare`, `resume`, `submit`, `author apply`, `author validate`, `release sync`, `release continue`, `release finalize`, `conform scan`, `conform checkpoint`, `style scan`, `style checkpoint`, `repository-check <profile>`, `requirements run`, `tests impacted`, `technologies detect`, `doctor`, and `governance card --mode <mode>`. Every other command rejects `--worktree` with an explicit error naming this list. The branch of the main checkout never changes.
- `worktree resolve <name>` applies the same create-or-resolve behavior directly and reports the worktree record with a `created` flag. Projected commands that delegate a named persona bind their workspace through it. `/pan-start` passes the selected worktree to `init` and every later lifecycle call. `/pan-resume` reads the stored binding and passes the same name to `resume`, `prepare`, and `submit`.
- `resolve` also adopts a worktree you made yourself. A directory at `worktrees/operator/<name>` that Git registers as a worktree on the branch `<name>` is indexed in place, receives the local configuration handoff, and runs the setup commands, which is what creation would have produced. Every other existing path still refuses with `WORKTREE_PATH_EXISTS`: a plain directory, a checkout on another branch, or a worktree of another repository.
- `init --worktree <name>` records the worktree directory as the run's `workspace_root`. Each lifecycle call restores the registered branch before mutation. The run's repository-check baselines and deterministic gates then run inside the worktree. `--worktree` and `--workspace` name two different workspaces, so pass only one.
- `pan repository-check <profile> --workspace <name>` also accepts a recorded worktree name or a directory path; unlike `--worktree`, it never creates anything.
- `remove <name>` refuses a worktree with uncommitted work unless you pass `--force`, and keeps the branch unless you pass `--delete-branch`. Uncommitted work excludes an untracked path a `read-only-input` attribution covers, so a worktree holding only recorded inputs is removed without the flag; Git needs force to discard those files, and the harness supplies it from the exemption rather than asking you for it. The refusal names each blocking path with its attribution status. The refusal comes before any change to the index, so the record is still there for the retry. When you already deleted the directory yourself, `remove` prunes the stale Git registration and the index entry. A directory that is still on disk while no repository registers it is refused instead, because dropping the record there would leave the directory unaddressable; remove the directory yourself, or repair the record with `worktree resolve <name>`.
- `--delete-branch` deletes the worktree branch only when it is an ancestor of the default branch, so merged work is cleaned up in one command and unmerged work is never discarded. A refusal reports why and keeps the branch.
- Worktree provisioning is declared, not inferred. `config.json` sets `worktrees.setup` to the commands that prepare a new worktree and `worktrees.readiness_paths` to what those commands produce. A run whose workspace is a worktree checks those paths before its first stage: a ready worktree skips the workspace setup step rather than installing its dependencies a second time, and one that is missing an item names that item and provisions the tree.

### Worktree readiness

A worktree that the harness did not fully provision used to fail at the first gate, with a missing build reported as a product failure. Readiness is now a property the harness asserts before a run works in the tree. It covers the declared setup outputs — the dependency tree and the build output in this repository — and the local configuration handoff a self-development worktree needs. A gap is reported by name, before the first prepare.

An installation that declares no `worktrees.readiness_paths` cannot have its provisioning judged, so its runs keep running the workspace setup step exactly as before.

Best-of-N candidate worktrees are separate. They live under `worktrees/<bon-id>/` and remain owned by `./bin/pan best-of-n`, so `pan worktree` neither lists nor removes them. Existing sessions may still reference legacy paths under `runtime/worktrees/<bon-id>/`; those paths remain authoritative until the operator removes the session.

### Reconciling worktrees

```sh
./bin/pan worktree reconcile --into trunk --source feature-login --source feature-billing
./bin/pan worktree reconcile --into-branch main --source feature-login --source feature-billing
```

`reconcile` merges two or more recorded source worktrees, one at a time and in the order you list them, with `git merge --no-ff`. The target is either a recorded worktree (`--into`) or an existing local branch (`--into-branch`). A branch no checkout holds is checked out into a new recorded worktree first, because Git can only merge inside a working tree. A branch a checkout already holds — including `main` in the main checkout, as above — merges inside that checkout, which must be clean; a dirty holding checkout is refused before any merge. Every source and the target are judged by the shared clean-tree rule, so an untracked path a `read-only-input` attribution covers does not refuse the merge, and a refusal names each blocking path with its attribution status. Every reconcile appends its operator invocation and outcome to `runtime/logs/worktrees/reconcile.jsonl`.

Under `ACTION-001` an agent may run `pan worktree reconcile` on its own judgment when the target is `pan-dev` or a branch that lands on `pan-dev`. Merging into `main` is your promotion step, not the agent's.

On conflict the command stops at the first conflicting source and exits non-zero, and a conflict request is written to `runtime/inbox/queue/` naming the target, the completed sources, the conflicted paths, and the sources not started. In a recorded worktree target the merge state stays in place; direct an agent at that request to resolve the conflict and commit the result. In a held checkout the conflicted merge is aborted instead, so your working tree comes back untouched; completed source merges remain on the branch, and the request explains how to finish through a worktree.

Configure defaults in `config.json` when the built-in ones do not suit the repository:

```json
{
  "worktrees": {
    "root": "worktrees/operator",
    "branch_prefix": "worktree/",
    "setup": ["npm ci"]
  }
}
```

`setup` commands run inside a new worktree, in order, immediately after creation. A failing setup command fails `create`, and the half-prepared worktree stays recorded so you can inspect or remove it.

## Plan once, then deliver

The `planning` workflow is the entry point for delivery work and the default of `pan init`. It runs one `plan` stage behind one operator gate, and approving that gate is the routing point: the harness reads the ratified cohort plan and starts the delivery itself. You never choose between a single run and a fan-out; the plan does.

```sh
./bin/pan init --request runtime/inbox/queue/request.md
```

The ratified artifact is a specification hierarchy rather than a single document. The **parent specification** carries the complete record of the request. One **child specification** per chunk carries the work a single delivery run owns, and reaches the parent through an audited reference — the parent path, the content digest, and the read trigger — instead of a copy of the parent body. A child specification governs its own chunk; the parent governs anything that spans chunks.

The artifact also records a **cohort plan**: the chunks, the dependency edges between them, and the cohorts those chunks are grouped into. Cohorts are numbered from 1 and run in order. No chunk depends on another chunk of its own cohort, so every chunk of one cohort can run at the same time, and every dependency points into an earlier cohort. A single chunk is an ordinary outcome; the plan then records why the work stays serial.

Two pre-submit validators check the artifact before you ever see it. One rejects a cohort plan whose graph contains a cycle, an edge inside one cohort, or a dependency on the same or a later cohort. The other rejects child specifications that pasted the parent body, that reference the parent without an audited reference, or that do not trace each originating requirement, constraint, exclusion, and open question exactly once. An item several chunks legitimately carry is traced once as shared: the cohort plan lists it in `shared_items`, and every chunk that carries it names it. It also rejects a constraint, exclusion, or open question that opens with no identifier, because nothing could trace it.

### The state machine

| From                                      | Condition                                  | The harness starts                                                                                                                                                                                                                                                                                                                                                                  | Then                                                        |
| ----------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `planning` / `plan` approved              | the plan holds exactly one chunk           | one `delivery` run (`implement → verify → remediate → ship`) in a fresh worktree; request = the child specification, context reference = the parent specification                                                                                                                                                                                                                   | `/pan-resume <run-id>` supervises it to `succeeded`         |
| `planning` / `plan` approved              | the plan holds two or more chunks          | a cohort session and cohort 1: one `delivery-chunk` run (`implement → verify → remediate`) per chunk, each in its own worktree                                                                                                                                                                                                                                                      | `/pan-cohort <cohort-id>` supervises the chunk runs         |
| every chunk run of cohort _n_ `succeeded` | the last of those runs reached `succeeded` | a commit of each chunk worktree that still holds work, the merge of the chunk branches into the integration branch, and the merge proof; then cohort _n + 1_ when one remains                                                                                                                                                                                                       | `/pan-cohort <cohort-id>` continues with the new chunk runs |
| the last cohort integrated                | the merge proof landed                     | the release run: one `delivery` run that begins at `verify` (`verify → remediate → ship`) in a managed worktree of its own, on a `release-<digest>` branch created from the integration head, or on the integration branch itself when `--into-branch` recorded a worktree for it; request = the operator request the plan run stored, context reference = the parent specification | `/pan-resume <run-id>` supervises it to `succeeded`         |

A cohort session runs to its release run without stopping for you between cohorts. When the last chunk run of a cohort reports `succeeded`, the lifecycle command that closed it commits each chunk worktree that still holds work, merges the chunk branches, writes the merge proof, and starts the next cohort or the release run. The response carries that under an `advance` object: `status: "integrated"` repeats the integration result with the continuation nested under `autostart`, and `status: "failed"` names the error together with the `pan cohort integrate <cohort-id>` retry. Every other transition adds only worktrees, branches, and run records. Pushing, merging the integration branch onward, publishing, deploying, and deleting branches stay yours.

The `decide` response, and an `away apply` response that approves the gate, carries an `autostart` object with a `status` of `started`, `already_started`, or `failed` and a `kind`. For `kind: delivery` the object carries `run_id`, `worktree`, and `resume_command` (`/pan-resume <run-id>`). For `kind: cohort` it carries `cohort_id`, `cohort_index`, `max_parallel`, `deferred_chunks` (the chunks the parallelism limit left unstarted), `supervise_command` (the `/pan-cohort <cohort-id>` session for the whole cohort), and `chunks`, one entry per started chunk run with `chunk`, `run_id`, `worktree`, and `resume_command`. `already_started` means an earlier approval already started that delivery, so nothing failed. For `failed` the object carries `error` and `manual_commands`; the approval and the ratified plan stand. The one manual command is `pan cohort route --plan-run <plan-run-id>`, for the single-chunk route and the cohort route alike. It is the idempotent retry: it adopts a run or session the failed attempt already created rather than creating a second one, so running it twice is safe. The failed route is persisted on the plan run, so `pan status <plan-run-id>` shows `Delivery route failed: <error>` with that command under `Manual:`, and a successful route replaces the failed line with the started delivery. `pan status <plan-run-id>` names the handoff (`delivery_handoff`), and `pan cohort integrate` reports its own continuation under the same `autostart` key with `kind: cohort` or `kind: release`; `pan cohort status` names the release run as `release_run_id`.

The route runs after your decision is already recorded and never rewrites it. It fires for your own `pan decide approve` and for an away-mode approval applied on your behalf, because the route is a recorded property of the run rather than a judgment made at approval time.

### Opting out of the route

```sh
./bin/pan init --request runtime/inbox/queue/request.md --no-autostart
```

`--no-autostart` applies only to the `planning` workflow and records that ratification stops at the plan. You then start the delivery by hand: `pan cohort init --plan-run <plan-run-id>` and `pan cohort start <cohort-id>` for a fan-out, or `pan init --workflow delivery --request <child-spec> --context-reference <parent-spec> --worktree <name>` for a single chunk. That is the opt-out path only; a route that failed after an ordinary approval is retried with `pan cohort route --plan-run <plan-run-id>` instead. `--autostart` names the default and is still accepted. Add `--max-parallel <n>` to record the parallelism limit an autostarted cohort session uses (default 4).

`--workflow delivery` remains available as an explicit escape hatch when you bring your own ratified specification: it skips planning and starts at `implement` with your request as the plan. No command or brief chooses it for you.

### Running the fan-out by hand

```sh
./bin/pan cohort init --plan-run <plan-run-id>
./bin/pan cohort start <cohort-id>
./bin/pan cohort status <cohort-id>
./bin/pan cohort integrate <cohort-id>
```

- `cohort init` reads the ratified cohort plan from the planning run and opens a durable cohort session under `runtime/logs/cohorts/<cohort-id>/`. The session is the authority on the fan-out, so it survives the session that created it and `status` reads it back with no in-memory state. The route runs it for you on approval; you run it yourself only after `--no-autostart`. After a failed route, `pan cohort route --plan-run <plan-run-id>` is the retry; a hand-run `cohort init` also clears the failed record on the plan run.
- `cohort route --plan-run <plan-run-id>` retries a failed plan route. It reads the ratified plan and starts what the approval would have started: one `delivery` run for a single chunk, or the cohort session and cohort 1 for a wider plan. It is idempotent, so it adopts a run or session the failed attempt already created instead of creating a second one, and a successful route replaces the `Delivery route failed` line in `pan status <plan-run-id>`.
- `cohort start` starts the earliest unsatisfied cohort. It creates one worktree and one `delivery-chunk` run per chunk of that cohort, so no two concurrent chunk runs share a workspace root. Each chunk run receives its child specification as the request and the parent specification as a context reference. Supervise the cohort with `/pan-cohort <cohort-id>`, which holds the chunk runs together and advances each one independently; `/pan-resume <run-id>` still continues a single chunk on its own. Chunk runs get their models from the ordinary top-level launch. Pass `--cohort <index>` to name a cohort explicitly; naming one whose predecessor is unsatisfied is refused with `COHORT_PREDECESSOR_UNSATISFIED`, and the message names the cohort that blocks it. A cohort wider than the parallelism limit starts in batches; run the command again as chunk runs finish.
- `cohort status` reports each chunk with its run status, current stage, and resume command, which cohorts are satisfied, which cohort is active, which cohort is blocked behind it, and the release run once the last integration started it. When every cohort is satisfied and no release run is recorded, it also reports `release_command`, which is `pan cohort release <cohort-id>`; running it restarts the release continuation without a merge.
- `cohort integrate` is the retry of an automatic advance that failed; the harness runs the same path by itself when a cohort finishes. It commits each chunk worktree that still holds work, merges the chunk branches of the active cohort into the cohort base branch, and writes the satisfaction entry. That entry is the only signal that unblocks the next cohort. Each harness unit commit carries only that worktree's own changes and names the chunk id and its run id, so the audit trail says which run produced what. The merge proof is `runtime/logs/cohorts/<cohort-id>/integration-<index>.json`, written for every cohort whatever its chunk count: the merged branches, each merged chunk with its run id, branch head, and the `unit_commit` the harness created for it, the integration head before and after the merge, and, for a cohort of two or more chunks, the path of the shared reconcile ledger `runtime/logs/worktrees/reconcile.jsonl`. The satisfaction entry and the command response name that record as `evidence_path`. A chunk run that has not succeeded, an integration checkout holding uncommitted work, or a merge conflict leaves the entry unwritten and the next cohort blocked, rather than letting later work branch from changes that never landed. The integration checkout is judged by the shared clean-tree rule: an untracked path a `read-only-input` attribution covers does not block the merge, and a refusal names each blocking path with its attribution status. The same record keeps that path out of the harness unit commit, so a read-only input placed in a chunk worktree is neither committed nor a blocker. The command needs no operator directive, because it retries a step the harness owns; pushing that merge anywhere is still yours. Once the entry lands the harness continues: it starts the next cohort, or, after the last one, the release run. The response reports that continuation as `autostart`; a failed continuation leaves the merge proof in place and names the manual command, which for the release is `pan cohort release <cohort-id>`. `cohort integrate` is the only command that merges.
- `cohort release <cohort-id>` is the merge-free release continuation. It refuses unless every cohort holds its merge proof, then starts the release run or adopts the one an earlier attempt already created, so running it twice is safe. It is what `cohort status` reports as `release_command` and what a failed release continuation lists under `manual_commands`. It merges nothing and rewrites no branch. When no worktree holds the integration branch, it creates the `release-<digest>` worktree and branch from the integration head, exactly as the integrate continuation does. The merge proof stands and nothing merges twice.
- The merge runs inside the checkout that holds the base branch, so that checkout has to be clean. When it carries unrelated uncommitted work you will not commit or stash, pass `--into-branch <branch>` once: the session records that branch as its integration branch, this cohort and every later one merge into it, later cohorts branch from it, and the merge runs in a recorded worktree instead of your checkout. A branch that does not exist is created from the current integration head; an existing branch must already contain that head, or the command refuses with `COHORT_INTEGRATION_TARGET_DIVERGED`. Merging the integration branch into the base branch afterwards is your decision. The release run never runs in your checkout. When `--into-branch` recorded a worktree for the integration branch, the release run is bound to that worktree. Otherwise the harness creates a managed worktree named `release-<digest>` (six hex characters derived from the cohort id) from the integration head and binds the run to it. `pan status <release-run-id>` names the worktree. Lifecycle commands on that run, and the `pan release sync`, `pan release continue`, and `pan release finalize` calls its ship stage makes, take `--worktree <that name>`. After ship, merge the `release-<digest>` branch into the integration branch yourself.
- The chunk branches merge one after another, so a conflict on a later chunk leaves the earlier merges on the base branch. The harness does not undo them, because rewriting your branch is your decision. The error names the chunk that conflicted, the chunks that already landed, and the base commit before integration began, and it writes the same facts to `runtime/logs/cohorts/<cohort-id>/integration-<index>-incomplete.json`. The conflicted merge itself is aborted, so the checkout that holds the base branch is left clean. Resolve the divergence on the chunk branch, then integrate again; the chunks that already landed merge as no-ops.
- `cohort abandon <cohort-id> --chunk <id> --note "<why>"` excludes one chunk from its cohort. The note is required, because dropping a chunk is your decision and the record has to say why. An abandoned chunk is never started by a later `cohort start`. When every chunk of a cohort is abandoned, `cohort integrate` has nothing to merge, so it records the satisfaction entry against the current base head and lists the abandoned chunks in the integration record, and the next cohort can start.
- `cohort clean <cohort-id>` removes the chunk worktrees and keeps every branch. Every chunk is checked first, so a live run or uncommitted work in any chunk refuses the whole command and removes nothing unless you pass `--force`. A chunk holding only untracked paths a `read-only-input` attribution covers is not uncommitted work and is removed without the flag. A chunk you already abandoned is the exception: its recorded abandonment stands in for `--force` on that chunk's dirty worktree, so the command discards the uncommitted work there and lists each such chunk under `discarded_abandoned_chunks` with the note the abandonment recorded. The response lists the worktrees it removed.

Satisfaction is never a field an agent fills in. It is computed from two independent durable facts: each chunk run's own state reports `succeeded`, and the integration recorded the merge. Starting or preparing a run whose predecessor cohort is unsatisfied fails with `COHORT_PREDECESSOR_UNSATISFIED`, and the same refusal is recomputed on every call, so advancing a chunk run directly does not get around it.

### Migrating a run already in flight

The `planning` workflow and the `pan cohort` lifecycle are additive. A `delivery` run that was created before they existed keeps its own snapshotted workflow, including its `plan` stage, and finishes on that snapshot; nothing about it changes and no command needs to be rerun. To move in-flight planning work onto the cohort lifecycle, let the current run reach its plan gate and ratify it, then start a new `planning` run from the same request. The new run writes the parent and child specifications and the cohort plan; `cohort init` reads only a ratified `planning` run, so it does not read the plan stage of an older `delivery` run.

A `planning` run created before routing became the default recorded neither an opt-in nor an opt-out. Approving its plan returns a `failed` route whose error says the run predates routing and recorded no opt-in or opt-out, and `pan status <plan-run-id>` shows that line under `Delivery route failed`. The approval and the ratified plan stand. Run `pan cohort route --plan-run <plan-run-id>` to route it; the command starts the delivery the approval would have started and replaces the failed line.

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

While paused, you MAY modify tracked files in the deliverable workspace directly. On resume, including resume with `--stage`, Pancreator compares the workspace to the pause-start snapshot. Authorized pause-only changes are recorded in a ratification artifact, the accepted workspace fingerprint is updated, and any prepared invocation is invalidated so it can be regenerated against the changed workspace. Changes that predated the
pause are not silently ratified. Resume with `./bin/pan resume <run-id>` or
deliberately restart at a different stage with `--stage <slug>`.

Resume from the stage that owns the remediation when the pause was harness-initiated (blocker, circuit breaker, or workspace anomaly). Do not resume from review or test when the defect belongs to implementation.

- `./bin/pan resume <run-id> --stage implement --note "<required changes>"` restarts implementation and attaches the latest note to the next invocation card as required remediation input.

### Waiving or bypassing a workflow stage

A waiver is an operator directive, not a permission request. Use it whenever you intentionally want to bypass ordinary process, checks, evidence requirements, workspace-fingerprint matching, or a stage transition:

```sh
./bin/pan waive-gate <run-id> \
  --note "<directive and terms>" \
  [--stage <source-stage>] \
  [--to <destination-stage>] \
  [--criteria <id[,id...]>] \
  [--defer <acceptance-id[,acceptance-id...]> --spotfix] \
  [--adopt-plan-from <run-id>]
```

The command may target current or historical workflow stages, including harness-owned stages, and may redirect a terminal run when the operator explicitly names the source and destination. Destinations may be workflow stages or terminal states such as `succeeded`. It does not require a pause, exact criterion matching, valid stage output, or an unchanged workspace. The note defines the directive; criteria and follow-up tracking are optional metadata. The harness records what was bypassed and where the run was routed.

One confirmation narrows the default route, and only the default route. When the waived stage holds no prepared or in-flight invocation, the run leaves for that stage's success transition, which also bypasses the waived stage's own gate. The harness refuses that jump with `WAIVER_DESTINATION_REQUIRED` unless you state it: pass `--to <stage-slug>`, or name the destination stage or the gate in the note. The `next_stage` gate is exempt because it advances on its own and withholds no judgment; the `operator`, `supervisor`, and `stage_verdict` gates each withhold an advance, and that is the judgment a silent forward route discards. Naming the waived stage is not enough, because a note about waiving verify says "verify" whether or not its author knew the run would leave for ship.

“Operator-owned” means only the operator may decide to waive. An agent may execute the command when the operator explicitly directs it and must not answer that the operator is “not allowed” or that a waiver is impossible because of harness governance.

#### Adopting another run's plan

`--adopt-plan-from <run-id>` records that this waiver reuses another run's ratified plan. A worktree is occupied by every live run bound to it, and a subsumed run stays live because nothing closed it, so its claim would otherwise block the adopting run's release preparation until you aborted it. The option moves the claim: both run states record the transfer, the subsumed run is no longer bound to the worktree, and its status is untouched.

Both runs must be bound to the same worktree. When `RELEASE_WORKFLOW_ACTIVE` still fires, it names the run holding the claim and the command that releases it, which is this option for a run whose plan you are adopting and an abort for a run that never exchanged a plan with yours.

### Operator stage repair

`./bin/pan set-stage <run-id> --stage <stage> --note "<reason for repair>"`
moves the run directly to any stage without following the current transition. It
clears the active invocation, resets the target segment's attempt budget and the
transition/failure circuit-breaker counters, records an `operator_stage_set`
event, and attaches the repair note to the next invocation.

This is an operator-owned decision. The operator may run it directly or explicitly direct an agent to run it. Stopping an obsolete worker first remains prudent because that worker may continue writing against stale state, but it is an operational warning rather than a restriction on operator authority.

## Workspace mutation contract

Pancreator does not recursively index the workspace. During a `source_allowed` stage, the worker may edit tracked source files within declared scope. Compiled artifacts, caches, virtual environments, and third-party dependency/package directories are outside agent remit and must never be read, edited, created, deleted, validated, or reported. Git-visible fingerprints and stage evidence track relevant source state.

Governance and artifact diagnostics are advisory until ship. The release steward reviews and repairs safe runtime-only issues, pauses only for a legitimate implementation, test, security, or release concern, and never sends governance paperwork back to the coder. Product or test failures still follow their owning remediation route.

The self-development ship stage may change only release metadata and version-bearing documentation plus runtime artifact repairs. Embedded ship may repair only Pancreator runtime artifacts and must not modify target source. Do not run concurrent mutating workflows against one workspace; pause before operator-driven tracked changes.

### Attributing a workspace change

```sh
./bin/pan attribute <run-id> --note "<directive>" \
  [--role supervisor|operator] \
  [--disposition read-only-input|commit-with-unit|operator-owned] \
  [--paths <path[,path...]>]
```

`attribute` records a change you directed outside a stage, so the next invocation card presents those paths as already accounted for instead of leaving every later worker to audit them. Without `--paths` the harness attributes every dirty tracked path of the workspace.

`--disposition` states what may be committed, and it is the fact every clean-tree gate reads:

| Value              | Meaning                                                                                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `read-only-input`  | You placed the path as an input that must never be committed. An untracked path with this disposition does not block `cohort integrate`, `cohort clean`, `worktree remove`, `worktree reconcile`, best-of-N cleanup, or release finalization, and no harness commit stages it. |
| `commit-with-unit` | The work belongs in the unit's own commit. It still blocks, and a refusal says so rather than telling you to commit it blindly.                                                                                                                                                |
| `operator-owned`   | The default, and what every record written before this option resolves to. Every refusal that fires today still fires.                                                                                                                                                         |

Only an untracked path is ever exempt. A tracked modification blocks whatever a record says, because you declared the path an input rather than a file the repository does not track.

One record covers every checkout of the repository — the main checkout, every existing worktree, and every worktree the harness creates afterwards — so you attribute an input once rather than once per workspace. The store is generated runtime state at `runtime/logs/workspace-attributions.json`; never hand-edit it.

`worktree create` places each recorded read-only input into the new worktree when the source checkout holds it and the new worktree does not, and names what it copied under `carried_paths`.

## Repository verification profiles

The canonical target checks live in
`.pancreator/runtime/repository-checks.json`. `/pan-build-docs` must populate only
commands verified from the target repository's own documentation, manifests,
executable scripts, or operator instructions. `fast` is the shortest documented
default or primary suite, `secondary` is an optional complementary slow or
integration suite, and `full` is complete verification. Identical non-empty
`fast` and `full` command lists are invalid. Use explicit runtime entrypoints,
identity/version probes, and documented runtime bounds when PATH or environment
selection could change results.

Run a profile directly with:

```sh
./.pancreator/bin/pan repository-check static
./.pancreator/bin/pan repository-check fast
./.pancreator/bin/pan repository-check secondary
./.pancreator/bin/pan repository-check full
```

An empty profile is reported as `not_configured`; it is never silently replaced
with an npm, Python, or other technology-specific command. Direct runs stream
live subprocess output to stderr and print the final structured result to stdout.

A profile may declare `"concurrent": true`, which runs its commands together
under the profile's shared deadline instead of one after another. The recorded
result is unchanged: every command keeps its own exit code, duration, and
captured output, reported in the declared order. Only declare it for commands
that are genuinely independent — two commands that write the same build output,
database, or port are not — and the profile is only as fast as its slowest
command. No shipped template enables it. Turning it on is an operator edit to
that installation's own `runtime/repository-checks.json`. The self-development
`full` profile is a reasonable candidate, because its three commands serialize
their own compiles through the build lock.

For a systematic implementation run, Pancreator executes the configured
implementation profiles immediately before the first coder invocation and stores
the results as run-scoped baseline evidence. Existing lint or unit-test failures
remain visible, and the coder must repair them when the fix is bounded and low-risk,
but an unchanged baseline failure does not block advancement when remediation would
be broad, structural, or unrelated to the approved change. New or changed diagnostics
do block. This prevents unrelated repository debt from consuming repeated stage
attempts without allowing the implementation to introduce additional failures.

A deterministic shell gate may be accepted from `runtime/cache/gate-results.json`
instead of re-executing (`DEV-001`). Every worker card that owns such a gate, or
that is handed gate evidence, carries this same acceptance rule verbatim from
`GATE_CACHE_ACCEPTANCE_RULE` in `src/lib/gate-cache.ts`, as do the verify and
remediate prompts, so the operator and the worker read one statement in one
term:

> A gate marked `cached` is a real pass, not a skipped one: the identical gate
> command passed cleanly at this same Git workspace fingerprint and
> repository-check configuration within the last 24 hours, against a resolved
> run baseline, and its evidence log carries that original captured output.
> Treat it as evidence of the same strength as a pass the harness executed just
> now, and do not order a rerun to replace it. A failure, timeout, skip,
> override, or baseline-relative credit is never accepted this way.

A non-Git workspace is never `cached`. `./bin/pan doctor` reports the cache
state. Set `PAN_GATE_CACHE=0` to force every gate to execute, or delete the
cache file to forget every recorded pass.

Three behaviours feed that cache so a gate finds its answer already recorded.
A run whose baseline capture finds an earlier passing baseline artifact for the
same profile, workspace fingerprint, and repository-check configuration adopts
that artifact instead of executing the profile, and says which artifact it
adopted. A `pan repository-check <profile> --run <run-id>` that passes cleanly,
times out on no command, and leaves the Git fingerprint unchanged records its
own pass, so a later gate on the same command and fingerprint accepts it. A
verify-stage gate that accepts such a pass — a `fast` pass an agent ran from
the command line during implementation, for instance — is behaving as ratified
rather than skipping its own work. What makes the acceptance trustworthy is the
harness's own observation, not the agent's report: the harness resolved and ran
the identical command itself, saw a clean result with no timed-out command, and
saw an identical Git workspace fingerprint immediately before and immediately
after that run. A pass recorded for the profiled `full` profile also carries the
suite profile that execution wrote, so the ship card compares real timings from
the accepted execution. And
when a source-allowed stage submits successfully into the read-only evidence
stage, the harness starts one detached low-priority run of the ship entry
gate's profile at the submitted fingerprint, recording the child's process id
in the run's evidence directory. A prefetch that is killed or fails leaves
nothing behind and the gate simply executes as before. Set `PAN_PREFETCH_FULL=0`
to stop starting it.

Verification is read-only under `VERIFY-001`. The reviewer records every defect
as a finding with its severity and edits nothing, so the verdict never judges
code its author changed. A purely mechanical defect in a worker output or
record names its exact repair, which the supervisor applies under `ORCH-001`;
every other defect routes to remediation.

## Run harness evals

Evals are bounded toy workflow runs plus deterministic graders over the run's records. They show whether the agents obeyed the delivered policies, which no unit test can show. Run them on demand, never inside `npm test`:

```sh
./bin/pan eval list
./bin/pan eval run delivery-basic-test-discipline --attest-supervisor-card
./bin/pan eval grade <run-id> --scenario delivery-basic-test-discipline
```

`eval run` copies the scenario's toy fixture to `runtime/logs/evals/<eval-id>/workspace`, creates a run there, drives every harness-owned step, and stops with exact operator steps when a Cursor persona or an unscripted operator decision is next. `eval grade` grades any existing run, including a production run. See [`docs/evals.md`](evals.md) for the scenario format, the graders, and how to add either.

## Running only impacted tests

`./bin/pan tests impacted` is the iteration profile. It is never a gate. The
command builds the runtime import graph of `src/**/*.ts` and `tests/**/*.ts`
with the TypeScript parser, takes the change set from Git, and runs every test
in `tests/unit`, `tests/integration`, and `tests/regression` that the change
reaches. The `fast` profile stays the validation run at the end of an iteration
loop, and `full` stays the verify gate.

A test is selected when:

- it transitively imports a changed `src/` or `tests/` module through runtime
  imports (`import type` edges do not count; the build type-checks them);
- it is itself a changed test file;
- it names a changed `bin/` script (`bin/<name>` or `'bin', '<name>'`);
- it names a changed fixture directory under `tests/fixtures/`;
- it spawns the CLI (`dist/src/cli.js` or `bin/pan`) and any module `src/cli.ts`
  reaches changed;
- `--include <glob>` names it.

A change to `package.json`, `package-lock.json`, `tsconfig.json`, or the test
reporter selects the whole lane. `tests/secondary` and `tests/migrations` are
never selected.

```sh
./bin/pan tests impacted                       # dirty working tree vs HEAD
./bin/pan tests impacted --list                # print the selection, run nothing
./bin/pan tests impacted --list --json         # machine-readable selection
./bin/pan tests impacted --changed main        # main...HEAD plus the dirty tree
./bin/pan tests impacted --staged              # staged changes only
./bin/pan tests impacted --file src/lib/x.ts   # a hypothetical change
./bin/pan tests impacted --depth 1             # direct importers only
./bin/pan tests impacted --include 'tests/unit/naming*.test.ts'
npm run test:impacted                          # the same command as an npm script
```

The text output lists each selected test with the changed file that reached it
and the import depth, then a per-depth count. `--json` emits `changed`,
`selected`, `selected_count`, `lane_count`, `ratio`, `advisory`, `unreached`,
`type_only`, `reasons`, `depths`, `by_depth`, `graph_build_ms`, `exit_code`,
and `duration_ms`. The exit code follows `node --test`; `--list` exits 0.

The module graph of this repository is dense: `engine.ts` imports most of
`src/lib`, and most tests import `engine.ts` or `tests/helpers.ts`. A change to
a shared module can therefore reach half the lane or more. When the selection
reaches 60% of the lane (`--advisory-ratio` changes the threshold) the command
prints an advisory that the `fast` profile is the cheaper choice and names the
direct-importer count. Iterate with `--depth 1` in that case, then run `fast`
once.

No changed file selects nothing and exits 0. A change that no lane test
reaches also exits 0 and lists the changed files so you know to add a test; a
file other modules import only for types is marked as verified by the build.

Every invocation appends one record to `runtime/cache/test-impact.jsonl`:
timestamp, change-set fingerprint, changed and selected counts, lane count,
ratio, advisory flag, graph build time, duration, and the run result.

The `impacted` profile in `runtime/repository-checks.json` runs the same
command. An embedded target may declare its own `impacted` command in its
`repository-checks.json`; the harness never treats that profile as a gate.

## Read a gate's failure classification

When a repository-check gate fails, the harness asks of each newly failing
test whether the change could have caused it, and records the answer in the
gate's evidence log under `--- failure classifications ---`.

A test the change's import closure does not reach, and that the baseline was
not already failing, is rerun once on its own through the profile's
`isolation_command`. A rerun that passes, and whose transcript names the test,
makes the failure `environment_or_flake`: the gate passes with an advisory
naming the test and both results. Anything else keeps the failure.

The other dispositions each say why no pass was granted. `reproduced` means
the test failed again alone. `in_change_closure` means the change reaches the
test, so it is never reclassified. `isolation_unproven` means the rerun exited
cleanly but never reported the test, which is what a selector that matches
nothing looks like. `isolation_unavailable` means the harness could not
diagnose at all, and its `reason` distinguishes a profile with no
`isolation_command` from a workspace with no change evidence.

`isolation_command` is optional, and a profile without one keeps today's
behavior: every new failure fails the gate. A target repository gains the
classification only by declaring a command that runs one named test, with
`{file}` for the test file and `{test_pattern}` for the test name as an
anchored regular expression, or `{test}` for the name literally:

```json
"fast": {
  "commands": ["pytest -q"],
  "isolation_command": "pytest -q {file}::{test}"
}
```

Prefer `{test_pattern}` for any runner whose filter is a pattern. A literal
name containing `(`, `.`, or `|` is read as regular-expression syntax, and a
filter that matches nothing exits successfully — which is why a clean exit
alone never earns a pass.

## Govern the fast-lane wall

Self-development only. Every complete `npm test` run appends one record to
`runtime/fast-wall-series.jsonl` under the installation root that started it:
the UTC timestamp, the wall the runner measured around the suite, the wrapper's
own wall beside it, the test count, the worker count, the load average before
the run, the workspace fingerprint, the invoker, the run id, the phase that
produced it (`baseline`, a gate id such as `implement.unit_tests`, `agent`, or
`standalone`), the exit code, and the summed per-file test time. A harness gate
writes to the installation root's series and tags the run; a developer's own
`npm test` writes to the checkout it ran in and tags `standalone`.

```sh
./bin/pan tests wall          # rolling average, permitted ceiling, marginal cost, verdict
./bin/pan tests wall --json   # the same report as JSON
```

The report describes one population: the qualified complete fast-lane runs
recorded inside the trailing 24 hours. A row qualifies when its invoker is
`test` and its lane is the complete unit, integration, and regression set;
partial lanes, impacted subsets, and rows another writer appended are counted
as `unqualified_runs` and ignored. A failing run still executes every test, so
its exit code does not affect qualification. The marginal wall cost per test is
measured inside each run as the summed per-file test time divided by the worker
count and the test count, which is the wall one average test adds under the
runner's concurrency; the report averages that per-run figure over the same
window and names the sample count. Rows written before the phase and lane were
recorded qualify on their `test` invoker alone and carry no marginal sample.

The ceiling lives in the optional `fast_wall` block of `config.json`:
`ceiling_ms`, the base ceiling; `anchor_date`, the UTC date the allowance counts
from; and `weekly_allowance_ms`, the most the permitted value rises per complete
elapsed week. The permitted value never changes for machine load. The `ship`
stage of the `delivery` and `metacritic` workflows runs `pan tests wall` as the
hard shell criterion `ship.fast_wall_ceiling`, so a rolling average above the
permitted value blocks the release and the criterion's explanation names both
numbers. The command exits `1` on that verdict and prints `not applicable` in
an embedded or detached installation.

The verify card of a `delivery` or `delivery-chunk` run carries the fast wall,
the test count, and the marginal cost per test before and after the implement
stage. The before point is the run's `fast` baseline record, selected by the
fingerprint the run's baseline pointer names, so a baseline adopted from
another run or shared across a cohort still resolves. The after point is the
run's latest later-phase record. A run whose series holds neither shows no
section, and a point from a row with no summed file time reads as
`marginal cost unavailable` rather than as a zero.

### The suite worker count

`package.json` sets the worker count explicitly at `13`, overridable for one
run with `PAN_TEST_WORKERS`. Eleven complete fast-lane runs at one workspace
fingerprint, under everyday load, chose it:

| Workers | Runs | Mean wall | Median wall | Own spread |
| ------- | ---- | --------- | ----------- | ---------- |
| 9       | 3    | 147.1 s   | 151.0 s     | 16.3 s     |
| 13      | 4    | 141.3 s   | 140.7 s     | 8.2 s      |
| 17      | 4    | 141.1 s   | 139.9 s     | 12.3 s     |

Nine workers is clearly slower. Thirteen and seventeen are not distinguishable
from this population: seventeen leads by 0.2 percent on the mean and 0.5
percent on the median, and each group's own spread is more than ten times
either gap. A failing run counts here for the same reason it counts toward the
governed average, so all eleven runs are in the table. The operator ruled that
thirteen stands, as the lower-contention choice between two counts the data
cannot separate. Do not spend further fast-lane runs on the question.

## Run a batch repair pass

Two operator-invoked batch passes repair work no workflow stage owns. Each one
has its own standalone mode, its own scan-and-checkpoint command, and its own
checkpoint cache. Neither gates a stage, joins a repository-check profile, or
becomes a stage criterion.

`/pan-conform` repairs operator-timed prose and harness instruction text. It
scans the harness-owned `docs/issues/**/*.md`, `runtime/pr-descriptions/*.md`,
and `runtime/research/*.md`, which it may edit. `STE-001` binds its
durable-instruction rules to every instruction surface, so the pass also edits
`AGENTS.md`, `governance/criteria/*.md`, `governance/policies/*.json`,
`library/personas/*.md`, `library/skills/*.md`, `library/cursor/commands/*.md`,
and `library/cursor/rules/*.mdc`. In a policy file it repairs only the text of
an `instructions[]` entry. `governance/handbooks/` stays out, because a handbook
is guidance rather than instruction text. The pass reports rendered workflow
HTML and `CHANGELOG.md` without editing them. Its
issues come from `SIMPLIFIED-ENGLISH-VALIDATE-001`, and its checkpoint lives at
`runtime/cache/conform.json`.

`/pan-style` repairs code style. It scans the workspace source whose extension a
detected language owns: TypeScript, JavaScript, and Python. In a self-development
checkout the workspace is this repository. In an embedded installation the
workspace is the target repository, and the harness at `<target>/.pancreator` is
report-only. Its checkpoint lives at `runtime/cache/style.json`, and records
the hash of every eligible file, so a scan selects the files that changed since
the last pass. The pass reads every selected file against the complete style
handbook, whether or not the scanner reports an issue in it.
`CODE-STYLE-VALIDATE-001` reports the handbook rules a scanner can decide:
unbraced bodies, a missing blank line before an independent block, a local
declaration group larger than four, a `switch` without `default`, and the
lexical restrictions such as `any`, `!`, `var`, default exports, `function`
expressions, and `@ts-ignore`. Rules that need the reader's judgment, such as
just-in-time declarations, stay with the agent. `npm run lint`, or the formatter
the target declares, stays authoritative for mechanical style, and the scanner
does not repeat a rule the formatter owns. A construct the handbook lets a
documented exception satisfy carries `// style: allow <code> <reason>` on the
line above it; the reason is mandatory.

Both commands accept `--since <ref>` or `--all`, and `/pan-style` also accepts
`--worktree <name>`. Without a checkpoint the bare scan inspects the complete
eligible set. `checkpoint` always inspects the complete set, returns `blocked`
without writing while an editable file still has issues, and writes the
checkpoint once the set is clean. Both subcommands exit `1` on a non-passing
status.

## Write a standalone PR description

Use `/pan-write-pr` after the current branch and worktree are ready for review but a full ship-stage rerun is unnecessary. The command defaults to `main`; pass one alternative base ref such as `/pan-write-pr v2` when needed. It resolves the merge base, includes committed branch changes plus staged, unstaged, and relevant untracked worktree changes, and writes the result under `runtime/pr-descriptions/` (`.pancreator/runtime/pr-descriptions/` when embedded).

The command is read-only apart from its generated Markdown artifact. It does not create, update, or merge a pull request and stops when the base is invalid, the comparison is ambiguous, or there is no delta to describe.

## Research a subject

Use `/pan-research <request>` when you want a sourced document about an external product, technology, or question rather than a change to the repository. Write the request in prose: name the subject, the document type, the dimensions to cover, and any business context as links, paths, or inline text. For example:

```text
/pan-research Research FullStory and produce a solution assessment evaluating its fit for user session analysis and general product telemetry. Dimensions: capabilities, implementation, pricing, privacy & security, risks. Business context: docs/telemetry-brief.md
```

The session runs the `research` governance card, reads `library/personas/researcher.md` and `library/skills/research.md`, reads every context reference before the first search, and then finds and reads sources with the session's web search and fetch tools. It writes one Markdown document under `runtime/research/` (`.pancreator/runtime/research/` when embedded) named `<UTC timestamp>-<document-type>-<subject>.md`. The document leads with a summary that states the verdict, the business relevance, the confidence, and the next action, and it sources every factual statement to a URL or path the session read.

The skill defines five document types: `solution assessment`, `comparison`, `technical brief`, `feasibility study`, and `research memo`. A request that names none gets a research memo. A request that names no dimensions gets the default dimension set of its type.

The session writes no other file, starts no run, and never answers from memory when a search tool is available. When the session has no web search tool it stops and reports the gap. The Simplified Technical English check on the finished document is advisory, and the session repairs the countable issues it reports before it finishes. Research documents are part of the `/pan-conform` editable set, so a later conform pass repairs their prose too. `pan archive` never retires them.

## Prepare release metadata manually

Use `/pan-release` when release metadata must be prepared or regenerated outside a workflow ship stage. The command is self-development-only and refuses to version an embedded target repository. It resolves the commit that introduced the committed `VERSION`, evaluates all committed, staged, unstaged, and relevant untracked changes after that baseline, and asks the release steward to choose exactly `major`, `minor`, or `patch`.

The release steward then authors or regenerates the latest Common Changelog entry and synchronizes `VERSION`, `package.json`, `package-lock.json`, the README current-version references, and the current-version statement in `docs/embedded-installation.md`. If a dirty release candidate already exists, the command updates it in place rather than bumping again. If there is no post-bump delta and no candidate, it makes no changes.

`/pan-release` validates formatting, types, and repository contracts but does not edit `release/index.json`, commit, push, publish, or deploy.

`release sync` and `release continue` stage only committable paths: a path a `read-only-input` attribution covers is left out of the checkpoint and the continuation, and both results name it under `withheld_paths`. `release finalize` neither stages such a path nor refuses the release over it, so a recorded input in the release worktree is not a non-metadata change. A tracked modification still blocks finalization whatever a record says.

## Release approval

The ship packet is a proposal, but Pancreator self-development release metadata
has already been updated by the release steward. Before approval, confirm:

- review and QA passed against the current workspace, or any exceptions are
  covered by explicit operator waiver directives
- deferred acceptance criteria and any follow-up obligations required by the operator's waiver terms are disclosed
- residual risks are acceptable
- rollback guidance is credible
- the proposed commit/PR text accurately describes the diff
- the selected version bump and generated release notes match the complete
  delta since the last committed release bump

Approval marks the workflow succeeded. It does not itself create a commit, PR, merge, or deployment.

Agents commit and merge on a branch that lands on `pan-dev`. In the Pancreator
repository itself nothing lands on `pan-dev` without a proper version: a change
to any installable harness input reaches `pan-dev` only inside a release, so the
branch carries the release commit and the `release/index.json` commit for a new
`VERSION` before it merges, and no installable change after that release
commit. `bin/check-landing` enforces this from the `pre-commit` and
`pre-merge-commit` hooks under `.githooks/` (`npm run prepare` sets
`core.hooksPath`; `npm ci` runs it), refusing a direct installable commit on
`pan-dev` or `main` and a merge whose source has no release. The installer
applies the same test to a clean checkout. Landing work on `main` is your promotion step: merge or fast-forward `pan-dev` into `main` yourself, then push. `./bin/install` creates a missing `pan-dev` from the target's HEAD on a fresh install or refresh, so a target normally carries the branch before its first run; `pan doctor` reports when it does not.

### Rejecting a release packet

Rejection routes remediation to the stage that owns the fix and carries your feedback forward to that stage's worker as a required input.

- `./bin/pan decide <run-id> reject --note "<what is wrong>"` sends the run back to implementation by default, then naturally re-runs review, QA, and ship.
- `./bin/pan decide <run-id> reject --stage plan --note "<what is wrong>"` sends it back to planning when the defect is architectural rather than a coding error.
- `--stage <slug>` may target any stage in the workflow. The chosen stage and every stage after it restart with fresh attempt budgets, since you are deliberately reworking that segment.

Always include a `--note`. The feedback is written to `agent/decisions/operator-feedback-<n>.md` (`decisions/` in a legacy-layout run) and attached to the remediation invocation; without it the worker only knows the prior output was unacceptable.

### The note size bound and `--note-file`

Endpoint security on an operator machine kills a process at exec time once one argv element reaches 1000 bytes. The kill lands before Node starts, so the command prints nothing and the run is unchanged, which reads as success.

The CLI therefore refuses any argument at or above 900 bytes with `ARGV_ELEMENT_TOO_LARGE`, naming the option and the byte count, before it dispatches the command.

Use `--note-file <path>` for a note above that bound. `decide`, `pause`, `resume`, `set-stage`, and `waive-gate` all accept it, the path is repository-relative, and the file's contents become the note. `--note` and `--note-file` cannot be used together.

```sh
./bin/pan decide <run-id> revise --note-file runtime/inbox/queue/revision-directive.md
```

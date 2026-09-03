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
      "allowed_actions": ["approve", "reject", "revise", "resume", "set-stage"],
      "max_decisions_per_run": 3,
      "max_remediation_attempts_per_agent": 2
    }
  }
}
```

Each new run snapshots the resolved block and its digest. Existing runs without
that snapshot remain disabled. Guardrails can narrow safe actions but cannot
permit source control, publication, deployment, branch deletion, or gate
waivers. A guarded `approve` action can apply a recorded ship-stage outcome and
its workflow transition. It cannot perform an external release action.

Inspect and evaluate one named blocker:

```sh
./bin/pan away status <run-id>
./bin/pan away evaluate <run-id>
./bin/pan away apply <run-id> --decision <decision-id>
```

The evaluator ranks bounded options without tools. Pan validates the selected
action and its rollback plan before apply. Each evaluation and apply result
appends to `runtime/logs/away-mode/decisions.jsonl`; no command rewrites prior
records. Use the selected record's `rollback_plan` for manual reversal, then
append a linked record through the same decision service.

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
./bin/pan watch <run-id> [--invocation <invocation-id>] [--cadence-seconds <n>] [--stall-wakes <n>] [--timeout-seconds <n>] [--mark-background] [--json]
```

The command resolves the run's pending invocation, sleeps one cadence, and
inspects the invocation's output path, delegation artifact, and evidence
files. It appends one JSONL line per arming and per wake to
`agent/evidence/<invocation-id>-watch.jsonl`, with the wall-clock time, the
invocation watched, and the observed state. That file is the `DELEGATE-001`
arming and wake record, written by the harness. The default cadence is 120
seconds. Pass `--cadence-seconds 300` for work expected to exceed 15 minutes.
Fractional seconds are accepted.

Exit codes: `0` and `{"state":"completed"}` when the output is present and
names the invocation. `2` and `stalled` after `--stall-wakes` (default 2)
consecutive wakes with no change. `3` and `timed_out` at `--timeout-seconds`.
The command is safe to await in the foreground and safe to re-run. It returns
`completed` at once when the output already exists. Wake lines print to
stderr only on an interactive terminal.

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
defaults to the modification time of the delegation artifact the supervisor
persisted immediately before the launch; `--launched-at` overrides it with a
time the supervisor recorded itself. `--foreground-returned` and
`--mark-background` are exclusive.

`pan submit` requires one of the two records for every Cursor worker
invocation: a watch record that ends in a completed wake, or the
foreground-return attestation. A submission with neither fails with the hard
error `DELEGATION_UNOBSERVED` before any validator or gate runs and consumes
no stage attempt; the supervisor records the missing observation and submits
again. External-executor stages that `pan delegate` runs are exempt because
the harness writes their delegation evidence. The stage record carries the
observation as `delegation_observation`, naming which record proved the
worker reached a terminal state.

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
the workflow without a commit, push, merge, publication, deployment, or branch
deletion.

After the run reaches a terminal state, the QA agent investigates each flagged
issue. It separates a verified root-cause repair from a retry, workaround,
configuration patch, rollback, reconciliation, or containment action. It puts
one implementation-ready remediation intake in `runtime/inbox/` when an issue
does not have a verified root-cause repair.

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

The decomposer also compares reduced implementation, review, and remediation risk against the repeated intake, planning, review, QA, release, and coordination cost of additional runs. Marginal cases remain intact. Valid decompositions normally contain two to four dependency-ordered chunks, preserve requirement traceability, and write a validated packet under `runtime/inbox/` whose chunks can be passed directly to `/pan-start`.

## Choose a work mode

Use `systematic` by default. `/pan-start` executes the governed `delivery`
workflow: consolidated planning, implementation, joint verification with
parallel review and QA evidence workers, verdict-routed remediation, and
release preparation.

Use `/pan-debug <problem>` when the cause or remediation scope is unclear. The
investigator does not modify source; it returns root cause, proposed remediation,
numbered acceptance criteria, and a `lightweight` or `systematic` recommendation.

Use `/pan-repair <problem-or-artifact>` when the suspected defect is in
Pancreator itself or when a workflow run needs a harness-level audit. The harness
technician accepts prose, a file, or a run directory; reconstructs run behavior
from state, events, snapshots, invocations, outputs, assessments, validations,
and artifacts; and augments those records with the relevant agent transcripts.
Delegation prompts are treated as prompt-delivery evidence rather than as
transcripts. The command writes a validated `harness-repair-*.md` intake under
`runtime/inbox/` that can be passed directly to `/pan-start` in the Pancreator
self-development checkout. It does not modify the investigated run or implement
the repair.

Use `/pan-spotfix <request>` only when the operator deliberately selects
lightweight execution and the request satisfies `WORK-001`: one coherent change,
no unresolved structural decision, no more than three core implementation files
in one bounded subsystem, and existing checks that can prove correctness. The
spotfixer performs at most three implementation-validation cycles. Failure or
scope expansion creates `runtime/inbox/spotfix-escalation-*.md` for systematic
routing. Do not run it while a mutating workflow agent is active in the same
workspace.

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

Two things the session settles before it delegates. It binds the workspace to
the target's head, resolving a worktree when your checkout sits elsewhere, so
the agents verify findings against the tree the diff applies to rather than
whatever you happen to have open. And it runs
`pan governance review-scope --target <ref>`, which reports every conflict of
interest the target carries, by tier. **Instrument** paths — the lineup, a
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
./bin/pan init --workflow prototype --request runtime/inbox/<spike-request>.md
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
./bin/pan init --request runtime/inbox/<request>.md --involvement technical-director
```

Shipped profiles:

- `standard` — workflow-declared gates. You ratify the plan and approve release.
- `hands-off` — the supervisor ratifies the plan instead of you; release still
  stops for your explicit approval.
- `technical-director` — you refine the technical plan with its author before
  implementation and respond to the independent review before the run continues.
- `high-touch` — every stage stops for your explicit approval.

`init` reports the resolved profile, active contracts, and any gate that replaced
a workflow default, so you know where the run will stop before it starts. The run
snapshots that resolution, so editing `config.json` afterwards never changes a
run in flight.

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
large blast radius. A retry that changed only claims or evidence runs no suite. The consolidating
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

## Run the design workflow before non-trivial UI/UX delivery work

For any development task with a non-trivial UI/UX design component, run the
standalone `design` workflow first, ratify its handoff package, then start a
separate corresponding `delivery` run whose request references that package.

```sh
./bin/pan init --workflow design --request runtime/inbox/<design-request>.md
```

After intake → design → design review → design QA → handoff succeed and you
approve handoff, the design package lists stable paths for the design spec, HTML
mocks index, and acceptance criteria. Start `delivery` with a request that cites
those paths so planning preserves the design acceptance criteria:

```sh
./bin/pan init --request runtime/inbox/<request-referencing-design-package>.md
```

Composition is deliberately separate runs (not an automatic gate inside
`delivery`).
The first live design run after enabling this capability is an operator checklist
item, not an in-workflow nested run.

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

Run `./bin/pan models` without `--sync` to preview the active mapping and any drift without changing files.

Per-checkout preferences belong in `config_overrides.json` next to `config.json` (the legacy name `config.local.json` still reads until you rename it). The file is untracked (keep it out of version control, e.g. via `.gitignore` or `.git/info/exclude`) and merges over `config.json`: objects merge recursively, any other value replaces the checked-in one. Use it for `active_config`, persona model overrides, or an `operator_involvement.active` selection, so `config.json` stays at the recommended defaults releases update. A local preference behaves exactly as if it were edited into `config.json`, including drift detection against in-flight runs. An empty string in a named config's `personas` inherits the `defaults` entry for that persona, so `config_overrides.json` needs to name only the personas a config changes. An empty string in `defaults` is rejected.

Each new run snapshots the active configuration in `runtime/logs/workflows/<run-id>/agent/pipeline-config.snapshot.json`. Invocation cards resolve their model from that snapshot. Because Cursor executes the model declared in `.cursor/agents/pan-<persona>.md`, preparing an older run after switching configurations is blocked until the projected agent models again match that run's snapshot. This prevents the card from claiming one model while Cursor launches another.

## Route a persona to the Claude Code CLI

A persona mapping may name its executor with a prefix from a closed set — `cursor` (the default) or `claude-code`:

```json
"personas": {
  "planner": "claude-code:claude-opus-5[permission-mode=default,session-resume=true]",
  "reviewer": "claude-code:claude-opus-5[permission-mode=default,session-resume=true]",
  "coder": "claude-opus-5[context=300k,effort=high]"
}
```

A `claude-code` persona is executed by the operator-installed Claude Code CLI instead of a Cursor subagent, so the same model can author a stage under the Claude Code harness while Pancreator's run state, gates, and operator contracts stay authoritative. Any stage may be routed this way, including mutating ones; non-mutating stages run with file-write tools restricted to the harness runtime tree, and `scope.no_unapproved_changes` remains the gate of record either way. The `orchestrator` persona is the exception — it is the supervisor itself and must stay on `cursor`.

Supported bracket options for `claude-code` mappings: `permission-mode` (`default`, `acceptEdits`, `plan`, `bypassPermissions`), `session-resume` (`true`/`false`, default `true`), and `timeout-ms`. Cursor mappings keep their existing opaque options.

Requirements and behavior:

- The `claude` CLI must be installed and authenticated on each machine that runs delegations (set `PANCREATOR_CLAUDE_BIN` if the binary is not on `PATH`). `./bin/pan doctor` reports availability when the active mapping uses `claude-code`.
- Run creation verifies the binary; the first delegation of a run verifies credentials. A failed preflight pauses the run with an operator decision — it is an operator-visible stop, not an error to work around, and the harness never silently substitutes Cursor.
- When a run reaches an external stage, the supervisor runs `./bin/pan delegate <run-id>` instead of invoking a subagent. The harness delivers the canonical card, writes the delegation evidence itself, and records the executor session.
- `./bin/pan decide <run-id> revise --note "<directive>"` on an external stage resumes the author's recorded session with your directive, so refinement rounds keep full context. Retries after failures always start fresh.
- `./bin/pan models --sync` skips projecting external personas into `.cursor/` and removes a stale projected agent when a persona moves to an external executor.

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
- `--worktree <name>` is one shared option with one contract: every workspace-aware command accepts it, resolves the name the same way, and creates the worktree when the index does not hold it. The workspace-aware commands are `init`, `prepare`, `resume`, `submit`, `author apply`, `author validate`, `release sync`, `release continue`, `release finalize`, `repository-check <profile>`, `technologies detect`, `doctor`, and `governance card --mode <mode>`. Every other command rejects `--worktree` with an explicit error naming this list. The branch of the main checkout never changes.
- `worktree resolve <name>` applies the same create-or-resolve behavior directly and reports the worktree record with a `created` flag. Projected commands that delegate a named persona bind their workspace through it. `/pan-start` passes the selected worktree to `init` and every later lifecycle call. `/pan-resume` reads the stored binding and passes the same name to `resume`, `prepare`, and `submit`.
- `init --worktree <name>` records the worktree directory as the run's `workspace_root`. Each lifecycle call restores the registered branch before mutation. The run's repository-check baselines and deterministic gates then run inside the worktree. `--worktree` and `--workspace` name two different workspaces, so pass only one.
- `pan repository-check <profile> --workspace <name>` also accepts a recorded worktree name or a directory path; unlike `--worktree`, it never creates anything.
- `remove <name>` refuses a worktree with uncommitted work unless you pass `--force`, and always keeps the branch, because deleting a branch stays your decision. When you already deleted the directory yourself, `remove` prunes the stale Git registration and the index entry.

Best-of-N candidate worktrees are separate. They live under `worktrees/<bon-id>/` and remain owned by `./bin/pan best-of-n`, so `pan worktree` neither lists nor removes them. Existing sessions may still reference legacy paths under `runtime/worktrees/<bon-id>/`; those paths remain authoritative until the operator removes the session.

### Reconciling worktrees

```sh
./bin/pan worktree reconcile --into trunk --source feature-login --source feature-billing
./bin/pan worktree reconcile --into-branch main --source feature-login --source feature-billing
```

`reconcile` merges two or more recorded source worktrees, one at a time and in the order you list them, with `git merge --no-ff`. The target is either a recorded worktree (`--into`) or an existing local branch (`--into-branch`). A branch no checkout holds is checked out into a new recorded worktree first, because Git can only merge inside a working tree. A branch a checkout already holds — including `main` in the main checkout, as above — merges inside that checkout, which must be clean; a dirty holding checkout is refused before any merge. Every reconcile appends its operator invocation and outcome to `runtime/logs/worktrees/reconcile.jsonl`.

A merge commit is an irreversible source-control action under `ACTION-001`, so an agent must hold a recorded operator directive before it runs `pan worktree reconcile`.

On conflict the command stops at the first conflicting source and exits non-zero, and a conflict request is written to `runtime/inbox/` naming the target, the completed sources, the conflicted paths, and the sources not started. In a recorded worktree target the merge state stays in place; direct an agent at that request to resolve the conflict, and do not commit the result without explicit operator approval. In a held checkout the conflicted merge is aborted instead, so your working tree comes back untouched; completed source merges remain on the branch, and the request explains how to finish through a worktree.

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

## Plan once, then deliver in cohorts

The `planning` workflow holds the planning work on its own. It runs one `plan` stage behind one operator gate, and it ends when you ratify the artifact.

```sh
./bin/pan init --request runtime/inbox/queue/request.md --workflow planning
```

The ratified artifact is a specification hierarchy rather than a single document. The **parent specification** carries the complete record of the request. One **child specification** per chunk carries the work a single delivery run owns, and reaches the parent through an audited reference — the parent path, the content digest, and the read trigger — instead of a copy of the parent body. A child specification governs its own chunk; the parent governs anything that spans chunks.

The artifact also records a **cohort plan**: the chunks, the dependency edges between them, and the cohorts those chunks are grouped into. Cohorts are numbered from 1 and run in order. No chunk depends on another chunk of its own cohort, so every chunk of one cohort can run at the same time, and every dependency points into an earlier cohort. A single chunk is an ordinary outcome; the plan then records why the work stays serial.

Two pre-submit validators check the artifact before you ever see it. One rejects a cohort plan whose graph contains a cycle, an edge inside one cohort, or a dependency on the same or a later cohort. The other rejects child specifications that pasted the parent body, that reference the parent without an audited reference, or that do not trace each originating requirement, constraint, exclusion, and open question exactly once. An item several chunks legitimately carry is traced once as shared: the cohort plan lists it in `shared_items`, and every chunk that carries it names it. It also rejects a constraint, exclusion, or open question that opens with no identifier, because nothing could trace it.

### Running the fan-out

```sh
./bin/pan cohort init --plan-run <plan-run-id>
./bin/pan cohort start <cohort-id>
./bin/pan cohort status <cohort-id>
./bin/pan cohort integrate <cohort-id>
```

- `cohort init` reads the ratified cohort plan from the planning run and opens a durable cohort session under `runtime/logs/cohorts/<cohort-id>/`. The session is the authority on the fan-out, so it survives the session that created it and `status` reads it back with no in-memory state.
- `cohort start` starts the earliest unsatisfied cohort. It creates one worktree and one delivery run per chunk of that cohort, so no two concurrent chunk runs share a workspace root. Each chunk run receives its child specification as the request and the parent specification as a context reference. Continue each chunk with the `/pan-resume <run-id>` command `status` prints; chunk runs use the ordinary resume path and get their models from the ordinary top-level launch. Pass `--cohort <index>` to name a cohort explicitly; naming one whose predecessor is unsatisfied is refused with `COHORT_PREDECESSOR_UNSATISFIED`, and the message names the cohort that blocks it.
- `cohort status` reports each chunk with its run status, current stage, and resume command, which cohorts are satisfied, which cohort is active, and which cohort is blocked behind it.
- `cohort integrate` merges the committed chunk branches of the active cohort into the cohort base branch and writes the satisfaction entry. That entry is the only signal that unblocks the next cohort. A chunk run that has not succeeded, a dirty chunk worktree, or a merge conflict leaves the entry unwritten and the next cohort blocked, rather than letting later work branch from changes that never landed. A merge commit is an irreversible source-control action under `ACTION-001`, so an agent must hold a recorded operator directive before it runs this command.
- The chunk branches merge one after another, so a conflict on a later chunk leaves the earlier merges on the base branch. The harness does not undo them, because rewriting your branch is your decision. The error names the chunk that conflicted, the chunks that already landed, and the base commit before integration began, and it writes the same facts to `runtime/logs/cohorts/<cohort-id>/integration-<index>-incomplete.json`. The conflicted merge itself is aborted, so the checkout that holds the base branch is left clean. Resolve the divergence on the chunk branch, then integrate again; the chunks that already landed merge as no-ops.
- `cohort abandon <cohort-id> --chunk <id> --note "<why>"` excludes one chunk from its cohort. The note is required, because dropping a chunk is your decision and the record has to say why. An abandoned chunk is never started by a later `cohort start`. When every chunk of a cohort is abandoned, `cohort integrate` has nothing to merge, so it records the satisfaction entry against the current base head and lists the abandoned chunks in the integration record, and the next cohort can start.
- `cohort clean <cohort-id>` removes the chunk worktrees and keeps every branch. Every chunk is checked first, so a live run or uncommitted work in any chunk refuses the whole command and removes nothing unless you pass `--force`. The response lists the worktrees it removed.

Satisfaction is never a field an agent fills in. It is computed from two independent durable facts: each chunk run's own state reports `succeeded`, and `cohort integrate` recorded the merge. Starting or preparing a run whose predecessor cohort is unsatisfied fails with `COHORT_PREDECESSOR_UNSATISFIED`, and the same refusal is recomputed on every call, so advancing a chunk run directly does not get around it.

### Starting cohort 1 automatically

```sh
./bin/pan init --request runtime/inbox/queue/request.md --workflow planning --autostart
```

`--autostart` is recorded on the run and applies only to the `planning` workflow; any other workflow rejects it. When you then approve the ratified planning gate, the harness opens the cohort session and starts cohort 1 for you. Approving without the flag starts nothing. The hook runs after your decision is already recorded and never rewrites it, so a failed fan-out leaves the approval and the ratified plan intact and reports the two commands to run by hand. The `decide` response carries an `autostart` object: `started` lists each chunk run and its `/pan-resume` command, `already_started` reports the same chunk runs when the session this run opened already has them, and `failed` carries the error and the manual commands.

### Migrating a run already in flight

The `planning` workflow and the `pan cohort` lifecycle are additive. A `delivery` run that was created before they existed keeps its own snapshotted workflow, including its `plan` stage, and finishes on that snapshot; nothing about it changes and no command needs to be rerun. To move in-flight planning work onto the cohort lifecycle, let the current run reach its plan gate and ratify it, then start a new `planning` run from the same request. The new run writes the parent and child specifications and the cohort plan; `cohort init` reads only a ratified `planning` run, so it does not read the plan stage of an older `delivery` run.

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
  [--defer <acceptance-id[,acceptance-id...]> --spotfix]
```

The command may target current or historical workflow stages, including harness-owned stages, and may redirect a terminal run when the operator explicitly names the source and destination. Destinations may be workflow stages or terminal states such as `succeeded`. It does not require a pause, exact criterion matching, valid stage output, or an unchanged workspace. The note defines the directive; criteria and follow-up tracking are optional metadata. The harness records what was bypassed and where the run was routed without narrowing the directive.

“Operator-owned” means only the operator may decide to waive. An agent may execute the command when the operator explicitly directs it and must not answer that the operator is “not allowed” or that a waiver is impossible because of harness governance.

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

For a systematic implementation run, Pancreator executes the configured
implementation profiles immediately before the first coder invocation and stores
the results as run-scoped baseline evidence. Existing lint or unit-test failures
remain visible, and the coder must repair them when the fix is bounded and low-risk,
but an unchanged baseline failure does not block advancement when remediation would
be broad, structural, or unrelated to the approved change. New or changed diagnostics
do block. This prevents unrelated repository debt from consuming repeated stage
attempts without allowing the implementation to introduce additional failures.

A deterministic shell gate whose exact command already passed cleanly at the
same Git workspace fingerprint and repository-check configuration within the
last 24 hours is accepted from `runtime/cache/gate-results.json` instead of
re-executing (`DEV-001`). The result is marked `cached`, its evidence log carries
the original captured output, and the acceptance never bypasses baseline
resolution: a run whose baseline is missing still fails that gate closed.
Failures, timeouts, skips, overrides, and baseline-relative passes are never
cached, and a non-Git workspace is never cached. `./bin/pan doctor` reports the
cache state. Set `PAN_GATE_CACHE=0` to force every gate to execute, or delete
the cache file to forget every recorded pass.

The review stage is source-allowed specifically for bounded remediation. The
reviewer fixes local, low-risk issues when intended behavior is unambiguous and
records the changed files and evidence. Architecture, public-interface, data or
persistence model, security-boundary, dependency, migration, requirement, or
broad cross-component changes return to implementation.

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

## Write a standalone PR description

Use `/pan-write-pr` after the current branch and worktree are ready for review but a full ship-stage rerun is unnecessary. The command defaults to `main`; pass one alternative base ref such as `/pan-write-pr v2` when needed. It resolves the merge base, includes committed branch changes plus staged, unstaged, and relevant untracked worktree changes, and writes the result under `runtime/pr-descriptions/` (`.pancreator/runtime/pr-descriptions/` when embedded).

The command is read-only apart from its generated Markdown artifact. It does not create, update, or merge a pull request and stops when the base is invalid, the comparison is ambiguous, or there is no delta to describe.

## Prepare release metadata manually

Use `/pan-release` when release metadata must be prepared or regenerated outside a workflow ship stage. The command is self-development-only and refuses to version an embedded target repository. It resolves the commit that introduced the committed `VERSION`, evaluates all committed, staged, unstaged, and relevant untracked changes after that baseline, and asks the release steward to choose exactly `major`, `minor`, or `patch`.

The release steward then authors or regenerates the latest Common Changelog entry and synchronizes `VERSION`, `package.json`, `package-lock.json`, the README current-version references, and the current-version statement in `docs/embedded-installation.md`. If a dirty release candidate already exists, the command updates it in place rather than bumping again. If there is no post-bump delta and no candidate, it makes no changes.

`/pan-release` validates formatting, types, and repository contracts but does not edit `release/index.json`, commit, push, publish, or deploy.

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

### Rejecting a release packet

Rejection routes remediation to the stage that owns the fix and carries your feedback forward to that stage's worker as a required input.

- `./bin/pan decide <run-id> reject --note "<what is wrong>"` sends the run back to implementation by default, then naturally re-runs review, QA, and ship.
- `./bin/pan decide <run-id> reject --stage plan --note "<what is wrong>"` sends it back to planning when the defect is architectural rather than a coding error.
- `--stage <slug>` may target any stage in the workflow. The chosen stage and every stage after it restart with fresh attempt budgets, since you are deliberately reworking that segment.

Always include a `--note`. The feedback is written to `agent/decisions/operator-feedback-<n>.md` (`decisions/` in a legacy-layout run) and attached to the remediation invocation; without it the worker only knows the prior output was unacceptable.

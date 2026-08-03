# Operator guide

## The normal interaction

Use `/pan-start` for a new request and `/pan-resume <run-id> [prompt]` thereafter.
Both commands deliver the run to the `pan-orchestrator` subagent, which is the
supervisor: `/pan-start` sends a start invocation built from your preserved
request, and `/pan-resume` sends a resume invocation carrying the run id and
your optional prompt. The command relays the supervisor's reports and your
decisions. Each report should always show:

1. current run and stage
2. what completed or failed
3. where the evidence lives
4. what decision or action is required next

Raw JSONL and shell output are diagnostic surfaces, not the default conversation.

Use `/pan-summarize-context` before moving work into a fresh Cursor conversation.
It emits one copyable Markdown block containing the current goal, material
conversation history, decisions, completed work, validation, open issues, and
next actions without modifying repository state.

Run `./bin/pan archive` to migrate recognized legacy workflow names and move
workflow directories older than seven days into `archive/` under both runtime
workflow roots. The command updates persisted path references and is idempotent;
it never overwrites an existing archive target.

### Supervisor continuation

`ORCH-001` is the normative continuation policy. In practice, keep advancing
supervisor-owned `pending_action` values and stop only when an operator-owned
decision is still missing or the run is terminal. When the active operator request
already supplies the decision, execute it instead of asking again.

## Invocation and delegation validation

`INVOCATION-001` is the normative invocation-card and delegation policy. Each
prepared invocation writes
`invocations/<invocation-id>.invocation-validation.json`. If prepare fails,
read that artifact for the failing checks before retrying.

When `pending_action` is `invoke_agent`, deliver the canonical invocation card
according to the **Supervisor delivery procedure** section at the end of that
card, which unrolls `INVOCATION-001` with resolved paths, and persist its
delegation audit artifact. Before
`./bin/pan submit`, confirm delegation validation passed. Rejection with
`DELEGATION_ARTIFACT_MISSING` or `DELEGATION_VALIDATION_FAILED` leaves the run
on the same invocation so delivery can be corrected and resubmitted.

`./bin/pan status` includes a dedicated validation section with invocation and
delegation validation state, artifact paths, and short failure reasons.

Applicable durable handbooks and static skills are resolved through policy
`guidance_sources` and embedded directly in the invocation card. Language-specific
policies MAY also be selected from detected target-workspace technology signals;
for example, Python source or packaging markers activate `PY-001` for implementation,
review, QA, and spotfix work without imposing Python guidance on unrelated targets. A worker MUST
receive that unrolled guidance with the canonical card; a source-file path is
not a substitute for delivering the content.

## Build the target repository primer

Run `/pan-build-docs` after installation, after major architectural or administrative changes, or when the existing primer is materially stale. The command creates the primer when absent and regenerates it when present. The librarian inventories target-owned documentation, incorporates useful verified details into the appropriate sections, and reconciles those claims against representative code, setup/build/install/test scripts, manifests, and bounded Git history before writing the validated primer to `docs/target-repo-primer.md` (`.pancreator/docs/target-repo-primer.md` when embedded).

Every agent reads this primer before expanding repository context. It is a navigation aid rather than an instruction to preload all referenced files: agents may follow a primer path only when the active task creates a concrete need for that file.

## Build the operator brief system

Run `/pan-build-briefs` after installation and whenever recurring operator-facing use cases or project visual conventions materially change. The command scaffolds missing files, then asks the librarian to derive a minimal target-specific ontology and design-token layer from bounded repository evidence. It writes `docs/operator-briefs/project.json` and `docs/operator-briefs/project.css` (`.pancreator/docs/operator-briefs/` when embedded) and validates collisions and emoji consistency.

Use `pan briefs build --force` only when deliberately resetting the project layer to templates before regeneration. Existing historical Markdown artifacts are not migrated. Every newly prepared workflow stage declares exact brief JSON and HTML paths in its invocation card; workers must use those paths, and submission rerenders and validates the HTML automatically.

## Assess unusually large intake

Use `/pan-decompose <intake spec>` before starting a workflow when the request may contain multiple independently valuable outcomes or prerequisite decisions. `DECOMP-001` is intentionally conservative: the decomposer defaults to one larger run, requires every proposed chunk to be independently testable and safely completable, and then requires either a hard decomposition trigger or broad complexity pressure across several dimensions. File count, frontend/backend boundaries, tests, documentation, and implementation phases are not valid split boundaries by themselves.

The decomposer also compares reduced implementation, review, and remediation risk against the repeated intake, planning, review, QA, release, and coordination cost of additional runs. Marginal cases remain intact. Valid decompositions normally contain two to four dependency-ordered chunks, preserve requirement traceability, and write a validated packet under `runtime/inbox/` whose chunks can be passed directly to `/pan-start`.

## Choose a work mode

Use `systematic` by default. `/pan-start` executes the governed `dev` workflow
with planning, implementation, independent review, QA, and release preparation.

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

It runs intake → approach → build → evaluate. Compared with `dev` it:

- frames technical questions and observable success signals instead of user
  stories and acceptance criteria,
- keeps the approach stage thin and ungated rather than producing an
  implementation-ready plan behind a supervisor gate,
- gates only the `static` repository-check profile and reports `fast` as
  advisory, so a spike is not blocked on production test coverage,
- expects deliberate shortcuts and requires each one declared with the reason it
  was acceptable,
- ends with an operator-ratified evaluation giving a `validated`,
  `invalidated`, or `inconclusive` verdict, the productionization gap, and a
  recommendation.

`PROTO-001` prohibits representing a spike as production-ready. When you adopt an
approach, start a separate systematic `dev` run scoped from the evaluation's
productionization gap; the prototype run does not productionize its own output.

An `invalidated` verdict is a successful prototype. The evaluation names the
spike code to delete either way.

## Set how heavily you gate a run

`config.json.operator_involvement` declares named involvement profiles. List
them with:

```sh
./bin/pan involvement
```

Select one per run:

```sh
./bin/pan init --workflow dev --request runtime/inbox/<request>.md --involvement technical-director
```

Shipped profiles:

- `standard` — workflow-declared gates. You ratify intake and approve release.
- `hands-off` — the supervisor ratifies intake instead of you; release still
  stops for your explicit approval.
- `technical-director` — you refine the technical plan with its author before
  implementation and respond to the independent review before the run continues.
- `high-touch` — every stage stops for your explicit approval.

`init` reports the resolved profile, active contracts, and any gate that replaced
a workflow default, so you know where the run will stop before it starts. The run
snapshots that resolution, so editing `config.json` afterwards never changes a
run in flight.

`ship` cannot be relaxed by a profile: `SHIP-001` requires a pause before commit,
push, merge, publication, or deployment. You keep every in-the-moment override
under `OPERATOR-001`.

## Choose how review works

`config.json.review_mode` selects how the independent review stage gathers its
findings. Two values:

- `default` — one reviewer reads the whole change.
- `squad` — the reviewer delegates one agent per review dimension
  (correctness, security, architecture, simplification, operations, plus
  conditional dimensions such as frontend), then joins the returned findings into
  one ranked set.

Set the default in `config.json`, or pick one for a single run:

```sh
./bin/pan init --workflow dev --request runtime/inbox/<request>.md --review-mode squad
```

`squad` costs more model time and returns a wider, more sharply labelled finding
set. Use it for a change whose blast radius is broad, and `default` for narrow
work. Either way the reviewer keeps the verdict and repairs the same bounded
defects, so switching modes never changes what review is allowed to do. `init`
reports the resolved mode, and the run snapshots it so a later `config.json` edit
cannot change a run in flight.

### Technical director mode

`technical-director` is a run contract, not a separate workflow — any workflow
run abides by it when active. It attaches to stage _roles_ rather than slugs, so
it escalates `dev/plan` and `prototype/approach` (the `technical_plan`
checkpoint) and `dev/review` and `design/review` (the `independent_review`
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

## Run the design workflow before non-trivial UI/UX `dev` work

For any development task with a non-trivial UI/UX design component, run the
standalone `design` workflow first, ratify its handoff package, then start a
separate corresponding `dev` run whose request references that package.

```sh
./bin/pan init --workflow design --request runtime/inbox/<design-request>.md
```

After intake → design → design review → design QA → handoff succeed and you
approve handoff, the design package lists stable paths for the design spec, HTML
mocks index, and acceptance criteria. Start `dev` with a request that cites those
paths so intake preserves the design acceptance criteria:

```sh
./bin/pan init --workflow dev --request runtime/inbox/<dev-request-referencing-design-package>.md
```

Composition is deliberately separate runs (not an automatic gate inside `dev`).
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

Per-checkout preferences belong in `config.local.json` next to `config.json`. The file is untracked (keep it out of version control, e.g. via `.git/info/exclude`) and merges over `config.json`: objects merge recursively, any other value replaces the checked-in one. Use it for `active_config`, persona model overrides, or an `operator_involvement.active` selection, so `config.json` stays at the recommended defaults releases update. A local preference behaves exactly as if it were edited into `config.json`, including drift detection against in-flight runs.

Each new run snapshots the active configuration in `runtime/logs/workflows/<run-id>/pipeline-config.snapshot.json`. Invocation cards resolve their model from that snapshot. Because Cursor executes the model declared in `.cursor/agents/pan-<persona>.md`, preparing an older run after switching configurations is blocked until the projected agent models again match that run's snapshot. This prevents the card from claiming one model while Cursor launches another.

## Route a persona to the Claude Code CLI

A persona mapping may name its executor with a prefix from a closed set — `cursor` (the default) or `claude-code`:

```json
"personas": {
  "tech-lead": "claude-code:claude-opus-5[permission-mode=default,session-resume=true]",
  "reviewer": "claude-code:claude-opus-5[permission-mode=default,session-resume=true]",
  "coder": "claude-opus-5[thinking=true,context=300k,effort=high]"
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

The review stage is source-allowed specifically for bounded remediation. The
reviewer fixes local, low-risk issues when intended behavior is unambiguous and
records the changed files and evidence. Architecture, public-interface, data or
persistence model, security-boundary, dependency, migration, requirement, or
broad cross-component changes return to implementation.

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

Always include a `--note`. The feedback is written to `artifacts/markdown/operator-feedback-<n>.md` and attached to the remediation invocation; without it the worker only knows the prior output was unacceptable.

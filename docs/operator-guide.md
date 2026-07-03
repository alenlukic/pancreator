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
supervisor-owned `pending_action` values and stop only when an operator-owned
decision is still missing or the run is terminal. When the active operator request
already supplies the decision, execute it instead of asking again.

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

Use `pan briefs build --force` only when deliberately resetting the project layer to templates before regeneration. Existing Markdown artifacts are not migrated. New narrative artifacts should be authored as brief JSON and rendered with `pan briefs render` to portable HTML.

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

`project.json` is the source of truth for named persona-to-model mappings. Canonical Cursor artifacts live under `library/cursor/`; `.cursor/` is ignored local output. Set `active_config` to one of the declared configurations, then regenerate the Cursor surface:

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

While paused, you MAY modify tracked files in the deliverable workspace directly. On resume, including resume with `--stage`, Pancreator compares the workspace to the pause-start snapshot. Authorized pause-only changes are recorded in a ratification artifact, the accepted workspace index and fingerprint are updated, and any prepared invocation is invalidated so it can be regenerated against the changed workspace. Changes that predated the
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

Pancreator does not use persistent workspace locks, active-workflow leases, or
per-edit ledgers. During a `source_allowed` stage, the active worker may edit
tracked source files directly within the declared scope. The harness protects
integrity with accepted indexes, workspace fingerprints, external-contamination guards and stage evidence. A non-source stage that changes tracked files must identify every changed path in top-level `workspace_changes` and use `attribution: internal` only when the active worker can trace the delta to its own actions. Fully traced internal changes pass the cleanliness gate; external or unattributed changes block.

The self-development ship stage uses `release_metadata_only`. It may change only
`CHANGELOG.md`, `VERSION`, npm version metadata, `README.md`, and
version-bearing Markdown under `docs/`. Those expected edits are validated
separately and do not invalidate the implementation fingerprint already reviewed
and tested. Embedded target ship stages remain release-metadata read-only.

Do not run concurrent mutating workflows against one workspace. Avoid other
concurrent external edits while a mutating worker is running because they make
stage attribution ambiguous. Pause the run before operator-driven changes.
Legacy `pan changes begin|commit|cancel` commands remain accepted as no-ops so
older invocation cards and operator notes do not fail after an upgrade.

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

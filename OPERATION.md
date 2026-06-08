# Pancreator operator how-to

Procedure for inbox workflow, feature delivery, the `pan` CLI, and pre-close
validation. This file is for **human operators** only. Agent operating
instructions live in `AGENTS.md` (self-host) or `.pancreator/AGENTS.md`
(embedded). Product spec and bootstrap history: `docs/` (internal; explicit-read).

## Inbox lifecycle

`lib/inbox/` is gitignored local storage for transient operator ↔ org comms.
Fresh workspaces materialize queue directories on first use (`pan init` or
`pan intake new`). Archive completed inbound items to `archive/inbox/in/` when
policy requires a durable copy.

1. Author new directives under `lib/inbox/in/<day-bucket>/<SID>_<HHMM>_<slug>.md`.
   Scaffold with:

   ```bash
   pnpm -w exec pan intake new <slug>
   ```

   When Cursor Build mode completes a plan for a net-new request without an
   existing inbox directive, scaffold the directive **after plan completion and
   before the first implementation edit** with:

   ```bash
   pnpm -w exec pan intake from-build-plan <slug> \
     --title "<human-readable title>" \
     --operator-prompt "<verbatim operator prompt>" \
     --plan-text "<completed plan markdown>"
   ```

   File equivalents when shell-escaping is awkward:

   ```bash
   pnpm -w exec pan intake from-build-plan <slug> \
     --title "<human-readable title>" \
     --prompt-file path/to/prompt.txt \
     --plan-file path/to/plan.md
   ```

   Optional frontmatter overrides: `--owner <persona>`, `--feature-id <id>`.
   When omitted, title and feature id default to `<slug>` and owner defaults to
   `intake-analyst`. The command writes
   `lib/inbox/in/<day-bucket>/<SID>_<HHMM>_<slug>.md` with
   `source_channel: cursor-build-mode` in YAML frontmatter.

2. Do **not** use `lib/inbox/notes/` for agent work; it is human-only scratch space.
   Promote drafts from notes into `lib/inbox/in/` before any agent acts on them.

3. Place delivery reports and status responses in `lib/inbox/out/` when the task
   requires human review outside the feature-delivery ledger.

4. Archive and thread semantics follow `lib/memory/handbook/inbox-lifecycle.md`.
   Runtime archive automation remains backlog-deferred; move responded items manually
   to `archive/inbox/in/` when policy requires archival.

## Feature delivery loop

The `feature-delivery` runtime is a state ledger plus prompt/artifact generator.
By default (`runner.cursor.invocation: manual` or omitted key) it tracks which
stage is active but does **not** execute stage work: the human operator delegates
each generated `next-prompt.md`, checks the resulting repo-local artifact, and
advances the ledger after acceptance.

When `runner.cursor.invocation: sdk` is set in `pancreator.yaml`, `pan run` and
`pan advance` invoke `CursorRunner` for the entering stage (mocked in unit tests;
live SDK calls remain operator-scheduled). The CLI loads repo-root `.env` before
SDK construction. Automatic stage-to-stage advancement, `review` / `test` /
`compliance` loopbacks, a cumulative retry budget of 5, and retry-limit halt
outbox artifacts apply only in SDK mode; manual mode preserves the handoff-and-paste loop unchanged.
In SDK mode the handing-off persona validates stage artifacts and the runtime
auto-advances when validation passes—human gates are not paused between stages.

### Optional design steps

When `feature_delivery.design_steps: true` in `pancreator.yaml` (default off),
or when the feature `spec.md` frontmatter sets `design_steps: true` (overrides
the repo default), the plan and test stages add companion `design-engineer`
delegation:

- **Plan:** delegate `/design-engineer` with `design-plan-prompt.md` first to
  emit `lib/memory/features/<id>/ux-spec.md`, then delegate `/tech-lead` with
  `next-prompt.md` to consolidate the ux-spec into the plan bundle.
- **Test:** delegate `/qa-tester` and `/design-engineer` in parallel (`next-prompt.md`
  and `design-qa-prompt.md`). The test gate requires both `qa_passes: true` and
  `design_qa_passes: true` before advance.

SDK mode runs these companions automatically when design steps are on.

Use this loop exactly:

1. Put the request in `lib/inbox/in/<day-bucket>/<SID>_<HHMM>_<slug>.md`.
2. Start the run (path relative to `<project_root>/lib/inbox/in/` only; for embedded
   installs with `project_root: ".pancreator"`, that is `.pancreator/lib/inbox/in/`):

   ```bash
   pnpm -w exec pan run feature-delivery <day-bucket>/<SID>_<HHMM>_<slug>.md
   # equivalent alias:
   pnpm -w exec pan feature new <day-bucket>/<SID>_<HHMM>_<slug>.md
   ```

   Example:

   ```bash
   pnpm -w exec pan run feature-delivery 172979_05-27-26/16605_1923_bootstrap-de-hacking-pass.md
   ```

   Optional flags:

   ```bash
   pnpm -w exec pan run feature-delivery <day-bucket>/<file>.md --feature <feature-id> --task <task-id>
   ```

3. Read the emitted JSON (`taskId`, `featureId`, `runDir`, `handoffFile`,
   `nextPromptFile`, `currentStage`, `nextHumanAction`).
4. Delegate `nextPromptFile` to the persona named by `currentStage`.
5. Human-check the stage artifact. If it is wrong or incomplete, do **not** run
   `advance`; send the task back to the same persona with corrections.
6. When the artifact is accepted, run the matching `pnpm -w exec pan advance`
   command from the table in § "pan CLI verbs".
7. Repeat until `currentStage` becomes `complete`.
8. At `complete`, delegate the librarian `next-prompt.md` and run
   `pnpm -w exec pan close-artifacts <task-id>` once after final validation.

`advance` runs after every accepted non-terminal stage: `intake`, `plan`,
`implement`, `review`, `test`, `report`, `compliance`, `ship`, and `index`. Review has two
branches: passing review advances to `test`; must-fix review uses `--event must_fix`
and returns to `implement`. Test has two branches: passing test advances to `report`;
qa-fail uses `--event qa_fails` and returns to `implement`. Compliance has two
primary branches: passing compliance advances to `ship`; major compliance failures
use `--event compliance_fails` and return to `implement`. Do not run `advance`
after the final `complete` state.

### Post-invocation state machine

Invocation creates `work/<day>/<task-id>/state.json`, `handoff.md`,
`next-prompt.md`, and `run.log.jsonl`. Initial state is `ready_for_intake_delegation`
with `currentStage: intake`.

| State | Owner | Transition | Human gate |
|---|---|---|---|
| `intake` | `intake-analyst` | `human_approval` via advance on spec | Accept canonical spec |
| `plan` | `tech-lead` | `human_approval` via advance on touch-set | Accept plan and scope |
| `implement` | `coder` | `implementation_complete` | Accept implementation report |
| `review` | `reviewer` | `review_passes` or `must_fix` | Pass (→ test) or return to implement |
| `test` | `qa-tester` | `qa_passes` or `qa_fails` | Pass (→ report) or return to implement |
| `report` | `tech-writer` | `report_ready` | Accept delivery report |
| `compliance` | `compliance-auditor` | `compliance_passes` or `compliance_fails` | Pass (→ ship) or return to implement |
| `ship` | `supervisor` | `human_ratifies_local_diff` | Ratify local diff |
| `index` | `librarian` | `artifacts_indexed` | Accept feature index |
| `complete` | `librarian` | `artifacts_closed` via close-artifacts | Validate closure |

Interventions journal under `.pan/scheduler/interventions/<task-id>.jsonl`.
Use `pnpm -w exec pan repair-state` only after explicit out-of-band work.

### SDK mode (`runner.cursor.invocation: sdk`)

1. Add to `pancreator.yaml`:

   ```yaml
   runner:
     cursor:
       invocation: sdk
   ```

2. Ensure repo-root `.env` defines `CURSOR_API_KEY` when using live SDK transport.
3. Run and advance as in the manual loop; the CLI invokes the entering persona and
   appends one runner observability record per invocation to `run.log.jsonl`.
   While a stage runs, the CLI emits progress on **stderr** every 2 minutes and
   on each stage transition. Interactive terminals receive human-readable
   `[pan fd] …` lines; non-TTY/agent invocations receive one NDJSON object per
   line with `"event":"feature_delivery_progress"`. Stage transitions include
   `transitionEvent` (for example `human_approval`, `review_passes`). Set
   `PAN_FD_PROGRESS=text` or `PAN_FD_PROGRESS=ndjson` to override auto-detection.
   Final command envelopes still print to stdout only.
4. After `review`, `test`, or `compliance` artifacts exist, SDK mode MAY auto-advance when
   `review_passes` / `qa_passes` / `compliance_passes` or route on `must_fix` / `qa_fails` / `compliance_fails` without a
   separate operator `advance` for that branch.
5. When cumulative `must_fix`, `qa_fails`, and `compliance_fails` retries exceed 5, the run halts with
   `status: halted` and one timestamp-prefixed file under
   `lib/inbox/out/<day-bucket>/` (basename `{SID}_{HHMM}_feature-delivery-retry-halt.md`).
6. When the run reaches `complete`, the runtime writes `work/<day>/<task-id>/pipeline-close.md`
   (outcome summary, residual issues, operator next steps) and
   `operator-verification.md` (acceptance criteria and manual test flows scaffold).
   Review both files before archival closure.
7. Run `pnpm -w exec pan close-artifacts <task-id>` once after reviewing
   `pipeline-close.md` and finalizing `operator-verification.md`.

#### Progress in the terminal vs chat

In an interactive terminal, stderr shows human-readable `[pan fd] …` lines
automatically while stages run. Set `PAN_FD_PROGRESS=text` or
`PAN_FD_PROGRESS=ndjson` to override auto-detection. Final command envelopes
print to stdout only.

When an agent runs SDK-mode commands from chat on your behalf, progress does
not appear in the chat window unless the agent relays it. See `AGENTS.md` §5
and `OPERATION.md` § SDK mode.

#### Model escalation tiers (SDK mode only)

When `runner.cursor.invocation` is `sdk`, the runner reads the canonical config at
`pancreator-model-escalation.yaml` in the repository root. Each config name under `configs`
maps persona slugs to escalation tiers: a `default` model string plus optional integer tier
keys whose values are full model strings (bracket qualifiers preserved).

Active config precedence:

1. `PAN_MODEL_ESCALATION_CONFIG` environment variable
2. `runner.cursor.model_escalation.config` in `pancreator.yaml`
3. `active_config` in `pancreator-model-escalation.yaml`

`state.json` carries `automation.stageInvocationIndexByStage` (per-stage visit counts) and
mirrors the current stage index in `automation.stageInvocationIndex` before each SDK call.
The tier index is `0` on the first SDK entry to a stage, `1` on the second entry to that
same stage (for example a second `review` pass after a `must_fix` cycle), and so on.
Counts are independent per stage id and are not cleared when the pipeline advances to a
different stage. Tier resolution uses the greatest tier key ≤ the index, or `default` when
no integer key applies.

When the first SDK call for an invocation returns a **model issue**, `CursorRunner` walks
this fallback order: lower keyed tiers (descending), `default`, higher keyed tiers
(ascending), then `auto`. Non-model errors return immediately without fallback.

Reset triggers: retry-limit halt clears all per-stage counts; successful stage completion
does not reset other stages' counts.

`run.log.jsonl` records escalation under the nested `escalation` key, including
`active_config`, `persona_slug`, `stage_invocation_index`, `resolved_model`,
`full_model_string`, and per-fallback fields `fallback_model`, `fallback_reason`, and
`outcome` (`success` or `chain_exhausted`).

### Batch feature-delivery runs

`pnpm -w exec pan batch run` orchestrates multiple inbox directives as isolated
sub-runs on worktree branches. Each sub-run requires SDK mode
(`runner.cursor.invocation: sdk`). The orchestrator copies gitignored inbox
directives into each worktree, invokes `startFeatureDelivery`, runs librarian
pre-close validation (`pnpm -w exec pan check`) and `close-artifacts` on
successes, continues on failure, and merges successful branches into one
integration branch in CLI argument order.

Sequential (default):

```bash
pnpm -w exec pan batch run 172970_06-05-26/71489_0408_batch-feature-delivery-sequential-parallel.md \
  172970_06-05-26/71489_0408_other-feature.md
```

Parallel (operator-capped concurrency):

```bash
pnpm -w exec pan batch run --parallel 2 \
  172970_06-05-26/71489_0408_batch-feature-delivery-sequential-parallel.md \
  172970_06-05-26/71489_0408_other-feature.md \
  172970_06-05-26/71489_0408_third-feature.md
```

Dry-run (no git or worktree mutations):

```bash
pnpm -w exec pan batch run --dry-run lib/inbox/in/172970_06-05-26/71489_0408_batch-feature-delivery-sequential-parallel.md
```

Flags:

- `--parallel N` — maximum concurrent sub-runs (default `1`).
- `--base <ref>` — base ref for run branches and merge branch (default: current `HEAD`).
- `--merge-branch <name>` — integration branch (default: `pan/batch-<batchId>/integration`).
- `--dry-run` — print planned branches, parallelism, and inbox order; exit zero without starting sub-runs.

Batch ledger: `work/<day>/batch-<batchId>/batch.json`. Sub-run branches:
`pan/batch-<batchId>/<task-id>`. Worktrees: `.pan/worktrees/<task-id>/`.

When `PAN_FD_PROGRESS=ndjson` is set, batch-level progress events
(`batch_enter`, `batch_run_start`, `batch_run_complete`, `batch_run_failed`,
`batch_slot_free`, `batch_merge_start`, `batch_complete`) emit on stderr with
`batchId`, optional `taskId`, and RFC3339 `atIso`.

**Env-collision caveat:** `--parallel` greater than `1` shares host environment
variables and ports across concurrent SDK sub-runs. Full `EnvIsolation` is out
of scope; cap parallelism or serialize runs that bind the same ports.

### Tasks outside feature-delivery

For ad-hoc work that does not use the feature-delivery ledger:

1. Check `lib/memory/active/current.md` for active pointers.
2. Put requests in `lib/inbox/in/` when they need org tracking.
3. Separate planning from execution: use `work/<day>/<task-id>/handoff.md`,
   then delegate to the owning persona (see `AGENTS.md` §4).
4. Stage local diffs and ratify at phase boundaries before commit.

### Out-of-band context review

When you want a holistic correctness pass over diff plus operator context (plan
docs, commit messages, agent transcripts) **outside** feature-delivery gates:

1. Scaffold the bounded prompt (no task id required):

   ```bash
   pnpm -w exec pan context-review scaffold
   ```

   Optional flags:

   - `--workspace sandbox/<slug>` — output directory (default: `sandbox/context-review`)
   - `--scope-path <repo-path>` — repeat for diff scope
   - `--context-path <repo-path>` — repeat for plan/spec/ADR docs to read
   - `--run-dir work/<day>/<slug>` — optionally pull touch-set and run artifacts when that directory exists

2. Delegate `/context-reviewer` with `sandbox/<slug>/context-review-prompt.md`
   (or operator-authored scope in chat).
3. Read `sandbox/<slug>/context-review.md` (advisory only).

The SDK and `pan advance` never auto-invoke context review. In-band review and
QA remain the `reviewer` and `qa-tester` pipeline stages.

### Operator sandbox (`sandbox/`)

Top-level `sandbox/` is gitignored scratch space for manual QA, exploratory
testing, and out-of-band context review. It is distinct from `.pan/sandboxes/`
(port-registry control plane) and `lib/inbox/notes/` (human-only; agents must
not read).

Recommended layouts:

- `sandbox/context-review/` — default out-of-band review workspace
- `sandbox/<slug>/` — ad-hoc QA or review passes
- `sandbox/<task-id>/` — optional copy of an in-flight run touch-set

Prepare a sandbox copy from an in-flight run touch-set (optional convenience):

```bash
pnpm -w exec pan sandbox prepare <task-id>
```

This writes `sandbox/<task-id>/manifest.json` listing copied paths. Use the
sandbox tree for destructive checks, browser flows, or one-off scripts instead
of mutating the main worktree.

Pancreator self-development (internal surface only): read root `AGENTS.md`, then
route through `docs/PRD.summary.md` and `docs/PRD.index.md` before full
`docs/PRD.md` or `docs/BOOTSTRAP.md`. The entire `docs/` tree, including
`docs/README.md`, is explicit-read and excluded from default semantic indexing.

## Self-host developer setup

When developing Pancreator in this repository (`project_root: "."`), materialize
the local Cursor runtime after clone or when persona or rule sources change:

```bash
pnpm install
pnpm -w exec pan cursor-sync
```

The `.cursor/` directory is gitignored. Canonical sources are `lib/personas/`
(agents and rules). Verify Cursor discovers
custom agents under `.cursor/agents/` after sync per
`lib/memory/handbook/context-economy.md`.

## Embedded install checklist

For adopting Pancreator into an existing repository with `project_root: ".pancreator"`:

1. Run embedded init from the harness root:

   ```bash
   pnpm -w exec pan init --apply
   ```

2. Verify `.pancreator/AGENTS.md` and `.pancreator/OPERATION.md` exist.
3. Verify host `AGENTS.md` contains the Pancreator augment pointer block.
4. Verify `.cursor/agents/` is populated (for example `.cursor/agents/intake-analyst.md` exists at the harness root) and `.cursor/rules/` is emitted from seeded `lib/personas/rules/`. These paths are local-only and are not committed to git.
5. Open the harness root in Cursor.
6. Run feature delivery in SDK mode (embedded `pancreator.yaml` defaults to `runner.cursor.invocation: sdk`):

   ```bash
   pnpm -w exec pan run feature-delivery <day-bucket>/<SID>_<HHMM>_<slug>.md
   ```

### Manual agent sync

When persona specs or rule specs under `lib/personas/rules/` change, or
cursor agents were not emitted during init, regenerate the local `.cursor/` tree.
When `pancreator-model-escalation.yaml` is present, `cursor-sync` first copies each listed persona's `default` tier model from the active escalation config (resolved like SDK runs: `PAN_MODEL_ESCALATION_CONFIG`, then `runner.cursor.model_escalation.config` in `pancreator.yaml`, then the file-level `active_config`) into `lib/personas/<slug>.md`, then mirrors personas to `.cursor/agents/` and emits rules from `lib/personas/rules/` to `.cursor/rules/`. Personas omitted from the active config are left unchanged.

```bash
pnpm -w exec pan cursor-sync [--dry-run] [harnessRoot]
```

Example dry-run from the harness root:

```bash
pnpm -w exec pan cursor-sync --dry-run
```

## pan CLI verbs

Every runnable operator command uses `pnpm -w exec pan …` from the repository root.

| Current stage | Delegate to | Required artifact | After acceptance |
|---|---|---|---|
| `intake` | `intake-analyst` | `lib/memory/features/<feature-id>/spec.md` | `pnpm -w exec pan advance <task-id> --artifact lib/memory/features/<feature-id>/spec.md` |
| `plan` | `tech-lead` | `<runDir>/plan.md`, `touch-set.json`, `handoff.md` | `pnpm -w exec pan advance <task-id> --artifact <runDir>/touch-set.json` |
| `implement` | `coder` | `<runDir>/implementation-report.md` | `pnpm -w exec pan advance <task-id> --artifact <runDir>/implementation-report.md` |
| `review` (pass) | `reviewer` | `<runDir>/review.md` | `pnpm -w exec pan advance <task-id> --artifact <runDir>/review.md` |
| `review` (must-fix) | `reviewer` | `<runDir>/review.md` | `pnpm -w exec pan advance <task-id> --event must_fix --artifact <runDir>/review.md` |
| `test` (pass) | `qa-tester` | `<runDir>/test-report.md` | `pnpm -w exec pan advance <task-id> --artifact <runDir>/test-report.md` |
| `test` (qa-fail) | `qa-tester` | `<runDir>/test-report.md` | `pnpm -w exec pan advance <task-id> --event qa_fails --artifact <runDir>/test-report.md` |
| `report` | `tech-writer` | `lib/memory/features/<feature-id>/delivery-report.md` | `pnpm -w exec pan advance <task-id> --artifact lib/memory/features/<feature-id>/delivery-report.md` |
| `compliance` (pass) | `compliance-auditor` | `<runDir>/compliance-result.json` | `pnpm -w exec pan advance <task-id> --artifact <runDir>/compliance-result.json` |
| `compliance` (major fail) | `compliance-auditor` | `<runDir>/compliance-result.json` | `pnpm -w exec pan advance <task-id> --event compliance_fails --artifact <runDir>/compliance-result.json` |
| `ship` | `supervisor` | `<runDir>/ship-ratification.json` | `pnpm -w exec pan advance <task-id> --artifact <runDir>/ship-ratification.json` |
| `index` | `librarian` | `lib/memory/features/<feature-id>/index.json` | `pnpm -w exec pan advance <task-id> --artifact lib/memory/features/<feature-id>/index.json` |
| `complete` | `librarian` | ship-ratification + index + operator-verification | `pnpm -w exec pan close-artifacts <task-id>` |

Ad-hoc and recovery verbs:

| Verb | When | Command |
|---|---|---|
| Ad-hoc close | Build-mode workspace with verification pack | `pnpm -w exec pan close-out-of-band work/<day>/<task-id> --feature <id> --reason "<text>"` |
| Context review (advisory) | Holistic diff + transcript correctness pass (no task id) | `pnpm -w exec pan context-review scaffold` then delegate `/context-reviewer` |
| Sandbox prepare | Copy touch-set into isolated QA tree | `pnpm -w exec pan sandbox prepare <task-id>` |
| Reopen | Post-close verification failed | `pnpm -w exec pan reopen <task-id> --reason "<text>" [--stage <stage>]` |

Compliance audit history contract (feature-delivery compliance stage):

- Saved audit ledger: `lib/memory/features/compliance-tests/audit-history.json`
- Retention: newest 5 audits
- Default baseline: previous saved audit entry
- Optional baseline override: set `baseline_audit_id` in `<runDir>/compliance-result.json` to one of the saved audit IDs
- Audit focus: path-level delta between the selected baseline snapshot and the current compliance scope

Inspection and recovery:

```bash
pnpm -w exec pan check
pnpm -w exec pan status <task-id>
pnpm -w exec pan refresh-prompt <task-id>
pnpm -w exec pan pause <task-id>
pnpm -w exec pan resume <task-id>
pnpm -w exec pan abort <task-id> --reason "superseded or unsafe"
pnpm -w exec pan repair-state <task-id> --stage review \
  --artifact work/<day>/<task-id>/review.md \
  --reason "out-of-band work reached review before advance"
pnpm -w exec pan reopen <task-id> --reason "Operator verification failed after close"
```

Deferred verbs exit **125** with JSON `status: deferred` per CLI contract.

## Active memory refresh

- Set **Active Feature** in `lib/memory/active/current.md` explicitly when work starts.
- Run `pnpm -w exec pan refresh-active-memory [--dry-run]` when shipped-feature rows
  or the managed operator-notes stamp drift from indexed artifacts.
- `pnpm -w exec pan close-artifacts <task-id>` refreshes shipped rows and clears Active
  Feature to `(none)` when it matched the archived inbox source.
- `lib/memory/features/*/index.json` remain the indexed source of truth for features.

## Version control and optional PR drafting

- Stage diffs locally; obtain human ratification before commit or push.
- Pancreator does not enforce commit gates or touch-set parity at commit time.
- Optional: invoke `/pr-writer` with a feature ID or `work/<day>/<task-id>/` path to
  draft a GitHub PR body from pipeline artifacts and the current git worktree.

### Pre-close validation checklist

`pnpm -w exec pan check` runs the same named checks as read-only aggregation (pass/fail report only; it does not modify the repository). The deprecated `pan doctor` alias prints a stderr warning and delegates to `pan check`.

Before `pnpm -w exec pan close-artifacts <task-id>`, run these checks from the
repository root. Agents performing closure follow the obligations in
`AGENTS.md` §5:

```bash
pnpm run build
pnpm lint
pnpm run lint:deps
pnpm typecheck
pnpm run attw
pnpm run publint
pnpm test
node --test tests/*.test.mjs
node lib/internal/tools/run-compliance.mjs
node lib/internal/tools/check-phase-0a-scaffold.mjs
node lib/internal/tools/context-budget-report.mjs
node lib/internal/tools/check-operator-output.mjs
```

When a check fails for reasons outside the closing task touch-set, open or link
a backlog item instead of expanding scope.

This repository does not ship GitHub Actions workflows under `.github/workflows/`.
The qa-tester stage and librarian pre-close validation above are the canonical
local quality gates for this repository.

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| `advance` rejects missing artifact | Stage work incomplete | Finish artifact; do not edit `state.json` manually |
| Ledger behind out-of-band work | Skipped `advance` | `pnpm -w exec pan repair-state` with evidence artifact |
| Wrong persona in prompt | Stale `next-prompt.md` | `pnpm -w exec pan refresh-prompt <task-id>` |
| Bare `pan` command fails | CLI not on PATH | Use `pnpm -w exec pan …` per `lib/memory/handbook/pancreator-config.md` |
| Active memory drift | Skipped refresh | `pnpm -w exec pan refresh-active-memory --dry-run` then apply |
| Operator-output lint fails | Bare `pan` in runnable block | Run `node lib/internal/tools/check-operator-output.mjs` and fix cited paths |
| `close-artifacts` fails: missing operator-verification.md | Verification pack not authored at complete | Finalize `work/<day>/<task-id>/operator-verification.md` (scaffold lands at `complete`); then rerun `pnpm -w exec pan close-artifacts <task-id>`. |
| `close-artifacts` fails: active run directory missing or archive already exists | Librarian archived `work/` during index instead of waiting for `close-artifacts` | Do not manually `mv` work directories; run `pnpm -w exec pan close-artifacts <task-id>` only at `complete`. When work is already under `archive/work/`, closure finalizes state idempotently. |
| Completed runs still under `work/` while peers are in `archive/work/` | `close-artifacts` skipped after `complete`, or superseded retry task dirs left behind | Run `pnpm -w exec pan check` and resolve `work-archive-hygiene` findings: `close-artifacts` each `complete` run (canonical task first when duplicates share a feature); superseded duplicates MAY close after inbox is already archived. |
| `advance` rejects delivery-report citation lint | JS-literal or compact inline citations in `delivery-report.md` | Run `node lib/internal/tools/reformat-markdown-citations.mjs` and follow `lib/memory/handbook/contract-templates/delivery-report.template.md` |

For deferred CLI verbs, read the JSON envelope (`milestone`, `tracking_intake`,
`manual_workaround`) and follow the documented manual workaround.

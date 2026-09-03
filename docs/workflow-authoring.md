# Workflow authoring

How to define a Pancreator workflow. A workflow is a small, reviewable set of
JSON files plus one task brief per stage. The harness assembles them, validates
the graph, and snapshots the result per run.

## File layout

```text
library/workflows/<slug>/
  workflow.json            # index: run-wide settings + ordered stage slugs
  stages/<stage>.json      # one file per stage
  prompts/<stage>.md       # one task brief per stage
```

The index lists stages by slug; each slug resolves to `stages/<slug>.json`.
Splitting stages into their own files keeps each unit small enough to read and
review on its own. This is the general rule: prefer one file per stage over a
single dense blob.

Schemas:

- [`library/schemas/workflow.schema.json`](../library/schemas/workflow.schema.json) - the index file.
- [`library/schemas/stage.schema.json`](../library/schemas/stage.schema.json) - one stage file.

These schemas are documentation and tooling aids. The dependency-free enforcer
is the imperative validator in `src/lib/workflow.ts`, run by `./bin/pan validate`.

## Index fields (`workflow.json`)

- `schema_version` - always `1`.
- `slug` - workflow id and directory name.
- `title`, `description` - human-readable summary.
- `start_stage` - slug of the entry stage; must appear in `stages`.
- `limits` - circuit breakers: `max_total_transitions`, `max_stage_attempts`,
  `max_consecutive_failures`. Exceeding any pauses the run with a decision
  record. These broad budgets are independent of the universal same-reason
  circuit breaker: two consecutive hard failures with the same normalized
  signature pause immediately. The harness never silently resets a budget.
- `stages` - ordered, unique stage slugs.

## Pipeline model configuration

`config.json` is the single source of truth for persona-to-model selection.
It contains named configurations such as `default`, `complex`, `auto`, and `fable`.
Every named configuration MUST map every canonical Cursor agent template under `library/cursor/agents/`, including standalone command personas that are not referenced by a workflow.

After changing `active_config` or a model value, run:

```sh
./bin/pan models --sync
```

This regenerates the ignored local `.cursor/` surface from the canonical sources declared in `governance/registries/projection_manifest.json`, including the active model mapping in `.cursor/agents/pan-<persona>.md` frontmatter. `./bin/pan validate` validates the canonical projection sources even when local `.cursor/` output is absent; when a local projection exists, it also fails on drift. It also fails when a canonical agent template is unmapped, its `library/personas/<persona>.md` contract is missing, or a workflow worker template is missing.
New runs copy the active mapping to `pipeline-config.snapshot.json`; every
invocation records the resolved model and configuration name. Because Cursor
subagent files are project-global, preparing an existing run fails if the live
active mapping no longer matches its snapshot. Restore and resynchronize that
mapping before resuming the run.

## Stage fields (`stages/<stage>.json`)

- `slug` - stage id; matches the file name and a slug in the index.
- `title` - shown on cards and records.
- `persona` - owner; resolves to `library/personas/<persona>.md` and, for
  delegated work, the `.cursor/agents/pan-<persona>.md` subagent. The run resolves
  the persona to a model through the active named mapping in
  [`config.json`](../config.json), then snapshots that mapping
  so an in-flight run cannot drift when the live config changes.
- `prompt_path` - the stage task brief; its contents become the card's Task
  section.
- `workspace_policy` - the mutation boundary the harness enforces with workspace
  fingerprints:
  - `source_allowed` - may modify product source (implement, and review when
    the reviewer is explicitly responsible for bounded non-structural remediation).
  - `release_metadata_only` - in Pancreator self-development, may modify only
    `CHANGELOG.md`, `VERSION`, npm version metadata, `README.md`, and
    version-bearing Markdown under `docs/`; in embedded installations it
    behaves as `read_only` (ship).
  - `runtime_only` - may write only under `runtime/` (intake, plan).
  - `read_only` - may not change any tracked content (test and any review
    stage that is not explicitly source-allowed).
    Any policy other than `source_allowed` adds the deterministic criterion `scope.no_unapproved_changes`. This criterion detects external or unattributed contamination: a stage may report top-level `workspace_changes` with `attribution: internal` and every changed path to preserve attribution without blocking.
- `gate` - what decides advancement after a valid, successful output:
  - `operator` - pause for explicit operator approval (intake, ship).
  - `supervisor` - pause for independent supervisor judgment of the judgment
    criteria (plan).
  - `stage_verdict` - the worker's own verdict drives the transition
    (verify).
  - `next_stage` - advance directly along the success transition (implement).

  A run's operator-involvement profile MAY replace this gate; see
  **Operator involvement profiles** below.

- `gate_relaxable` - optional boolean, default `true`. Set `false` to stop an
  involvement profile lowering the gate. `delivery/ship` sets it because `SHIP-001`
  requires a pause before commit, push, merge, publication, or deployment; a
  stored configuration profile must not be able to remove that pause silently.
  Escalation is always allowed.

- `checkpoint` - optional role this stage plays for run contracts, one of
  `technical_plan` or `independent_review`. Contracts attach by role rather than
  by stage slug, so the same contract applies unchanged to `planning/plan`,
  `prototype/approach`, and `design/review`. At most one stage per workflow may
  declare a given checkpoint.
- `context` - the deterministic stage-scoped input projection:
  - `request` declares the original request as `required`, `conditional`, or
    `omit`.
  - `required_stage_outputs` selects effective outputs that MUST be read.
  - `conditional_stage_outputs` keeps records available behind an explicit
    retrieval condition.
  - `prior_attempts` and `operator_feedback` bound remediation history by count.
  - ship-like stages MAY include active operator waiver directives, current workspace
    ratifications, and the latest workspace-change validation.

  Each stage-output selector declares `stage` and `selection`. Use
  `latest_success` for ratified/effective upstream results and `latest` when a
  failed result may still be authoritative evidence, such as a waived review.
  The harness lists execution records as conditional provenance rather than a
  second required read and writes omitted history to an index-only context
  manifest.

- `required_data` - the output's `data` shape, as dotted paths mapped to JSON
  types (`object`, `array`, `string`, `number`, `boolean`). The harness rejects
  an output whose `data` does not match. Example:

  ```json
  {
    "engineering_plan": "object",
    "engineering_plan.approach": "string",
    "engineering_plan.components": "array",
    "acceptance_criteria": "array"
  }
  ```

- `criteria` - the checkable claims. See
  [`governance/criteria/index.md`](../governance/criteria/index.md) for naming
  and types. Prefer `shell`/`state` checks over `judgment` whenever a command or
  state can decide the claim.
- `transitions` - `success`, `failure`, and `blocked` targets. A target is
  another stage slug or a terminal status (`succeeded`, `failed`, `canceled`,
  `paused`). Every stage must be reachable from `start_stage`.

## Shipped workflows

- `delivery` - production-ready delivery of one ratified specification:
  implement, joint verify with parallel review and QA evidence workers and a
  graded verdict, verdict-routed remediate, and ship. The run starts at
  `implement` and reads its request, normally a child specification the
  `planning` workflow ratified, as the plan. `delivery-candidate` is the
  autonomous best-of-N variant; it keeps its own `plan` stage and omits ship.
- `prototype` - a fast spike that answers a technical question: intake,
  approach, build, evaluate. It applies `PROTO-001`, keeps the approach stage
  deliberately thin and ungated, gates only the `static` repository-check
  profile, and reports the other profiles as advisory evidence. Repository
  validation rejects any other hard shell gate in this workflow, because a hard
  full-suite gate would reintroduce the cost the workflow exists to avoid.
- `design` - UI/UX predecessor that hands off to a separately started `delivery` run.
- `planning` - planning on its own: one `plan` stage owned by the `planner`
  persona, behind one operator gate that records the `technical_plan`
  checkpoint. It keeps the `runtime_only` workspace policy, hard criteria
  ids, and required data contract of the plan stage that `delivery` held
  before the split, so a contract that attaches by criterion id keeps
  attaching. It adds the `cohort_plan` data
  contract and resolves `PLAN-002` and `COHORT-001` through the policy lookup
  table rather than through prompt text. Ratifying its artifact produces a
  parent specification, one child specification per chunk, and the cohort plan
  the `pan cohort` lifecycle fans out: `cohort init` opens the session,
  `cohort start` creates one `delivery` run per chunk of the active cohort,
  and `cohort integrate` merges the finished chunk branches and records the
  satisfaction entry that unblocks the next cohort. `pan init --autostart`
  on a planning run makes the approval of its plan gate open the session and
  start cohort 1. A run created before this workflow existed keeps its own
  snapshotted graph and needs no migration; a new `planning` run from the
  same request is how in-flight planning work reaches the cohort lifecycle.
  See the operator guide for the full lifecycle.

## Operator involvement profiles

`config.json.operator_involvement` declares named profiles that control how
heavily the operator gates each stage:

```json
{
  "active": "standard",
  "profiles": {
    "technical-director": {
      "summary": "Operator refines the plan and responds to review.",
      "gates": { "test": "operator" },
      "contracts": ["technical_director"]
    }
  }
}
```

- `gates` maps a stage slug, or `*` for every stage, to the gate that stage uses
  for the run.
- `contracts` names run-wide contracts. `technical_director` loads
  `DIRECTOR-001` and escalates the `technical_plan` and `independent_review`
  checkpoints to operator gates.

Select one with `./bin/pan init --involvement <profile>`; omitting the flag uses
`active`. List them with `./bin/pan involvement`.

Gates resolve by ascending specificity, so a blunt default cannot cancel a
targeted one:

1. the gate the workflow declares,
2. the profile's `*` gate,
3. run-contract escalations keyed by stage `checkpoint`,
4. the profile's explicit per-stage gate.

The run resolves its profile once at `init` and writes the result into
`workflow.snapshot.json` and `state.operator_involvement`. Later edits to
`config.json` never change a run already in flight. `./bin/pan validate` checks
every profile against every workflow, so a mistyped stage slug fails at
authoring time rather than at someone else's `pan init`.

A contract-scoped policy lookup row keeps run contracts inside the single policy
applicability map:

```json
{
  "persona": "*",
  "workflow": "*",
  "stage": "*",
  "contract": "technical_director",
  "policies": ["DIRECTOR-001"]
}
```

## Attempt accounting

`max_stage_attempts` bounds retries of the stage a run is currently on, not how
many times the run legitimately visits it. Leaving a stage for a different one
clears that stage's counter, so a later return starts fresh; the per-attempt
record stays in `stage_history`. An invocation prepared but never submitted does
no work and does not consume an attempt.

An operator revision (`./bin/pan decide <run-id> revise --note <directive>`) is
not a failed attempt. It re-runs the same stage with the directive as required
input and raises that stage's ceiling by one, recorded in
`state.operator_revisions`.

## Validation rules enforced by the harness

A stage whose `failure` transition points to itself is automatically covered
by same-reason tracking. The second consecutive hard failure with the same
normalized signature pauses before a third invocation can be prepared.

- `schema_version` is `1`; `slug`, `title`, and a non-empty `stages` list exist.
- Stage slugs are unique; each has a persona, a valid `gate`, `context`, and
  `workspace_policy`, an existing `prompt_path`, criteria, and transitions.
- Context selectors target real stages and use `latest` or `latest_success`.
- At most one stage per workflow declares a given `checkpoint`.
- Criterion ids are unique within a stage; `shell` criteria declare a command.
- Transition outcomes are `success`/`failure`/`blocked`, and every target is a
  terminal status or an existing stage.
- `start_stage` exists and every stage is reachable.

## Command governance rule

Every canonical command under `library/cursor/commands/` MUST deliver its
governance through a harness-resolved card, or be listed as read-only in
`governance/registries/command_governance.json`. `pan validate` enforces:

- A command MUST contain `pan governance card --mode <mode>` where `<mode>` is a
  registered `STANDALONE_MODES` entry, unless it appears in
  `read_only_commands`.
- A command in `supervisor_commands` (`pan-start`, `pan-resume`) MUST run
  `pan governance card --mode supervisor --run <run-id>`.
- A command MUST NOT tell the session to read or inline a
  `governance/policies/*.json` file by hand; the card is the only delivery path.
- A `pending_card_steps` entry turns a missing step into a warning until the
  named insertion lands, and becomes an error once the step exists.
- Every standalone mode MUST have a persona-specific lookup row, and every
  `workflow: standalone` lookup row MUST name a stage some mode declares.

A new mode therefore needs three edits together: the `STANDALONE_MODES` entry in
`src/lib/governance-card.ts`, its lookup row in
`governance/registries/policy_lookup_table.json`, and the card step in the
command file. Run `./bin/pan models --sync` afterwards.

Run `./bin/pan validate` after editing any workflow file.

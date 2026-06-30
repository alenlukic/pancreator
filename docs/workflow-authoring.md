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
  record. The harness never silently resets a budget.
- `stages` - ordered, unique stage slugs.

## Pipeline model configuration

`project.json` is the single source of truth for persona-to-model selection.
It contains named configurations such as `default`, `complex`, `auto`, and `fable`.
Every named configuration MUST map every canonical Cursor agent template under `library/cursor/agents/`, including standalone command personas that are not referenced by a workflow.

After changing `active_config` or a model value, run:

```sh
./bin/pan models --sync
```

This regenerates the ignored local `.cursor/` surface from the canonical sources declared in `governance/registries/projection_manifest.json`, including the active model mapping in `.cursor/agents/<persona>.md` frontmatter. `./bin/pan validate` validates the canonical projection sources even when local `.cursor/` output is absent; when a local projection exists, it also fails on drift. It also fails when a canonical agent template is unmapped, its `library/personas/<persona>.md` contract is missing, or a workflow worker template is missing.
New runs copy the active mapping to `pipeline-config.snapshot.json`; every
invocation records the resolved model and configuration name. Because Cursor
subagent files are project-global, preparing an existing run fails if the live
active mapping no longer matches its snapshot. Restore and resynchronize that
mapping before resuming the run.

## Stage fields (`stages/<stage>.json`)

- `slug` - stage id; matches the file name and a slug in the index.
- `title` - shown on cards and records.
- `persona` - owner; resolves to `library/personas/<persona>.md` and, for
  delegated work, the `.cursor/agents/<persona>.md` subagent. The run resolves
  the persona to a model through the active named mapping in
  [`project.json`](../project.json), then snapshots that mapping
  so an in-flight run cannot drift when the live config changes.
- `prompt_path` - the stage task brief; its contents become the card's Task
  section.
- `workspace_policy` - the mutation boundary the harness enforces with workspace
  fingerprints:
  - `source_allowed` - may modify product source (implement).
  - `release_metadata_only` - in Pancreator self-development, may modify only
    `CHANGELOG.md`, `VERSION`, npm version metadata, `README.md`, and
    version-bearing Markdown under `docs/`; in embedded installations it
    behaves as `read_only` (ship).
  - `runtime_only` - may write only under `runtime/` (intake, plan).
  - `read_only` - may not change any tracked content (review, test).
    Any policy other than `source_allowed` adds the deterministic criterion
    `scope.no_unapproved_changes`, so a read-only stage that mutates source fails.
- `gate` - what decides advancement after a valid, successful output:
  - `operator` - pause for explicit operator approval (intake, ship).
  - `supervisor` - pause for independent supervisor judgment of the judgment
    criteria (plan).
  - `stage_verdict` - the worker's own verdict drives the transition (review,
    test).
  - `next_stage` - advance directly along the success transition (implement).
- `context` - the deterministic stage-scoped input projection:
  - `request` declares the original request as `required`, `conditional`, or
    `omit`.
  - `required_stage_outputs` selects effective outputs that MUST be read.
  - `conditional_stage_outputs` keeps records available behind an explicit
    retrieval condition.
  - `prior_attempts` and `operator_feedback` bound remediation history by count.
  - ship-like stages MAY include active waivers, current workspace
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

## Validation rules enforced by the harness

- `schema_version` is `1`; `slug`, `title`, and a non-empty `stages` list exist.
- Stage slugs are unique; each has a persona, a valid `gate`, `context`, and
  `workspace_policy`, an existing `prompt_path`, criteria, and transitions.
- Context selectors target real stages and use `latest` or `latest_success`.
- Criterion ids are unique within a stage; `shell` criteria declare a command.
- Transition outcomes are `success`/`failure`/`blocked`, and every target is a
  terminal status or an existing stage.
- `start_stage` exists and every stage is reachable.

Run `./bin/pan validate` after editing any workflow file.

# Pancreator v0.1

Pancreator v0.1 is a dependency-free, Cursor-native control plane for agent workflows. Cursor provides the conversational supervisor, named subagents, and MCP integrations. Compiled TypeScript and shell code provide durable workflow state, policy selection, validation, retries, evidence, and operator-readable records.

## What this prototype proves

- A single Cursor chat can supervise a bounded workflow without an external agent framework.
- Each run is resumable from repository files and reconstructable from append-only events.
- Agents receive narrow invocation cards with only applicable policies and prior artifacts.
- Source mutation boundaries, output shape, workflow topology, retry limits, tests, and coverage are checked by code.
- Intake and release remain explicit operator gates.
- Plan evaluation, code review, and QA use distinct authority boundaries instead of letting one agent self-certify the entire run.

## Requirements

- Node.js 22 or newer
- Git
- Cursor with project commands/subagents enabled
- Optional MCP servers configured in Cursor; Pancreator itself does not run or depend on them

There are no npm runtime dependencies. TypeScript and Prettier are development-only dependencies; `./bin/pan` compiles the project before invoking the CLI.

## Quick start in Cursor

1. Run `./bin/pan models --sync` once after cloning to generate the ignored local `.cursor/` projection.
2. Open or reload the repository in Cursor.
3. Run `/pan-validate` once.
4. Use `/pan-decompose <intake spec>` when a request may be too large for one efficient workflow run.
5. Use `/pan-start <your request>` for systematic delivery.
6. Use `/pan-debug <problem>` for root-cause analysis and a work-mode recommendation.
7. Use `/pan-spotfix <request>` only for an explicitly lightweight, small-scope change.
8. For systematic work, ratify intake and continue with `/pan-resume <run-id>` until the next operator gate.

The CLI is also directly usable:

```sh
./bin/pan init --workflow dev --request runtime/inbox/request.md
./bin/pan prepare <run-id>
./bin/pan status <run-id>
./bin/pan submit <run-id> <stage-output.json>
./bin/pan assess <run-id> <assessment.json>
./bin/pan decide <run-id> approve
./bin/pan pause <run-id> [--note "<reason>"]
./bin/pan set-stage <run-id> --stage <stage> --note "reason for repair"
./bin/pan accept-change <run-id> --note "operator-intentional change"
./bin/pan waive-gate <run-id> --criteria <id[,id...]> --note "accepted exception"
```

### Workspace model

The source checkout is Pancreator's self-development environment. Normal use
installs the harness into a target repository at `.pancreator/`; the target root
then becomes the configured workspace automatically. Manual `--workspace`
overrides remain available for exceptional self-development and migration work,
but they are not the normal target-repository interface.

## Work modes

`/pan-decompose` is an optional pre-workflow assessment for unusually broad intake. It applies `DECOMP-001`, defaults to retaining one larger systematic run, and decomposes only when independently valuable chunks cross a conservative complexity threshold and save more execution risk than the extra workflow overhead they create. File count and technical-layer boundaries are never sufficient by themselves. The validated packet is written under `runtime/inbox/` and contains either one retained intake or a small dependency-ordered set of standalone `/pan-start` chunks.

`systematic` is the default and executes a governed workflow such as `dev`.
`lightweight` is an explicit operator choice through `/pan-spotfix`; it is limited
to one coherent change that satisfies `WORK-001`, including a maximum of three
core implementation files in one bounded subsystem and no unresolved structural
decisions. `/pan-debug` uses the investigator persona to establish root cause,
define acceptance criteria, and recommend one of these modes.

A spotfix performs at most three implementation-validation cycles. It requires
lint, unit tests, regression tests, and acceptance-criteria evidence when those
checks exist. Unresolved or expanded work is preserved in a uniquely named
`runtime/inbox/spotfix-escalation-*.md` item for systematic routing.

## Embedded installation

Install Pancreator from this source checkout into the repository that Cursor
will manage:

```sh
./bin/install --target /path/to/your-project
cd /path/to/your-project
./.pancreator/bin/pan doctor
./.pancreator/bin/pan validate
```

If the target already has a `.gitignore`, the installer adds `.pancreator/`
idempotently and preserves the rest of the file; it does not create a new
`.gitignore` for targets that lack one.

The harness lives at `.pancreator/`; Pancreator agents, commands, and its rule
are merged into the target `.cursor/`. Existing `.cursor` state triggers a
warning and conflicting files are backed up before replacement.

Clean unindexed release candidates and dirty development snapshots can be
installed for validation, but only indexed releases can use automatic updates.
For an indexed v0 release update, initiate the fast-forward from Pancreator:

```sh
./bin/update --target /path/to/your-project
```

See [`docs/embedded-installation.md`](docs/embedded-installation.md) for the
installed boundary, version/index protocol, update guarantees, partial-install
behavior, and cleanup.

## Runtime record layout

```text
runtime/logs/workflows/<run-id>/
  state.json                 # current materialized state; never hand-edit
  events.jsonl               # append-only transition history
  workflow.snapshot.json     # immutable workflow definition for this run
  pipeline-config.snapshot.json # immutable persona-to-model mapping for this run
  request.md|json            # preserved operator input
  invocations/               # JSON contract + operator-readable Markdown card
  outputs/                   # worker stage outputs
  assessments/               # supervisor judgment requests and responses
  evidence/                  # deterministic command output
  decisions/                 # pause/escalation records
  artifacts/
    json/                     # machine-readable execution records and metadata
    markdown/                 # stage-authored reports and operator artifacts
```

Run directories use `<days-to-2200-01-01>_<MMM-DD>_<uuid-suffix>`. The day
component is `floor((2200-01-01T00:00:00Z - now) / 1 day)`, evaluated from the
run's UTC creation instant.

Stage-scoped artifact IDs use
`<reverse-step>_<stage>-<stage-iteration>_<uuid-suffix>`. While a run is open,
`reverse-step` is the two-digit value `99 - stage sequence in the run`, where the
first stage occurrence is sequence `0`. Thus sequence `0` is `99` and sequence
`8` is `91`. Each prepared worker invocation and executed harness stage consumes
the next sequence, including retries and workflow loops.

When a run reaches a terminal status, Pancreator automatically compacts the
prefixes against the actual stage count so the last occurrence is `00`. A
seven-stage run is renumbered from `99` through `93` to `06` through `00`.
Workflow runs therefore support at most 100 stage occurrences.

Execution records are stored only as machine-readable JSON in
`artifacts/json/<artifact-id>.json`. Stage-authored Markdown and other
operator-facing documents are stored under `artifacts/markdown/`.

Migrate legacy runtime records after updating the repository:

```sh
npm run migrate:workflow-names
```

The migration renames workflow directories under both runtime roots, applies the
correct open or terminal artifact sequence, consolidates legacy `records/` and
flat `artifacts/` contents into the typed artifact directories, removes redundant
rendered execution-record Markdown, removes an empty
legacy `--help` run directory, and rewrites persisted references. It is
idempotent.

## Library layout

Workflow definitions, personas, prompts, skills, schemas, templates, and canonical Cursor projection sources live under `library/`. `.cursor/` is ignored local output, never source authority. `governance/registries/projection_manifest.json` maps `library/cursor/` agents, commands, and rules into the local or embedded Cursor surface. Standalone command personas such as `investigator` and `spotfixer` use the same canonical-persona plus projected-Cursor-agent pattern as workflow personas. Each workflow is a slim index plus one file per stage:

```text
library/workflows/<slug>/
  workflow.json            # index: run-wide settings + ordered stage slugs
  stages/<stage>.json      # one file per stage
  prompts/<stage>.md       # one task brief per stage
```

See [`docs/workflow-authoring.md`](docs/workflow-authoring.md) for the field
semantics and the JSON schemas in `library/schemas/`.

### Pipeline model configuration

`project.json` restores V1-style named persona-to-model mappings. The active mapping is rendered from canonical `library/cursor/agents/` templates into ignored local Cursor subagent frontmatter and snapshotted for each run. After changing `active_config` or any mapping, synchronize and
validate it:

```sh
./bin/pan models --sync
./bin/pan validate
```

Invocation cards show both the resolved model and the named configuration. Because Cursor subagent models are project-global, changing and syncing the active mapping while a run is in flight blocks that run's next preparation until its snapshotted mapping is restored.

## Development workflow

```text
intake ──operator approval──> plan ──supervisor gate──> implement
  ^                              |                           |
  └──────── remediation ─────────┘                           v
                                     implement <──fail── review
                                          ^                 |
                                          └────fail── test <─┘
                                                        |
                                                        v
                                         ship ──operator approval──> succeeded
                                          |
                                          └──operator reject──> implement (or --stage <slug>)
```

Review and QA do not modify source. Failed review or QA routes to implementation unless the operator records a policy-conforming, fingerprint-bound gate waiver. Bounded deferred acceptance misses may open a linked spot-fix intake case, but lightweight eligibility is still evaluated independently. An operator rejection at the ship gate routes remediation back to implementation by default (or to `--stage plan`/another stage), carrying the operator's feedback forward as a required input. Ship creates a release packet only; commit, push, PR, merge, publication, and deployment remain operator-owned.
For stage-scoped required, conditional, and index-only invocation inputs, see [Invocation context projection](docs/runtime-protocol.md#invocation-context-projection).

## TypeScript and formatting

Human-authored TypeScript and TSX are governed by [`governance/handbooks/typescript/style-guide.md`](governance/handbooks/typescript/style-guide.md). The checked-in `prettier.config.js` is authoritative for formatter-owned layout.

```sh
npm install
npm run format
npm run typecheck
npm run build
npm run validate:chat-markdown -- <file>
```

## Validation

```sh
npm run lint
npm run validate
npm test
npm run test:coverage
npm run check
./bin/pan doctor
```

Coverage uses Node's built-in test coverage; no coverage runtime package is installed.

Successful build, lint, format, test, and aggregate check scripts are quiet by
default. Set
`PAN_VERBOSE=1` to stream their full output while diagnosing a problem.

## Design documents

- [`docs/runtime-protocol.md`](docs/runtime-protocol.md): state, gate, retry, evidence, and recovery semantics
- [`docs/workflow-authoring.md`](docs/workflow-authoring.md): how to define a workflow and its stages
- [`docs/operator-guide.md`](docs/operator-guide.md): how to inspect and remediate a run
- [`docs/output-verbosity.md`](docs/output-verbosity.md): quiet npm scripts and Cursor SDK invocation logging

# Pancreator v2 prototype

Pancreator v2 is a dependency-free, Cursor-native control plane for agent workflows. Cursor provides the conversational supervisor, named subagents, and MCP integrations. Compiled TypeScript and shell code provide durable workflow state, policy selection, validation, retries, evidence, and operator-readable records.

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

1. Open the repository in Cursor.
2. Run `/pan-validate` once.
3. Use `/pan-start <your request>` for systematic delivery.
4. Use `/pan-debug <problem>` for root-cause analysis and a work-mode recommendation.
5. Use `/pan-spotfix <request>` only for an explicitly lightweight, small-scope change.
6. For systematic work, ratify intake and continue with `/pan-resume <run-id>` until the next operator gate.

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

### Deliverable workspace

By default a run fingerprints, runs deterministic gate commands against, and enforces scope boundaries on the Pancreator repository root. When the deliverable lives elsewhere — for example a gitignored, self-contained project capsule that is its own Git repository — pass `--workspace`:

```sh
./bin/pan init --workflow dev --request runtime/inbox/request.md --workspace workdesk/my-project
```

The harness then fingerprints that directory's Git state (nested repositories included), runs each stage's shell gate in that directory, and evaluates the read-only scope guard there. Without this, work performed inside a gitignored path is invisible to every deterministic check and "success" reflects only the surrounding repository, not the deliverable.

## Work modes

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

To add Pancreator to another repository, use the installer and read the detailed guide:

```sh
./bin/pancreator-install --target /path/to/your-project
```

See [`docs/embedded-installation.md`](docs/embedded-installation.md) for generated files, verification, partial-install behavior, and cleanup.

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
  records/                   # operator-first task execution records
  decisions/                 # pause/escalation records
  artifacts/                 # stage-authored specs and reports
```

Run directories use `<days-to-2200-01-01>_<MMM-DD>_<uuid-suffix>`. The day
component is `floor((2200-01-01T00:00:00Z - now) / 1 day)`, evaluated from the
run's UTC creation instant.

Stage-scoped artifact IDs use
`<reverse-step>_<stage>-<stage-iteration>_<uuid-suffix>`. `reverse-step` is the
three-digit value `999 - stage sequence in the run`, where the first stage
occurrence is sequence `0`. Each prepared worker invocation and executed harness
stage consumes the next sequence. Thus sequence `0` is `999`, sequence `8` is `991`, and
sequence `994` is `005`. This makes lexicographic sorting show later stage
executions first, including retries and workflow loops.

Migrate legacy runtime records after updating the repository:

```sh
npm run migrate:workflow-names
```

The migration renames workflow directories under both runtime roots, renames
stage artifacts under `runtime/logs/workflows`, and rewrites persisted run and
artifact references. It is idempotent.

## Library layout

Workflow definitions, personas, prompts, skills, schemas, and templates live
under `library/`. Standalone command personas such as `investigator` and
`spotfixer` use the same canonical-persona plus projected-Cursor-agent pattern as
workflow personas. Each workflow is a slim index plus one file per stage:

```text
library/workflows/<slug>/
  workflow.json            # index: run-wide settings + ordered stage slugs
  stages/<stage>.json      # one file per stage
  prompts/<stage>.md       # one task brief per stage
```

See [`docs/workflow-authoring.md`](docs/workflow-authoring.md) for the field
semantics and the JSON schemas in `library/schemas/`.

### Pipeline model configuration

`project.json` restores V1-style named persona-to-model mappings. The
active mapping is copied into matching Cursor subagent frontmatter and snapshotted
for each run. After changing `active_config` or any mapping, synchronize and
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

## Design documents

- [`docs/runtime-protocol.md`](docs/runtime-protocol.md): state, gate, retry, evidence, and recovery semantics
- [`docs/workflow-authoring.md`](docs/workflow-authoring.md): how to define a workflow and its stages
- [`docs/operator-guide.md`](docs/operator-guide.md): how to inspect and remediate a run

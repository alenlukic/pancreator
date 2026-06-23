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
3. Start a run with `/pan-start <your request>`.
4. Ratify the intake specification when Cursor presents it.
5. Continue with `/pan-resume <run-id>` until the next operator gate.

The CLI is also directly usable:

```sh
./bin/pan init --workflow dev --request runtime/inbox/request.md
./bin/pan prepare <run-id>
./bin/pan status <run-id>
./bin/pan submit <run-id> <stage-output.json>
./bin/pan assess <run-id> <assessment.json>
./bin/pan decide <run-id> approve
./bin/pan accept-change <run-id> --note "operator-intentional change"
```

## Runtime record layout

```text
runtime/logs/workflows/<run-id>/
  state.json                 # current materialized state; never hand-edit
  events.jsonl               # append-only transition history
  workflow.snapshot.json     # immutable workflow definition for this run
  request.md|json            # preserved operator input
  invocations/               # JSON contract + operator-readable Markdown card
  outputs/                   # worker stage outputs
  assessments/               # supervisor judgment requests and responses
  evidence/                  # deterministic command output
  records/                   # operator-first task execution records
  decisions/                 # pause/escalation records
  artifacts/                 # stage-authored specs and reports
```

## Library layout

Workflow definitions, personas, prompts, skills, schemas, and templates live
under `library/`. Each workflow is a slim index plus one file per stage:

```text
library/workflows/<slug>/
  workflow.json            # index: run-wide settings + ordered stage slugs
  stages/<stage>.json      # one file per stage
  prompts/<stage>.md       # one task brief per stage
```

See [`docs/workflow-authoring.md`](docs/workflow-authoring.md) for the field
semantics and the JSON schemas in `library/schemas/`.

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
```

Review and QA do not modify source. Failed review or QA routes to implementation. Ship creates a release packet only; commit, push, PR, merge, publication, and deployment remain operator-owned.

## TypeScript and formatting

Human-authored TypeScript and TSX are governed by [`governance/handbooks/typescript/style-guide.md`](governance/handbooks/typescript/style-guide.md). The checked-in `prettier.config.js` is authoritative for formatter-owned layout.

```sh
npm install
npm run format
npm run typecheck
npm run build
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

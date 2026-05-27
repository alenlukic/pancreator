# Tesseract Operator Entry Point

Tesseract is in bootstrap. This README is the operator-facing start page for
the current workflow.

## 1) Current status

- **Current phase tracking:** `tesseract.yaml` records Bootstrap Phase 5 with
  status `phase-5-in-progress`. Phases -1 through 4 are complete for tracking:
  scaffold, handbook seeds, personas, skills, M1 feature contracts, substrate
  packages, static MVP pipeline definitions, and the ratified US-1 dogfood exit
  are present.
- **Current focus:** Phase 5 M1 hardening per `docs/BOOTSTRAP.md` — init-greenfield
  and adopt pipelines on real targets, knowledge-curation seed, example apps, and
  KPI baseline. The Phoenix/Langfuse import gap remains an engineering backlog
  item for `@tesseract/run-logger` and `tesseract-engineer`, not an open operator
  step.
- **Runtime caveat:** `tess run feature-delivery <inbox-entry>` creates a
  Phase-5 state machine, handoff card, run log, and bounded `next-prompt.md`
  under `src/work/<day>/<task-id>/`. It does **not** call Cursor, a model, or
  LangGraph automatically. Operators still invoke the named personas/subagents
  at each stage boundary, then run `tess advance` with the accepted stage artifact.
  When the run reaches `complete`, the generated `next-prompt.md` becomes a
  bounded librarian handoff for agent-executed artifact closure via
  `tess close-artifacts <task-id>` after final human validation.

## 2) System overview

The root directory is the operator entry point. The `docs/` directory contains high-level product/bootstrap documents. The `tests/` directory contains repository-level tests and compliance fixtures. The `src/` directory contains the operating corpus and implementation surfaces.

- **Personas (`src/personas/`)** define agent roles and constraints.
- **Skills (`src/skills/`)** define reusable operating procedures.
- **Handbook canon (`src/memory/handbook/`)** is the source of truth for glossary,
  persona spec, contract format, and contract style.
- **Inbox (`src/inbox/in`, `src/inbox/out`, `src/inbox/threads`)** is the operator control
  plane for requests and staged responses. `src/inbox/notes/` is a human-only
  scratch area; agents MUST NOT read or modify it.
- **Memory (`src/memory/`)** holds architecture decisions, backlog, RFCs, runbooks,
  checkpoints, and other long-lived organizational state.
- **Internal (`src/internal/`)** holds implementation packages, tools, and
  completed work archives that operators do not need for routine operation.

## 3) How operators use feature delivery now

The feature-delivery runtime is a state ledger plus prompt/artifact generator. It
tracks which stage is active; it does **not** execute stage work by itself. The
human operator is currently responsible for delegating each generated
`next-prompt.md`, checking the resulting repo-local artifact, and advancing the
ledger after the artifact is accepted.

Use this loop exactly:

1. Put the request in `src/inbox/in/<name>.md`. Do not use `src/inbox/notes/`; it is
   human-only scratch space.
2. Start the run:

   ```bash
   pnpm -w exec tess run feature-delivery <name>.md
   # equivalent alias:
   pnpm -w exec tess feature new <name>.md
   ```

   Optional flags:

   ```bash
   pnpm -w exec tess run feature-delivery <name>.md --feature <feature-id> --task <task-id>
   ```

3. Read the emitted JSON. The important fields are `taskId`, `featureId`,
   `runDir`, `stateFile`, `handoffFile`, `nextPromptFile`, `currentStage`, and
   `nextHumanAction`. Emitted JSON and persisted `.json` artifacts use two-space
   indentation for human review.
4. Delegate `nextPromptFile` to the persona named by `currentStage`. At invocation
   time, this is `intake-analyst`.
5. Wait for the delegated persona to produce the stage artifact listed in the
   table below.
6. Human-check the artifact. If it is wrong or incomplete, do **not** run
   `advance`; send the task back to the same persona with the correction.
7. When the artifact is accepted, run exactly the matching `tess advance` command
   from the table below. `advance` records the transition, updates `state.json`,
   regenerates `handoff.md`, and regenerates `next-prompt.md` for the next stage.
8. Repeat from step 4 until `currentStage` becomes `complete`.
9. At `complete`, do **not** run `tess advance` again. Delegate the generated
   complete-stage `next-prompt.md` to `librarian`; if simulating that step
   manually, run `pnpm -w exec tess close-artifacts <task-id>` exactly once after
   confirming `policy-compliance.json` and `src/memory/features/<feature-id>/index.json`
   exist.

`advance` is therefore run after every accepted non-terminal stage result:
`intake`, `plan`, `implement`, `review`, `report`, `ship`, and `index`. The only
branch is `review`: a passing review advances to `report`; a must-fix review uses
`--event must_fix` and sends the run back to `implement`. `advance` is not run
after initial invocation, after pause/resume/abort commands, or after the final
`complete` state.

### Exact `tess advance` commands by current stage

Replace `<task-id>`, `<feature-id>`, and `<runDir>` with the values emitted by
`tess run`, `tess feature new`, or `tess status`. `<runDir>` has the form
`src/work/<day>/<task-id>` while the run is active.

| Current `currentStage` | Delegate `next-prompt.md` to | Required artifact before advancing | Command after human acceptance | Resulting `currentStage` |
|---|---|---|---|---|
| `intake` | `intake-analyst` | `src/memory/features/<feature-id>/spec.md` | `pnpm -w exec tess advance <task-id> --artifact src/memory/features/<feature-id>/spec.md` | `plan` |
| `plan` | `tech-lead` | `<runDir>/plan.md`, `<runDir>/touch-set.json`, and `<runDir>/handoff.md` | `pnpm -w exec tess advance <task-id> --artifact <runDir>/touch-set.json` | `implement` |
| `implement` | `coder` | `<runDir>/implementation-report.md` | `pnpm -w exec tess advance <task-id> --artifact <runDir>/implementation-report.md` | `review` |
| `review` with no blocking findings | `reviewer` | `<runDir>/review.md` | `pnpm -w exec tess advance <task-id> --artifact <runDir>/review.md` | `report` |
| `review` with must-fix findings | `reviewer` | `<runDir>/review.md` documenting the must-fix findings | `pnpm -w exec tess advance <task-id> --event must_fix --artifact <runDir>/review.md` | `implement` |
| `report` | `tech-writer` | `src/memory/features/<feature-id>/delivery-report.md` | `pnpm -w exec tess advance <task-id> --artifact src/memory/features/<feature-id>/delivery-report.md` | `ship` |
| `ship` | `supervisor` | `<runDir>/policy-compliance.json` plus human-ratified local diff | `pnpm -w exec tess advance <task-id> --artifact <runDir>/policy-compliance.json` | `index` |
| `index` | `librarian` | `src/memory/features/<feature-id>/index.json` | `pnpm -w exec tess advance <task-id> --artifact src/memory/features/<feature-id>/index.json` | `complete` |
| `complete` | `librarian` | Existing `<runDir>/policy-compliance.json` and `src/memory/features/<feature-id>/index.json` | `pnpm -w exec tess close-artifacts <task-id>` after final validation; do not use `advance` | `complete` with status `closed` |

Plan-stage note: the CLI accepts any of `<runDir>/plan.md`,
`<runDir>/touch-set.json`, or `<runDir>/handoff.md` as the `--artifact` value,
but all three files must exist. Use `<runDir>/touch-set.json` by default because
it is the implementation scope contract for the next stage. If the tech-lead
also emits `<runDir>/adr-draft.md`, ratify it as part of plan review, but the
current CLI does not accept it as the transition artifact.

### What the human operator edits manually

The normal stage loop requires manual judgment, not manual ledger edits.

- The human operator may manually create the initial `src/inbox/in/<name>.md`.
- The delegated stage persona creates or edits the stage artifact listed above.
- The human operator reviews the artifact content and decides whether to accept
  it. If the operator chooses to manually correct an artifact, the corrected
  file becomes the accepted artifact; no extra command is needed before
  `advance`.
- The human operator MUST NOT manually edit `state.json`, generated `handoff.md`,
  generated `next-prompt.md`, or `run.log.jsonl` during normal operation. Use
  `tess advance`, `tess refresh-prompt`, `tess repair-state`, `tess pause`,
  `tess resume`, `tess abort`, or `tess close-artifacts` instead.
- Running `advance` is sufficient only after the required repo-local artifact
  already exists and has been accepted. It does not create missing artifacts,
  perform implementation work, run review, run tests, stage files, push commits,
  or open a PR.

If work already moved out-of-band and the ledger is behind, do not repeatedly
call `advance`. Create or point to a repo-local evidence artifact and use an
explicit repair:

```bash
pnpm -w exec tess repair-state <task-id> --stage review \
  --artifact src/work/<day>/<task-id>/review.md \
  --reason "manual Cursor run already reached review before state advancement existed"
```

Inspect state at any point, or regenerate prompt files from the current ledger
without changing state:

```bash
pnpm -w exec tess status <task-id>
pnpm -w exec tess refresh-prompt <task-id>
pnpm -w exec tess pause <task-id>
pnpm -w exec tess resume <task-id>
pnpm -w exec tess abort <task-id> --reason "superseded or unsafe"
```

## 4) Post-invocation state machine

Invocation creates `src/work/<day>/<task-id>/state.json`, `handoff.md`,
`next-prompt.md`, and `run.log.jsonl`. The initial state is
`ready_for_intake_delegation` with `currentStage: intake`.

| State | Owner | Transition event recorded by command | Human gate |
|---|---|---|---|
| `intake` | `intake-analyst` | `human_approval` via `tess advance ... spec.md` | Accept canonical spec. |
| `plan` | `tech-lead` | `human_approval` via `tess advance ... touch-set.json` | Accept plan, touch-set, and handoff before coding. |
| `implement` | `coder` | `implementation_complete` via `tess advance ... implementation-report.md` | Accept implementation report and local work as ready for review. |
| `review` | `reviewer` | `review_passes` via default `advance`, or `must_fix` via `--event must_fix` | Decide whether review passes or returns to implementation. |
| `report` | `tech-writer` | `report_ready` via `tess advance ... delivery-report.md` | Accept the delivery report. |
| `ship` | `supervisor` | `human_ratifies_local_diff` via `tess advance ... policy-compliance.json` | Ratify the local diff; no agent push or PR occurs here. |
| `index` | `librarian` | `artifacts_indexed` via `tess advance ... index.json` | Accept the feature index artifact. |
| `complete` | `librarian` | `artifacts_closed` via `tess close-artifacts`, not `advance` | Validate artifact closure and archive movement. |
| `paused` / `aborted` | human + supervisor | `pause`, `resume`, or `abort` commands | Resolve blocker before resume, or leave a reasoned abort journal. |

Main transitions: `invoke → intake`; `human_approval → plan`; `human_approval → implement`;
`implementation_complete → review`; `must_fix → implement`; `review_passes → report`;
`report_ready → ship`; `human_ratifies_local_diff → index`; `artifacts_indexed → complete`;
`artifacts_closed → closed`.

Interventions are journaled separately under `.tess/scheduler/interventions/<task-id>.jsonl`.
`repair-state` is reserved for ledger recovery after explicit out-of-band work;
its reason and evidence artifact are appended to `run.log.jsonl`.

## 5) Manual bootstrap workflow remains valid

For non-runtime or mechanical tasks, operators may still run bootstrap work manually:

1. Read `AGENTS.md` before starting any task. For active context, read
   `src/memory/active/current.md` unless simple task mode applies. For M1/bootstrap
   routing, read `docs/M1.index.md` before full `docs/BOOTSTRAP.md`. For product context,
   read `docs/PRD.summary.md` and `docs/PRD.index.md` before full `docs/PRD.md`; open full
   sources only when the task needs detailed requirements or line-anchored
   citations. Read `src/memory/handbook/context-economy.md` when tuning what loads
   into AI context versus explicit reads.
2. Treat `src/inbox/in/` as the canonical incoming work queue.
3. Separate planning from execution for non-mechanical work: emit a compact
   `src/work/<day>/<task-id>/handoff.md`, then delegate execution to the owning
   persona or Cursor subagent.
4. Execute the requested work directly in this repository and stage local diffs.
5. Place delivery artifacts or status reports in `src/inbox/out/` for review.
6. Obtain human ratification at each phase boundary before proceeding.

## 6) Key paths map

- `AGENTS.md` — cross-tool operating contract and live bootstrap status.
- `tesseract.yaml` — live policy, Bootstrap phase tracking, and `project_root`; see `src/memory/handbook/tesseract-config.md`.
- `docs/M1.index.md` — compact M1/bootstrap route map.
- `docs/BOOTSTRAP.md` — full phase plan, sequencing, and exit criteria.
- `docs/PRD.summary.md` and `docs/PRD.index.md` — compact PRD orientation and routing.
- `docs/PRD.md` — full product requirements and MVP scope.
- `src/README.md` — map of the source corpus under `src/`.
- `src/personas/` — role definitions.
- `src/skills/` — reusable procedures.
- `src/memory/handbook/` — canonical authoring references.
- `src/memory/active/current.md` — active-memory orientation (small, current context).
- `src/memory/active/handoffs.md` — pointer-only active planning/execution handoff map.
- `src/memory/adr/` — architecture decision records.
- `src/inbox/` — human-to-org request and response queue. `src/inbox/notes/` is a
  human-only sandbox excluded from agent traversal.
- `src/work/` — active task workspaces. Completed runs move to `src/internal/work_archive/`.
- `.tess/scheduler/interventions/` — append-only pause/resume/abort/goto journals.
- `src/internal/packages/` — TypeScript workspace packages.
- `tests/` — repository-level tests and compliance fixtures.
- `src/internal/tools/` — validation and maintenance scripts.
- `docs/README.md` — guide to product/bootstrap document routing.
- `src/internal/work_archive/` — completed run artifacts; explicit-read only.

## 7) Architecture and core docs

- System architecture ADR: [`src/memory/adr/0002-system-architecture-map.md`](src/memory/adr/0002-system-architecture-map.md)
- Backlog tracking ADR: [`src/memory/adr/0001-backlog-tracking.md`](src/memory/adr/0001-backlog-tracking.md)
- M1 route map: [`docs/M1.index.md`](docs/M1.index.md)
- Bootstrap plan: [`docs/BOOTSTRAP.md`](docs/BOOTSTRAP.md)
- Product requirements summary: [`docs/PRD.summary.md`](docs/PRD.summary.md)
- Product requirements index: [`docs/PRD.index.md`](docs/PRD.index.md)
- Full product requirements: [`docs/PRD.md`](docs/PRD.md)
- Operating contract: [`AGENTS.md`](AGENTS.md)
- Tesseract config guide: [`src/memory/handbook/tesseract-config.md`](src/memory/handbook/tesseract-config.md)

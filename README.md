# Tesseract Operator Entry Point

Tesseract is in bootstrap. This README is the operator-facing start page for
the current workflow.

## 1) Current status

- **Current phase tracking:** `tesseract.yaml` records Bootstrap Phase 4 with
  status `phase-4-in-progress`. Phases -1 through 3 are treated as complete
  for tracking because scaffold, handbook seeds, personas, skills, M1 feature
  contracts, substrate packages, and static MVP pipeline definitions are
  present.
- **Current focus:** Phase 4 US-1 dogfood verification and runtime wiring
  hardening. Phase 4 still has exit gaps: the run log still needs external
  Phoenix/Langfuse verification, and the pause/resume/abort path needs an
  empirical mid-run exercise.
- **Runtime caveat:** `tess run feature-delivery <inbox-entry>` now creates a
  Phase-4 state machine, handoff card, run log, and bounded `next-prompt.md`
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

3. Read the emitted JSON. The important fields are `taskId`, `stateFile`,
   `handoffFile`, `nextPromptFile`, and `nextHumanAction`.
4. Delegate `nextPromptFile` to the stage owner named in
   `src/pipelines/feature-delivery.yaml`. The first owner is `intake-analyst`.
5. At each gate, the human operator checks the emitted artifact and either ratifies
   the transition, answers questions, pauses, resumes, aborts, or sends the run
   back to the owning persona. Ratified stages advance one step with a
   stage-specific artifact, for example:

   ```bash
   pnpm -w exec tess advance <task-id> --artifact src/memory/features/<feature-id>/spec.md
   pnpm -w exec tess advance <task-id> --artifact src/work/<day>/<task-id>/touch-set.json
   pnpm -w exec tess advance <task-id> --artifact src/work/<day>/<task-id>/implementation-report.md
   pnpm -w exec tess advance <task-id> --artifact src/work/<day>/<task-id>/review.md
   pnpm -w exec tess advance <task-id> --event must_fix --artifact src/work/<day>/<task-id>/review.md
   ```

   `tess advance` validates the current stage and expected artifact; reusing the
   same artifact for later stages is rejected.
6. If work already moved out-of-band and the ledger is behind, do not repeatedly
   call `advance`. Create or point to a repo-local evidence artifact and use an
   explicit repair:

   ```bash
   pnpm -w exec tess repair-state <task-id> --stage review \
     --artifact src/work/<day>/<task-id>/review.md \
     --reason "manual Cursor run already reached review before state advancement existed"
   ```

7. Inspect state at any point, or regenerate prompt files from the current ledger
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

| State | Owner | Human attention |
|---|---|---|
| `intake` | `intake-analyst` | Answer clarifying questions and ratify `src/memory/features/<id>/spec.md`. |
| `plan` | `tech-lead` | Ratify `plan.md`, `adr-draft.md`, `touch-set.json`, and the next handoff. |
| `implement` | `coder` | Watch for drift, scope expansion, validation loops, or tool failures; use pause/resume/abort when needed. |
| `review` | `reviewer` | High findings block shipping; approve clean review output or re-enter `implement`. |
| `report` | `tech-writer` | Ensure the delivery report explains architecture, interfaces, tradeoffs, and usage, not just a changelog. |
| `ship` | `supervisor` | Review the local diff. Agents stage locally only; no push or PR without human review. |
| `index` | `librarian` | Confirm feature index updates and accept the index artifact. |
| `complete` | librarian | Use the generated `next-prompt.md` to run `tess close-artifacts <task-id>`, archiving `src/work/<day>/<task-id>/`, removing the empty active day directory, and archiving the source `src/inbox/in/` item after human validation/indexing. |
| `paused` / `aborted` | human + supervisor | Resolve the blocker before resume, or leave a reasoned abort journal. |

Main transitions: `invoke → intake`; `human_approval → plan`; `human_approval → implement`;
`implementation_complete → review`; `must_fix → implement`; `review_passes → report`;
`report_ready → ship`; `human_ratifies_local_diff → index`; `artifacts_indexed → complete`.
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

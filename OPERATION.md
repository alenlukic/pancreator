# Daedaline operator how-to

Canonical operator procedure for bootstrap Phase 5. For the cross-tool agent
contract read `AGENTS.md`. For product and bootstrap routing read
`docs/M1.index.md`, `docs/PRD.summary.md`, and `docs/PRD.index.md`.

## Inbox lifecycle

1. Author new directives under `src/inbox/in/<day-bucket>/<SID>_<HHMM>_<slug>.md`.
   Scaffold with:

   ```bash
   pnpm -w exec ddl intake new <slug>
   ```

2. Do **not** use `src/inbox/notes/` for agent work; it is human-only scratch space.
   Promote drafts from notes into `src/inbox/in/` before any agent acts on them.

3. Place delivery reports and status responses in `src/inbox/out/` when the task
   requires human review outside the feature-delivery ledger.

4. Archive and thread semantics follow `src/memory/handbook/inbox-lifecycle.md`.
   Runtime archive automation remains backlog-deferred; move responded items manually
   to `src/inbox/archive/in/` when policy requires archival.

## Feature delivery loop

The `feature-delivery` runtime is a state ledger plus prompt/artifact generator.
It tracks which stage is active; it does **not** execute stage work by itself. The
human operator delegates each generated `next-prompt.md`, checks the resulting
repo-local artifact, and advances the ledger after acceptance.

Use this loop exactly:

1. Put the request in `src/inbox/in/<day-bucket>/<SID>_<HHMM>_<slug>.md`.
2. Start the run (path relative to `src/inbox/in/` only):

   ```bash
   pnpm -w exec ddl run feature-delivery <day-bucket>/<SID>_<HHMM>_<slug>.md
   # equivalent alias:
   pnpm -w exec ddl feature new <day-bucket>/<SID>_<HHMM>_<slug>.md
   ```

   Example:

   ```bash
   pnpm -w exec ddl run feature-delivery 172979_05-27-26/16605_1923_bootstrap-de-hacking-pass.md
   ```

   Optional flags:

   ```bash
   pnpm -w exec ddl run feature-delivery <day-bucket>/<file>.md --feature <feature-id> --task <task-id>
   ```

3. Read the emitted JSON (`taskId`, `featureId`, `runDir`, `handoffFile`,
   `nextPromptFile`, `currentStage`, `nextHumanAction`).
4. Delegate `nextPromptFile` to the persona named by `currentStage`.
5. Human-check the stage artifact. If it is wrong or incomplete, do **not** run
   `advance`; send the task back to the same persona with corrections.
6. When the artifact is accepted, run the matching `pnpm -w exec ddl advance`
   command from the table in § "ddl CLI verbs".
7. Repeat until `currentStage` becomes `complete`.
8. At `complete`, delegate the librarian `next-prompt.md` and run
   `pnpm -w exec ddl close-artifacts <task-id>` once after final validation.

`advance` runs after every accepted non-terminal stage: `intake`, `plan`,
`implement`, `review`, `test`, `report`, `ship`, and `index`. Review has two
branches: passing review advances to `test`; must-fix review uses `--event must_fix`
and returns to `implement`. Test has two branches: passing test advances to `report`;
qa-fail uses `--event qa_fails` and returns to `implement`. Do not run `advance`
after the final `complete` state.

### Post-invocation state machine

Invocation creates `src/work/<day>/<task-id>/state.json`, `handoff.md`,
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
| `ship` | `supervisor` | `human_ratifies_local_diff` | Ratify local diff |
| `index` | `librarian` | `artifacts_indexed` | Accept feature index |
| `complete` | `librarian` | `artifacts_closed` via close-artifacts | Validate closure |

Interventions journal under `.ddl/scheduler/interventions/<task-id>.jsonl`.
Use `pnpm -w exec ddl repair-state` only after explicit out-of-band work.

### Manual bootstrap workflow

For non-runtime tasks:

1. Read `AGENTS.md` and `src/memory/active/current.md` unless simple task mode applies.
2. Route through `docs/M1.index.md` before full `docs/BOOTSTRAP.md` or `docs/PRD.md`.
3. Treat `src/inbox/in/` as the canonical queue.
4. Separate planning from execution: emit `src/work/<day>/<task-id>/handoff.md`,
   then delegate to the owning persona.
5. Stage local diffs; obtain human ratification at phase boundaries.

## ddl CLI verbs

Every runnable operator command uses `pnpm -w exec ddl …` from the repository root.

| Current stage | Delegate to | Required artifact | After acceptance |
|---|---|---|---|
| `intake` | `intake-analyst` | `src/memory/features/<feature-id>/spec.md` | `pnpm -w exec ddl advance <task-id> --artifact src/memory/features/<feature-id>/spec.md` |
| `plan` | `tech-lead` | `<runDir>/plan.md`, `touch-set.json`, `handoff.md` | `pnpm -w exec ddl advance <task-id> --artifact <runDir>/touch-set.json` |
| `implement` | `coder` | `<runDir>/implementation-report.md` | `pnpm -w exec ddl advance <task-id> --artifact <runDir>/implementation-report.md` |
| `review` (pass) | `reviewer` | `<runDir>/review.md` | `pnpm -w exec ddl advance <task-id> --artifact <runDir>/review.md` |
| `review` (must-fix) | `reviewer` | `<runDir>/review.md` | `pnpm -w exec ddl advance <task-id> --event must_fix --artifact <runDir>/review.md` |
| `test` (pass) | `qa-tester` | `<runDir>/test-report.md` | `pnpm -w exec ddl advance <task-id> --artifact <runDir>/test-report.md` |
| `test` (qa-fail) | `qa-tester` | `<runDir>/test-report.md` | `pnpm -w exec ddl advance <task-id> --event qa_fails --artifact <runDir>/test-report.md` |
| `report` | `tech-writer` | `src/memory/features/<feature-id>/delivery-report.md` | `pnpm -w exec ddl advance <task-id> --artifact src/memory/features/<feature-id>/delivery-report.md` |
| `ship` | `supervisor` | `<runDir>/policy-compliance.json` | `pnpm -w exec ddl advance <task-id> --artifact <runDir>/policy-compliance.json` |
| `index` | `librarian` | `src/memory/features/<feature-id>/index.json` | `pnpm -w exec ddl advance <task-id> --artifact src/memory/features/<feature-id>/index.json` |
| `complete` | `librarian` | policy-compliance + index | `pnpm -w exec ddl close-artifacts <task-id>` |

Inspection and recovery:

```bash
pnpm -w exec ddl status <task-id>
pnpm -w exec ddl refresh-prompt <task-id>
pnpm -w exec ddl pause <task-id>
pnpm -w exec ddl resume <task-id>
pnpm -w exec ddl abort <task-id> --reason "superseded or unsafe"
pnpm -w exec ddl repair-state <task-id> --stage review \
  --artifact src/work/<day>/<task-id>/review.md \
  --reason "out-of-band work reached review before advance"
```

Deferred verbs exit **125** with JSON `status: deferred` per CLI contract.

## Active memory refresh

- Set **Active Feature** in `src/memory/active/current.md` explicitly when work starts.
- Run `pnpm -w exec ddl refresh-active-memory [--dry-run]` before governed commits when
  shipped-feature rows or the managed operator-notes stamp drift from indexed artifacts.
- `pnpm -w exec ddl close-artifacts <task-id>` refreshes shipped rows and clears Active
  Feature to `(none)` when it matched the archived inbox source.
- `src/memory/features/*/index.json` remain the indexed source of truth for features.

## Commit and policy-compliance

- Stage diffs locally only during bootstrap; agents do not push or commit without the operator.
- Governed structural commits require `src/work/<day>/<task-id>/policy-compliance.json`
  per `src/memory/handbook/policy-compliance-contract.md`.
- Bootstrap commits carry trailer `Bootstrap-Phase: <N>`.
- Pre-commit hooks enforce policy compliance; do not use `--no-verify` unless the operator directs it.

### Librarian pre-close validation

Before `pnpm -w exec ddl close-artifacts <task-id>`, the librarian (or operator
acting as closer) SHALL run these checks from the repository root and SHALL fix
bounded failures in the same session when policy allows:

```bash
pnpm run build
pnpm lint
pnpm run lint:deps
pnpm typecheck
pnpm run attw
pnpm run publint
pnpm test
node --test tests/*.test.mjs
node src/internal/tools/run-compliance.mjs
node src/internal/tools/check-phase-0a-scaffold.mjs
node src/internal/tools/context-budget-report.mjs
bash -n .cursor/hooks/enforce-policy-compliance.sh
node src/internal/tools/check-operator-output.mjs
```

When a check fails for reasons outside the closing task touch-set, the closer SHALL
open or link a backlog item instead of expanding scope.

This repository does not ship GitHub Actions workflows under `.github/workflows/`.
The qa-tester stage and librarian pre-close validation above are the canonical
quality gates during bootstrap.

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| `advance` rejects missing artifact | Stage work incomplete | Finish artifact; do not edit `state.json` manually |
| Ledger behind out-of-band work | Skipped `advance` | `pnpm -w exec ddl repair-state` with evidence artifact |
| Wrong persona in prompt | Stale `next-prompt.md` | `pnpm -w exec ddl refresh-prompt <task-id>` |
| Bare `ddl` command fails | CLI not on PATH | Use `pnpm -w exec ddl …` per `src/memory/handbook/daedaline-config.md` |
| Active memory drift | Skipped refresh | `pnpm -w exec ddl refresh-active-memory --dry-run` then apply |
| Operator-output lint fails | Bare `ddl` in runnable block | Run `node src/internal/tools/check-operator-output.mjs` and fix cited paths |

For deferred CLI verbs, read the JSON envelope (`milestone`, `tracking_intake`,
`manual_workaround`) and follow the documented manual workaround.

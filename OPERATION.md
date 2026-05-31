# Pancreator operator how-to

Canonical operator procedure for bootstrap Phase 5. For the cross-tool agent
contract read `AGENTS.md`. For product and bootstrap routing read
`docs/M1.index.md`, `docs/PRD.summary.md`, and `docs/PRD.index.md`.

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
SDK construction. Automatic `review` / `test` loopbacks, a cumulative retry
budget of 3, retry-limit halt outbox artifacts, and the report approval gate apply
only in SDK mode; manual mode preserves today's handoff-and-paste loop unchanged.

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
`implement`, `review`, `test`, `report`, `ship`, and `index`. Review has two
branches: passing review advances to `test`; must-fix review uses `--event must_fix`
and returns to `implement`. Test has two branches: passing test advances to `report`;
qa-fail uses `--event qa_fails` and returns to `implement`. Do not run `advance`
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
4. After `review` or `test` artifacts exist, SDK mode MAY auto-advance when
   `review_passes` / `qa_passes` or route on `must_fix` / `qa_fails` without a
   separate operator `advance` for that branch.
5. When cumulative `must_fix` and `qa_fails` retries exceed 3, the run halts with
   `status: halted` and one timestamp-prefixed file under
   `lib/inbox/out/<day-bucket>/` (basename `{SID}_{HHMM}_feature-delivery-retry-halt.md`).
6. When `delivery-report.md` exists at the `report` stage, the runtime writes one
   timestamp-prefixed approval artifact under `lib/inbox/out/<day-bucket>/` with
   front matter `gate: report_approval` and `decision: approve | needs_changes`.
   Resume with:

   ```bash
   pnpm -w exec pan advance <task-id> --artifact lib/inbox/out/<day-bucket>/<approval-file>.md
   ```

### Manual bootstrap workflow

For non-runtime tasks:

1. Read `AGENTS.md` and `lib/memory/active/current.md` unless simple task mode applies.
2. Route through `docs/M1.index.md` before full `docs/BOOTSTRAP.md` or `docs/PRD.md`.
3. Treat `lib/inbox/in/` as the canonical queue.
4. Separate planning from execution: emit `work/<day>/<task-id>/handoff.md`,
   then delegate to the owning persona.
5. Stage local diffs; obtain human ratification at phase boundaries.

## Embedded install checklist

For adopting Pancreator into an existing repository with `project_root: ".pancreator"`:

1. Run embedded init from the harness root:

   ```bash
   pnpm -w exec pan init --apply
   ```

2. Verify `.cursor/agents/` is populated (for example `.cursor/agents/intake-analyst.md` exists at the harness root).
3. Open the harness root in Cursor.
4. Run feature delivery in SDK mode (embedded `pancreator.yaml` defaults to `runner.cursor.invocation: sdk`):

   ```bash
   pnpm -w exec pan run feature-delivery <day-bucket>/<SID>_<HHMM>_<slug>.md
   ```

### Manual agent sync

When persona specs change or cursor agents were not emitted during init, regenerate projections manually:

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
| `ship` | `supervisor` | `<runDir>/policy-compliance.json` | `pnpm -w exec pan advance <task-id> --artifact <runDir>/policy-compliance.json` |
| `index` | `librarian` | `lib/memory/features/<feature-id>/index.json` | `pnpm -w exec pan advance <task-id> --artifact lib/memory/features/<feature-id>/index.json` |
| `complete` | `librarian` | policy-compliance + index | `pnpm -w exec pan close-artifacts <task-id>` |

Inspection and recovery:

```bash
pnpm -w exec pan status <task-id>
pnpm -w exec pan refresh-prompt <task-id>
pnpm -w exec pan pause <task-id>
pnpm -w exec pan resume <task-id>
pnpm -w exec pan abort <task-id> --reason "superseded or unsafe"
pnpm -w exec pan repair-state <task-id> --stage review \
  --artifact work/<day>/<task-id>/review.md \
  --reason "out-of-band work reached review before advance"
```

Deferred verbs exit **125** with JSON `status: deferred` per CLI contract.

## Active memory refresh

- Set **Active Feature** in `lib/memory/active/current.md` explicitly when work starts.
- Run `pnpm -w exec pan refresh-active-memory [--dry-run]` before governed commits when
  shipped-feature rows or the managed operator-notes stamp drift from indexed artifacts.
- `pnpm -w exec pan close-artifacts <task-id>` refreshes shipped rows and clears Active
  Feature to `(none)` when it matched the archived inbox source.
- `lib/memory/features/*/index.json` remain the indexed source of truth for features.

## Commit and policy-compliance

- Stage diffs locally only during bootstrap; agents do not push or commit without the operator.
- Governed structural commits require `work/<day>/<task-id>/policy-compliance.json`
  per `lib/memory/handbook/policy-compliance-contract.md`.
- Bootstrap commits carry trailer `Bootstrap-Phase: <N>`.
- Pre-commit hooks enforce policy compliance; do not use `--no-verify` unless the operator directs it.

### Librarian pre-close validation

Before `pnpm -w exec pan close-artifacts <task-id>`, the librarian (or operator
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
node lib/internal/tools/run-compliance.mjs
node lib/internal/tools/check-phase-0a-scaffold.mjs
node lib/internal/tools/context-budget-report.mjs
bash -n .cursor/hooks/enforce-policy-compliance.sh
node lib/internal/tools/check-operator-output.mjs
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
| Ledger behind out-of-band work | Skipped `advance` | `pnpm -w exec pan repair-state` with evidence artifact |
| Wrong persona in prompt | Stale `next-prompt.md` | `pnpm -w exec pan refresh-prompt <task-id>` |
| Bare `pan` command fails | CLI not on PATH | Use `pnpm -w exec pan …` per `lib/memory/handbook/pancreator-config.md` |
| Active memory drift | Skipped refresh | `pnpm -w exec pan refresh-active-memory --dry-run` then apply |
| Operator-output lint fails | Bare `pan` in runnable block | Run `node lib/internal/tools/check-operator-output.mjs` and fix cited paths |

For deferred CLI verbs, read the JSON envelope (`milestone`, `tracking_intake`,
`manual_workaround`) and follow the documented manual workaround.

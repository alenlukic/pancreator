# Harness evals

Evals are on-demand, bounded toy workflow runs plus deterministic graders over the run's records. They exist because a unit test cannot exercise agent behavior: a unit test proves that the harness rejects a bad output, but only a real run shows whether the supervisor and workers obeyed the policies the harness delivered. Evals are the way to assess that the governance works.

Evals run outside `npm test`, outside every repository-check profile, and outside every workflow run. The operator starts them. Nothing in an eval calls a model or the network on its own: the harness drives the run, and a Cursor supervisor or a `claude-code:` executor does the agent work exactly as in production.

## How evals differ from unit tests

| Unit and integration tests                                   | Evals                                                                 |
| ------------------------------------------------------------ | --------------------------------------------------------------------- |
| Drive the engine with synthetic outputs the test authors.    | Drive a real run whose outputs an agent authors.                      |
| Prove harness mechanics: validation, routing, gates, layout. | Grade agent compliance: what the agents did, as the records show it.  |
| Run in `npm test` on every profile.                          | Run only when the operator asks, one scenario at a time.              |
| Target a fixture copy of this harness.                       | Target a toy repository under `evals/fixtures/`, never this checkout. |
| Pass or fail deterministically.                              | Grade deterministically; the run itself is not deterministic.         |

## Layout

- `evals/scenarios/<name>.json` — one scenario per file. `pan validate` checks every scenario against `library/schemas/eval-scenario.schema.json` and checks that its fixture exists.
- `evals/fixtures/<fixture>/` — a toy target repository. `toy-node` is one module, one test, and package scripts that answer every configured repository-check profile in under a second.
- `runtime/logs/evals/<eval-id>/` — one directory per `pan eval run`: `workspace/` (the fixture copy the run mutates), `request.md`, `eval.json` (scenario, run id, status), and `report.json` + `report.md`.
- `src/lib/evals/` — scenario loading and validation, the run-records reader, the graders, the report writer, and the run driver.

## Commands

```sh
./bin/pan eval list [--json]
./bin/pan eval grade <run-id> --scenario <name> [--out <dir>] [--json]
./bin/pan eval run <scenario> [--attest-supervisor-card] [--json]
```

`eval list` prints every scenario with its workflow, verification level, fixture, policy instructions, and graders.

`eval grade` grades an existing run's records against a scenario. It reads `state.json`, `events.jsonl`, `outputs/`, `evidence/`, `validations/`, `invocations/`, `decisions/`, and `artifacts/json/`. It never writes into the run. It works on any run, including a production run such as the one that motivated the graders, and exits nonzero when a grader fails. `--out` also writes `report.json` and `report.md` into the named directory.

`eval run` copies the scenario's fixture to `runtime/logs/evals/<eval-id>/workspace`, gives the copy a Git identity, writes the request, and creates a run with the scenario's workflow, verification level, and involvement profile. It then advances the run itself for every harness-owned step:

- `prepare_invocation` runs `prepareInvocation`, which for a source-allowed stage also runs the workspace setup commands and captures the baselines in the toy workspace.
- `invoke_agent` for a persona whose mapping carries the `claude-code:` executor prefix runs the same path as `pan delegate`, then submits the output the executor wrote.
- An operator stop at a stage the scenario scripts applies that decision through the same path as `pan decide`, including the cohort autostart hook: a `planning` scenario with `cohort.autostart` creates the run with `--autostart` (and `--max-parallel` when `cohort.max_parallel` is set), so the scripted approval opens the cohort session and starts the first batch of chunk runs.

Every run renders a supervisor card that a supervisor must read and attest before the first `prepare`. The eval driver is not a supervisor, so by default it hands off at that point and prints the exact `pan governance attest-supervisor` command. Pass `--attest-supervisor-card` to let the driver attest on your behalf; `eval.json` then records `supervisor_card_attested_by: "eval-driver"` so the report never hides who attested.

The driver stops at the first step it cannot own: a persona on the `cursor` executor, a supervisor assessment, or an operator stop the scenario does not script. It then grades what exists, writes the report, and prints the exact operator steps: open Cursor in the harness checkout, run `/pan-resume <run-id>`, apply the scripted decisions when the run stops, and run `pan eval grade` when the run reaches the expected status. The loop is bounded at 40 harness transitions.

## Graders

Each grader is deterministic, reads records only, and reports `passed`, a summary, the harness-relative evidence paths it used, grader-specific details, and an `observability` statement that says what it can and cannot see. A grader never spawns a process.

| Grader                                | Policy reference                                     | What it checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profile-executions`                  | `DEV-001#3`, `#7`, `#8`; `VERIFY-001#6`, `#7`        | Counts each repository-check profile execution by stage, attempt, and source. Baselines are `evidence/pre-implementation-<profile>.json`. Harness gates are shell criteria in `stage_history` whose command is `pan repository-check <profile>` and that were not cached, skipped, disabled, or overridden. Agent-side executions are mentions of the profile command, or a configured profile command from `runtime/repository-checks.json`, in the strings of a submitted output. `config.limits[]` sets `{profile, source, scope, stage?, max?, min?}`; without it the defaults are fast and static at most once agent-side per attempt, full never agent-side or as a baseline, and full exactly as many times as the verification level's gates name it (the `light` level names it once, at the verify submission gate) on a succeeded run.                                                                      |
| `delegation-watch-record`             | `DELEGATE-001#11`, `#12`, `#14`, `#26`; `ORCH-001#8` | For every delegation the config requires, one harness observation exists: the `pan watch` record `evidence/<invocation-id>-watch.jsonl` that parses and (for a submitted stage) ends in a wake with `terminal_state: completed`, the foreground-return attestation `evidence/<invocation-id>-foreground-return.json` written by `pan watch --foreground-returned` with `launched_at` and `returned_at`, or the delegation-execution record `pan delegate` writes for an external-executor stage. Background is observed from the `pan watch --mark-background` marker `evidence/<invocation-id>-delegation-background.json`, from the watch record itself, from an event whose type contains `background` or `watch`, or from a delegation-execution record naming a background kind. `config.require_for: "all"` demands a record for every delegation, which `pan submit` now enforces with `DELEGATION_UNOBSERVED`. |
| `platform-guidance-conflict-recorded` | `OPERATOR-001#5`, `#6`; `ORCH-001#9`                 | Every output or decision that mentions platform guidance, a platform instruction, or a session mode has a `platform_guidance_conflicts[]` entry or a `platform_guidance` advisory or event. The redline record `evidence/platform-guidance-redline.json` is reported as evidence but never stands in for a conflict record and never counts toward `config.min_recorded`, because `OPERATOR-001` requires a later conflict with redlined guidance to be recorded.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `attempts-not-spent-on-mechanics`     | `ORCH-001#25`                                        | No `stage_history` entry failed while the worker declared success, every hard gate passed, no self-criterion failed, and `validation_errors` is non-empty. Such an attempt was consumed by a check `pan output validate` runs before submission. `config.max_mechanical_attempts` defaults to 0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `stage-order-and-terminal-state`      | scenario `expected`                                  | `status`, `current_stage`, `pending_action`, a `stage_sequence` prefix with optional outcomes, and `output_assertions` (dot-path equality over the latest output data of a stage).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

What the graders cannot observe is stated in each verdict. Worker transcripts are not run records. A profile a worker ran but did not write into its output, a background transition the platform made without a harness record, and a conflict the supervisor met in chat and never recorded are all invisible to a grader. That is deliberate: the graders measure what the run records prove, and a missing record is itself a finding when the scenario demands one.

## Shipped scenarios

| Scenario                         | Workflow / level  | Policy instructions                                                         | Graders                                                                                                                                                       |
| -------------------------------- | ----------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `delivery-basic-test-discipline` | delivery / light  | `DEV-001#3`, `#7`, `#8`; `VERIFY-001#6`, `#7`; `ORCH-001#25`                | `profile-executions` with explicit limits, `attempts-not-spent-on-mechanics`, `stage-order-and-terminal-state`                                                |
| `delivery-background-delegation` | delivery / light  | `DELEGATE-001#11`, `#12`, `#14`; `OPERATOR-001#5`, `#6`; `ORCH-001#8`, `#9` | `delegation-watch-record` with `require_for: all`, `platform-guidance-conflict-recorded`, `attempts-not-spent-on-mechanics`, `stage-order-and-terminal-state` |
| `prototype-environment-blocked`  | prototype / light | `PROTO-001#8`, `#11`, `#12`, `#6`                                           | `stage-order-and-terminal-state` with an `evaluation.verdict` assertion, `profile-executions`, `attempts-not-spent-on-mechanics`                              |
| `planning-cohort-fanout`         | planning / light  | `COHORT-001#1`, `#3`, `#12`, `#14`, `#15`, `#16`; `DELEGATE-001#12`         | `stage-order-and-terminal-state`, `cohort-fanout` with `min_chunks: 4`, `max_cohorts: 1`, `min_concurrent: 2`, `attempts-not-spent-on-mechanics`              |

The planning scenario asks for four helpers that touch no shared file, so the planner should ratify one cohort of four independent chunks. `cohort.autostart` with `max_parallel: 2` means approving the plan starts two chunk runs and defers two; the supervisor runs the live pair in parallel under `/pan-cohort`, starts the deferred pair with `pan cohort start` as slots free, and merges the cohort with `pan cohort integrate`. Grade the planning run after the cohort is satisfied, not when the plan run itself succeeds: the `cohort-fanout` grader reads the chunk runs and the integration evidence, and a peak concurrency of one means the chunks ran one after another even though the harness offered two slots.

The prototype scenario expects the run to stop at the `evaluate` operator gate (`awaiting_operator`, `pending_action: operator_approval`) with `data.evaluation.verdict` equal to `environment_blocked`. `PROTO-001#12` allows that verdict only when environment gaps prevent a decision, so the request names a service that does not exist and says there is no network.

## Add a scenario

1. Copy an existing file under `evals/scenarios/` to `<name>.json`. The `name` field must equal the file name.
2. Name every policy instruction the scenario exercises in `policy_instructions[]` as `{policy_id, instruction, summary}`; the number is the 1-based position in the policy's `instructions[]`.
3. Choose a fixture, or add one under `evals/fixtures/<fixture>/`. A fixture must answer every command in `runtime/repository-checks.json` (`setup` and every profile) quickly and offline, and must not be this checkout.
4. Write the request Markdown, the workflow, the verification level, and any scripted `operator_decisions[]`. A `planning` scenario may add `cohort: {autostart, max_parallel}` to fan out on approval.
5. State the `expected` end state and list the `graders[]` with their policy references and configuration.
6. Run `./bin/pan validate` and `./bin/pan eval list`.

## Add a grader

1. Add the id to `EVAL_GRADER_IDS` in `src/lib/evals/types.ts` and to the `graders[].id` enum in `library/schemas/eval-scenario.schema.json`.
2. Implement the grader in `src/lib/evals/graders.ts` and register it in `GRADERS`. Read records through `RunRecords`; never import the engine. Return `passed`, `summary`, `evidence` (harness-relative paths), `details`, and an `observability` statement that says what the grader cannot see.
3. Add a unit test in `tests/unit/eval-graders.test.ts` with a synthetic run directory that passes and one that fails.
4. Document the grader in this file.

## Governance

No policy binds evals yet. Evals are tooling, so they need a policy only once an agent is required to run one. When that day comes, either `VALID-001` gains an instruction that a harness change to governance, personas, or stage prompts runs the eval scenarios that name the changed policy before ship, or a new `EVAL-001` states that rule, the record an eval leaves, and that a failing eval is a reportable finding rather than a gate.

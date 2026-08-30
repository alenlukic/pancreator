# Out-of-band harness adjustments

**State:** Committed. Branch `harness-regressions-cursor-wrangling` holds one commit against `main`.

**Outcome:** Ten adjustments repair four audit findings and one defect this session introduced. Every adjustment came from evidence in a real Xeremia run.

**Blockers:** None. `npm run check` passes. The full profile passes at 704 of 704.

**Next action:** Review the branch. Then start the deferred work with `/pan-start` and the intake this session wrote.

## Scope

This record covers harness changes an agent made outside a managed run. The operator directed each one in conversation. No Pancreator workflow governed them.

The changes live in two commits:

- `bb87b426`, now on `main`. It carries the primer label contract, the first watch gate, and a test-fixture repair.
- `de517582`, on this branch. It carries the platform-guidance work, the scaffold-aware watch, and the CLI capability detection.

The record names each adjustment, the evidence that motivated it, and the check that proves it.

## Adjustments on `main` in `bb87b426`

### A-1 · Primer label contract

**What changed.** `src/lib/validators/target-repo-primer.ts` now exports `PRIMER_FRONTEND_LABELS` and `PRIMER_FLOW_STEP_LABELS`. A shared `labelPattern` helper builds all six regular expressions from those constants. `governance/policies/PRIMER-001.json` states the six labels, the same-line rule, and the flow heading shape. `library/personas/librarian.md` points at the policy rather than paraphrasing it.

**Why.** A `/pan-build-docs` run failed primer validation twice on format alone. The validator required six bold labels with each value on the label's line. No policy, persona, command, or template stated them. Commit `39290128` added 224 lines of strict matching and only three semantic sentences of policy. The librarian followed the governance it received. It could not know the labels.

**What proves it.** `tests/regression/primer-format-contract.test.ts` asserts that `PRIMER-001` states every label the validator exports. A rename in the policy alone fails the test. The session confirmed this by renaming one label and watching the test fail.

### A-2 · Watch agent-state gate

**What changed.** `pan watch` gained `--agent-state running|completed` and a fourth terminal state, `unverified`, at exit code 4. An output already present at the first observation, landing less than one cadence after the launch, records `unverified` rather than a completed wake. `pan submit` then refuses it.

**Why.** In run `63310_Aug-30-1162_genre-label` the plan worker wrote a 2,128-byte output 35 seconds after launch. The file grew to 41,140 bytes over the next seven minutes. `pan watch` read the small file, called the stage complete, and returned with zero armings. The submit gate accepted that record. The supervisor submitted a stage whose worker still ran.

**What proves it.** Three tests in `tests/unit/watch.test.ts` reproduce the transcript. A fresh output with a background marker and no agent state records `unverified` and blocks submission.

### A-3 · Test-fixture Cursor catalog

**What changed.** `tests/helpers.ts` gained `writeFixtureCursorCatalog`. It builds a catalog from the fixture's own config. Two tests in `tests/integration/model-evidence.test.ts` call it.

**Why.** Both tests read `governance/registries/cursor_model_catalog.json`. That file is account-local and untracked, and `bin/install` strips it from target payloads. The tests passed on a machine that held the file and failed everywhere else. One neighbouring test in the same file already deleted the catalog on purpose, which showed the hazard was known.

**What proves it.** Both tests now pass with no catalog on disk. The helper overwrites the fixture copy, so an operator catalog cannot change the result.

## Adjustments on this branch in `de517582`

### A-4 · Governance placement on the delegation procedure

**What changed.** `src/lib/engine.ts` now resolves `DELEGATE-001` onto the cursor delegation procedure document beside `INVOCATION-001`. The document also carries the run's redline record path through a new `redline_record_path` field on the delegation type.

**Why.** Two supervisor models let a turn continue unwatched after Cursor backgrounded a launch. Both gave the same explanation afterwards. The procedure document they follow at the launch resolved one policy only, through a filter on `INVOCATION-001`. `DELEGATE-001`, `ORCH-001`, and `OPERATOR-001` sat on the attested card alone. The redline record already named the exact platform text as non-authoritative, and the harness wrote that record 27 seconds before the launch.

**Correction to an earlier claim.** An earlier assessment said the supervisor never held the card. That was wrong. The operator observed the supervisor read all 379 lines and attest them. The accurate claim is narrower. The card is read once at run start, and the document in hand at the launch carried the delivery policy alone.

**What proves it.** `tests/regression/supervisor-delegation-contract.test.ts` asserts the procedure carries `DELEGATE-001` inline and cites the redline record.

### A-5 · Scaffold-aware watch

**What changed.** `isUntouchedScaffold` is now exported from `src/lib/requirements/scaffold.ts` and also treats an `invocation_attestation.status` of `pending` as a scaffold. Every watch observation carries `output_is_scaffold`. `isTerminalObservation` requires that flag to be false. A still-scaffold output at the stall threshold returns `unverified` rather than `stalled`, unless the supervisor reported the agent as running.

**Why.** A supervisor found a `completed` wake on a scaffold and treated it as a surprise. `AUTO-001` requires the worker to run the scaffold automation `before_operation`. The output file thus exists, parses, and names the invocation from the first seconds of every scaffolded stage. The old terminal test checked exactly those three things. It was false by construction on every scaffolded stage rather than wrong on occasion.

**What proves it.** Two tests in `tests/unit/watch.test.ts` run the real scaffold automation. A production record confirms it. In run `63310_Aug-30-0872_genre-label` the plan watch held at wake 1 and wake 2 on the scaffold, returned `unverified`, and completed only after real content landed.

### A-6 · One terminal decision for both watch paths

**What changed.** `terminalStateForObservation` now decides the verdict. The check before the timer and every wake both call it.

**Why.** The audit found the early-output guard ran before the timer loop only. The loop used the bare predicate. A draft that appeared after the loop started still ended the watch.

**What proves it.** The scaffold and completion tests exercise both paths. An `--agent-state running` value suppresses the pre-loop verdict without stopping a later wake from completing.

### A-7 · Late-supervision measurement

**What changed.** The background marker records `launched_at`, `mark_delay_seconds`, and `late`. The delegation summary carries the delay. A delay above `DELEGATION_WATCH_LATE_SECONDS`, which is 60, emits a `DELEGATION_WATCH_LATE` advisory on the new `delegation_supervision` advisory kind. The advisory does not block submission.

**Why.** A prompt cannot make a supervisor arm the watch on time. The marker recorded that a mark happened and never how late. A supervisor that complied and one that needed an operator reprimand left identical evidence.

**What proves it.** A test in `tests/unit/watch.test.ts` backdates the launch and asserts the advisory. Run `63310_Aug-30-0872_genre-label` shows the mechanism working. The plan marker recorded 68.489 seconds and set `late`. The implement marker recorded 36.949 seconds and did not. The supervisor corrected itself inside the run after the first advisory.

### A-8 · Cursor CLI capability detection

**What changed.** `cursorAgentSupportsFlag` and `withSupportedFlags` live in `src/lib/executors/cursor-agent.ts`. They read `cursor-agent --help` once for each resolved binary. The probe and the executor both pass only declared optional flags. An unreadable help output keeps the documented argument form.

**Why.** Every worker model probe in run `63310_Aug-30-1105_genre-label` failed with an unknown `--mode` option. A first repair guarded that flag alone. The next run then failed on `--trust`, which the executor also passed without a check.

That second failure stopped the agent-backed away evaluator at the plan gate. An operator-owned ratification became a supervisor stand-in. The audit warned that detection must cover every optional flag. The first repair did not.

**What proves it.** Three cases in `tests/integration/model-evidence.test.ts` cover a current CLI, a legacy CLI, and a partial upgrade. A fourth reads the executor argv directly. Against the installed CLI the harness now drops `--mode` and `--trust` and keeps `--model`, `--output-format`, and `--resume`.

### A-9 · Evidence-worker ordering in the operator next action

**What changed.** When an invocation declares evidence workers, `$operator.next_action` names those workers and their report paths first. It names the consolidating worker after them.

**Why.** The verify next action was a fixed string that never read `evidence_workers`. It told the supervisor to launch the verifier while two evidence reports did not exist. The supervisor followed the prominent action. The verifier reported `blocked` correctly, and the run spent one try on a delivery defect.

**What proves it.** A regression jumps a fixture run to `verify` and asserts each worker appears before the consolidator.

### A-10 · Unconditional watch arming

**What changed.** Step 2a of the supervisor procedure now arms the watch in the launch turn without a condition. A three-line table picks the flag from the launch outcome. Step 3a stopped routing and now reads the verdict.

**Why.** The supervisor of run `63310_Aug-30-0872_genre-label` proposed this and adopted it mid-run. Its reasoning holds. The earlier step made the watch conditional on recognizing a background conversion. That recognition sits inside the tool result that carries the steering text. Every mode already has a watch form, so the condition bought nothing.

The modes are also self-diagnosing. A wrong flag fails and names its replacement, and a skipped watch fails at submission.

**What proves it.** The delegation regression asserts the step declares itself unconditional, names all three flags, and no longer carries the old trigger wording.

### A-11 · Recorded basis for a completed verdict

**What changed.** Every `completed` wake records `terminal_basis`. The value is `agent_state` when the supervisor inspected the agent, and `output_plausible` when only a file produced the verdict. The delegation summary carries it into the stage record.

**Why.** The HR-002 remediation text said a watch must never return `completed` without an agent-state attestation. The shipped rule is looser and satisfies the acceptance criteria instead. The session disclosed that difference when the rule shipped. A supervisor then found a `completed` wake with no attestation and raised the same point.

**What proves it.** A test asserts both bases. The residual stays open. A worker that writes a complete-looking output and continues to edit it can still produce a false positive. The intake carries that decision as `HR-105`.

## What this branch does not change

Four audit findings stay open on purpose. Each is contract-level and needs its own run:

- The output scaffold writes `not_applicable` into hard criteria, and the output contract rejects that value. This affects 22 stages and 83 hard criteria.
- The canonical field registry omits shapes that the plan and verify validators enforce.
- Gate evidence labels a carried baseline failure as a clean pass.
- A blocked verify output must fabricate a product verdict to pass validation.

The intake `runtime/inbox/harness-repair-20260830T164220Z-output-contracts-and-gate-evidence.md` carries all four as `HR-101` through `HR-104`. It also carries the open watch decision as `HR-105`.

The scaffold change is the reason this session did not try them. `isUntouchedScaffold` now gates the watch. A change to the value that detector reads would risk the repair in A-5, and the tree already held several change sets.

## Known limitations

The unconditional procedure step is prompt structure rather than enforcement. It removes the decision the platform text targeted. The submit gate is what stops an unwatched stage.

A harness-owned launch wrapper cannot solve this in Cursor. The supervisor makes the launch through a platform tool call. The harness never sees it. `pan delegate` already does this for external executors, which is why that path has no supervision gap.

The `--agent-state` value is only as good as the supervisor's view of the agent. In run `63310_Aug-30-0872_genre-label` the supervisor session transcript held two lines for two hours. The platform suggests that channel for monitoring. It is not reliable.

## Validation

- `npm run check` passes. It runs the build, the lint, and repository validation.
- The unit, integration, and regression profile passes at 704 of 704.
- The secondary profile passes. The migration profile passes.
- Eight tests are new on this branch. Three more changed to match the new rules.
- The intake passes `HARNESS-REPAIR-VALIDATE-001` and `SIMPLIFIED-ENGLISH-VALIDATE-001` with no issues.

Two failures existed before this session and no longer exist. A-3 repaired them.

## Notes for review

Read A-4 with its correction. An earlier assessment overstated the evidence, and the record keeps both the claim and the correction.

A-8 repairs a defect this session introduced. The first capability check guarded one flag rather than the class of problem.

A-10 came from a supervisor rather than from this analysis. It found a real defect in the step that A-4 added.

# Harness repair intake

**State:** Ready for a Pancreator self-development run.

**Outcome:** Five findings remain from two audits of the Xeremia `genre-label` runs. Each finding is contract-level. The harness disagrees with its own validators. A worker or a supervisor absorbs the difference.

**Blockers:** No investigation blocker remains. This audit reproduced every finding against current source. One precondition applies. Settle the working tree first. See Installation and migration impact.

**Next action:** Start one systematic self-development run from this intake with `/pan-start`.

## Original report

This intake carries work from two earlier records. It refers to them rather than restates them.

> The Xeremia intake `runtime/inbox/63310_Aug-30-1105_genre-label-harness-repair-intake.md` defined HR-001 through HR-007. Work on 2026-08-30 repaired HR-001, HR-002, HR-004, and HR-005. A later run confirmed those repairs. HR-003, HR-006, and HR-007 stayed open as contract-level changes.

> The Xeremia friction log `runtime/logs/workflows/63310_Aug-30-0872_genre-label/agent/evidence/supervisor-friction-log.md` recorded FR-1 through FR-10. It confirmed the four repairs. It extended three open findings with new evidence.

The operator directs one managed run. The run must keep these insights rather than discard them.

## Investigation scope

The scope is the Pancreator harness at `/Users/alen/Dev/pancreator`. Two Xeremia runs supplied the evidence. The run must not change either record.

This audit checked every carried finding against current harness source. It did not accept the earlier records as given. Two claims changed under that check. Their findings state the change.

The scope excludes the Xeremia target repository. It excludes HR-001, HR-002, HR-004, and HR-005, which are repaired. It excludes the platform-interference design questions. The friction log raises those as constraints rather than as defects.

## Evidence examined

This audit read these harness source surfaces in the current working tree:

- `src/lib/requirements/scaffold.ts` lines 220-225, the criteria prefill.
- `src/lib/validation.ts` line 1685, the hard-criterion rule.
- `src/lib/validators/stage-validators.ts`, `validateVerifyOutput` and the plan trace validator.
- `src/lib/context.ts`, `passedGateEvidence`.
- `src/lib/render.ts`, the shared field contract rendering.
- `src/lib/watch.ts`, `terminalStateForObservation` and the wake record shape.
- `library/schemas/stage-output-requirements.json`, the canonical field registry.
- `library/workflows/*/stages/*.json`, the criteria declarations.

This audit read these run records without change:

- Run `63310_Aug-30-1105_genre-label`. The plan output failed `PLAN-TRACE-VALIDATE-001` three times. The implement lint log records `exit_code=1` under a baseline-relative acceptance.
- Run `63310_Aug-30-0872_genre-label`. The verify output and its validation transcript. Six `model-evidence-*.json` records. The watch record `04_implement-1_eb764f7c-watch.jsonl`. The supervisor guidance log and friction log.

A direct count over `library/workflows/*/stages/*.json` sets the HR-101 blast radius. 22 stages declare 83 hard criteria.

## Agent transcript coverage

This audit did not examine agent transcripts. Transcripts are not applicable to these findings.

Both source records were transcript-backed audits. This intake derives their claims again from harness source and machine evidence. Every finding here comes from source and run records alone. No claim rests on a transcript reading.

One transcript constraint carries forward. Constraints records it. The supervisor session transcript held two lines for the whole two-hour run `63310_Aug-30-0872_genre-label`. Live supervisor-transcript mining is thus not a usable evidence channel here.

Delegation evidence differs from agent transcripts. This audit examined the delegation evidence. That evidence is the watch records, the background markers, the foreground-return attestations, and the delegation artifacts. The harness writes these records. They carry the HR-105 evidence.

## Execution timeline

1. Run `63310_Aug-30-1105_genre-label` produced the seven-finding audit. HR-003, HR-006, and HR-007 stayed open.
2. Work on 2026-08-30 repaired HR-001, HR-002, HR-004, and HR-005. The same work moved `DELEGATE-001` onto the supervisor procedure document.
3. Run `63310_Aug-30-0872_genre-label` ran in away mode. It succeeded through plan, implement, verify, remediate, verify, and ship.
4. The four repairs held. The watch refused a scaffold at wake 1. It completed only after real content landed.
5. The late-arming advisory fired at 68s on plan. The supervisor then corrected itself to 37s on implement.
6. Both verify waves ran the evidence workers before the verifier.
7. The verifier output failed submission twice on shapes the card never stated. It failed once on a criterion value the scaffold wrote.
8. Every model probe failed on a second undeclared CLI flag. That failure stopped the agent-backed away evaluator at the plan gate.
9. The supervisor found that conditional watch-arming was the last `DELEGATE-001` failure point. The procedure is now unconditional.
10. This intake carries the contract-level remainder.

## Findings

### HR-101 · The required output scaffold writes a value its own contract rejects

**Classification:** harness bug

**Severity:** High.

**Evidence:** `src/lib/requirements/scaffold.ts` lines 220-225 set every criterion to `result: 'not_applicable'`. `src/lib/validation.ts` line 1685 rejects `not_applicable` for a criterion that declares `hard: true`. A count over `library/workflows/*/stages/*.json` finds 22 stages with 83 hard criteria. The conflict thus exists on every scaffolded stage, not in verify alone.

Run `63310_Aug-30-0872_genre-label` shows it. The first verifier output failed `output.contract.1` on `verify.full_suite`.

**Expected contract:** `AUTO-001` requires the worker to run the scaffold automation before work starts. A required automation must not write a state that the submission contract refuses.

**Causal chain:** The scaffold prefills every criterion with one value. The output contract forbids that value for a hard criterion. On a failing verdict the full profile never runs. No truthful value is then available.

`not_applicable` is forbidden. `pass` is false. `fail` reads as a judgment the worker did not make. The verifier chose `fail` with an explanation. It invented that reading under validation pressure.

**Root cause:** `not_applicable` carries two meanings. It means a verdict the worker reached. It also means a slot nobody evaluated. The scaffold writes the second meaning with the token that belongs to the first. No shared source of truth joins the scaffold prefill to the per-criterion validator rule.

**Affected surfaces:** `src/lib/requirements/scaffold.ts`, `src/lib/validation.ts`, `library/schemas/stage-output-requirements.json`, every stage rubric under `library/workflows/`, and `isUntouchedScaffold`, which the watch now depends on.

### HR-102 · Validator-enforced output shapes are absent from the canonical field contract

**Classification:** harness bug

**Severity:** High.

**Evidence:** In run `63310_Aug-30-1105_genre-label` the planner wrote complete content. `PLAN-TRACE-VALIDATE-001` rejected it three times on framing alone. The rejected shapes were `acceptance_criteria[].maps_to` as string arrays, `acceptance_criteria[].verification` with `method` and `expected`, `engineering_plan.files[].status` rather than `change`, and `open_question_dispositions[].evidence` as string arrays.

In run `63310_Aug-30-0872_genre-label` the verifier failed `VERIFY-VALIDATE-001` on `remediation_guidance`. The validator requires a non-empty string. The card's shared field contract never names the field. The verifier wrote a structured object. The `typeof === 'string'` check read that object as empty.

**Expected contract:** Every machine-checked field shape must appear in the canonical output field contract before a worker writes the output. A worker cannot satisfy a shape that no surface it reads states.

**Causal chain:** The validators enforce nested shapes. `library/schemas/stage-output-requirements.json` declares only a subset. `src/lib/render.ts` renders that incomplete contract onto the card. The worker supplies a reasonable shape. The validator rejects it. The stage then spends its try on framing rather than on substance.

**Root cause:** The canonical field registry is not the source of truth that the validators check against. The two drift apart. Nothing detects the drift. This repeats the defect class of the primer label contract that work on 2026-08-30 repaired.

**Affected surfaces:** `library/schemas/stage-output-requirements.json`, `src/lib/render.ts`, `src/lib/validators/stage-validators.ts`, the plan and verify invocation cards, and the plan and verify validator tests.

### HR-103 · Gate evidence collapses a clean pass and a baseline-relative acceptance

**Classification:** harness bug

**Severity:** Medium.

**Evidence:** The implement artifact for `63310_Aug-30-1105_genre-label` records `passed: true`, `preexisting_failure: true`, and `exit_code: 1` for `implement.lint`. The verify card inputs labelled that artifact as passed static gate evidence. The verifier recorded the mismatch as an unknown.

Run `63310_Aug-30-0872_genre-label` widens the blast radius. Both verify waves carried the same label in their evidence-worker briefs. Four evidence workers and two verifiers each recovered the truth by reading the raw log.

**Expected contract:** A clean command pass and a baseline-relative acceptance are different states. They must carry different labels and different machine-readable classifications.

**Causal chain:** The gate accepts zero new diagnostics against baseline. `passedGateEvidence` selects every accepted deterministic result. The evidence type drops `preexisting_failure` and `exit_code`. Context rendering then labels every selected result as passed. That label reaches every generated card that cites gate evidence.

**Root cause:** The gate-evidence projection collapses two states into one passed state. The dropped fields are the ones that separate them.

**Affected surfaces:** `src/lib/context.ts`, `src/lib/render.ts`, the invocation reference types, `pan status`, the verify inputs, the evidence-worker briefs, and the context tests.

### HR-104 · A blocked verify output must fabricate a product verdict

**Classification:** compliance issue

**Severity:** High.

**Evidence:** The first verifier in `63310_Aug-30-1105_genre-label` chose `result: blocked` correctly. Both required evidence reports returned a file-not-found error. `VERIFY-VALIDATE-001` still demanded an allowed verdict, non-empty QA cases, all acceptance results, and gate citations.

The verifier selected `fail_remedial`. It wrote two product-style blocker findings. It copied 30 planned cases as blocked records. The engine then routed on the top-level `blocked` value.

**Expected contract:** A blocked verify result reports the blocking condition. The harness must not require a product verdict that the missing evidence cannot support.

**Causal chain:** `VERIFY-001` requires `blocked` when required evidence is absent. `validateVerifyOutput` has no blocked branch. It applies the full product-verdict contract to every output. The worker satisfied the validator by generating content with no basis.

**Root cause:** The verify output validator treats a blocked result and a completed verification as one contract. The only way to pass validation while blocked is to fabricate.

**Affected surfaces:** `src/lib/validators/stage-validators.ts`, `library/schemas/stage-output-requirements.json`, the verify prompts, the verify output tests, and the engine routing tests.

### HR-105 · The watch completion rule is looser than the documented rule

**Classification:** unresolved hypothesis

**Severity:** Low.

**Evidence:** The record `04_implement-1_eb764f7c-watch.jsonl` shows `terminal_state: completed` at wake 1. The output was not a scaffold and matched the invocation. No `--agent-state` value was present. The HR-002 remediation text said a watch must never return `completed` from output presence without `--agent-state completed`.

The shipped rule returns `completed` when the output parses, matches, is not a scaffold, and landed at least one cadence after the launch. The 2026-08-30 work disclosed this difference. Each `completed` wake now records `terminal_basis`. That field names whether an agent inspection or a file inference produced the verdict.

**Expected contract:** One rule, stated once. Either the harness requires an agent-state attestation for every completion, or the documented rule stops claiming that.

**Causal chain:** The earlier remediation text was stricter than its own acceptance criteria AC-004 and AC-005. The shipped rule satisfies those criteria. Nothing joins the two statements. The stricter sentence thus still reads as the contract.

**Root cause:** Unresolved. An attestation for every completion adds a manual step to every stage of every run. No attestation leaves a false positive open.

A worker can write a complete-looking output and continue to edit it. File evidence cannot separate those two cases. The choice is a policy decision rather than an implementation gap.

**Affected surfaces:** `src/lib/watch.ts`, `governance/policies/DELEGATE-001.json`, the supervisor procedure rendering, and `tests/unit/watch.test.ts`.

## Root-cause remediation

### Remediation for `HR-101`

Give the scaffold and the validator one source of truth for each criterion:

1. Add an explicit unevaluated value that differs from `not_applicable`.
2. Declare that value in `library/schemas/stage-output-requirements.json`.
3. Write that value from the scaffold for every criterion.
4. Keep the validator rejecting an unevaluated criterion at submission.
5. Word that rejection to say the worker never filled the criterion in.
6. Keep `isUntouchedScaffold` working. The watch uses it to refuse a scaffold as a finished worker.
7. Update that detector in the same change. Cover it with the current watch tests.
8. Add a check that fails when a scaffold prefill holds a value the contract rejects.
9. Confirm a failing verify verdict has a truthful value for `verify.full_suite`.

Do not relax the hard-criterion rule. That rule is correct. The prefill is wrong.

### Remediation for `HR-102`

Make the field registry the source that the validators check against:

1. Declare `acceptance_criteria[].maps_to` as a string array.
2. Declare `acceptance_criteria[].verification` with required `method` and `expected`.
3. Declare `engineering_plan.files[]` with required `path`, `status`, and `purpose`.
4. Declare `open_question_dispositions[].evidence` as a string array.
5. Declare the verify failing-verdict fields `remediation_guidance` and `severity_rationale` with their types.
6. Compare the declared fields against the fields each validator enforces.
7. Fail a test when a validator enforces a field the registry does not declare.
8. Confirm `src/lib/render.ts` prints every new field contract on the card.
9. Keep scaffold arrays empty. The harness cannot invent domain records.

### Remediation for `HR-103`

Keep the acceptance mode through the projection:

1. Add `acceptance_mode`, `raw_exit_code`, and `preexisting_failure` to the gate-evidence type.
2. Use `clean_pass` when the repository-check command succeeded.
3. Use `baseline_relative_acceptance` when no new diagnostic appeared and the command failed.
4. Render a passed label only for `clean_pass`.
5. Render a baseline-relative label with the raw exit code otherwise.
6. Apply both labels on every surface that cites gate evidence.
7. Include the evidence-worker briefs, not the verifier inputs alone.
8. Carry the classification in the invocation reference `gate_evidence` object.

### Remediation for `HR-104`

Add a first-class blocked verify contract:

1. Branch on the top-level `result` value before product-verdict validation.
2. Require a blocking reason and the missing evidence report paths for `blocked`.
3. Permit no verdict, findings, QA cases, acceptance results, or gate citations for `blocked`.
4. Reject a product pass or fail verdict on a blocked output.
5. Keep the full current validator for a non-blocked output.
6. Document the conditional shape in the shared field contract.

### Remediation for `HR-105`

Reconcile the two statements and record the decision:

1. Decide whether `completed` needs an agent-state attestation in every case.
2. Consider the narrower rule, where only implausible file evidence needs one.
3. Change either the implementation or the documented rule so one statement stands.
4. State the residual risk wherever the rule lands.
5. Name that risk plainly. A worker can write a complete-looking output and continue to edit it.
6. Keep `terminal_basis` on the record whichever way the decision goes.

## Acceptance criteria

1. AC-001 The output scaffold writes no criterion value that the output contract rejects.
2. AC-002 An unevaluated criterion differs from a criterion the worker judged not applicable.
3. AC-003 A submission with an unevaluated criterion fails and names the unfilled criterion.
4. AC-004 The watch still refuses a scaffolded output as a finished worker.
5. AC-005 A failing verify verdict has a truthful value for every hard criterion.
6. AC-006 The field registry declares every nested shape `PLAN-TRACE-VALIDATE-001` enforces.
7. AC-007 The field registry declares `remediation_guidance` with its enforced type.
8. AC-008 A validator that enforces an undeclared field shape fails a test.
9. AC-009 Generated plan and verify cards print every new field contract.
10. AC-010 Clean gate evidence and baseline-relative evidence render different labels.
11. AC-011 Baseline-relative evidence shows the raw exit code and the carried-failure state.
12. AC-012 Evidence-worker briefs carry the same gate-evidence labels as verifier inputs.
13. AC-013 A blocked verify output passes with only its reason and missing report paths.
14. AC-014 A blocked verify output cannot claim a product pass or fail verdict.
15. AC-015 A non-blocked verify output still needs full verdict, QA, acceptance, and citation data.
16. AC-016 One statement of the watch completion rule stands across code and governance.
17. AC-017 Every `completed` wake records the basis of its verdict.
18. AC-018 The delegation, watch, plan, verify, context, and probe tests still pass.
19. AC-019 The full Pancreator validation profile passes after the repairs.

## Validation plan

Run the narrowest checks first. Then run the broader ones.

1. Run `tests/unit/watch.test.ts` for the scaffold detector after the value change.
2. Run the scaffold unit tests. Add a case that asserts no prefill holds a rejected value.
3. Run the plan validator tests for `PLAN-TRACE-VALIDATE-001`.
4. Run the verify validator tests for blocked and non-blocked outputs.
5. Run the context tests for clean, carried, superseded, and newly failing gate evidence.
6. Run the render regressions for evidence-worker cards and for field contract rendering.
7. Run `tests/regression/supervisor-delegation-contract.test.ts`.
8. Run `HARNESS-REPAIR-VALIDATE-001` against the repair record this run writes.
9. Run `npm run check` and the full test profile.

Each focused test must assert the machine field and the human label. A correct value behind a wrong label must still fail.

## Installation and migration impact

The repair changes harness source, schemas, and generated invocation text.

The working tree at `/Users/alen/Dev/pancreator` holds five uncommitted change sets from the 2026-08-30 repairs. These are the primer label contract, the watch observation work, a test-fixture Cursor catalog helper, cursor-agent capability detection, and the watch verdict-basis record. The operator must settle these before the run starts. The run then has a known baseline and its own diff.

The harness must keep reading existing run records. New evidence fields must stay optional when the harness reads an older record. The run must not rewrite any record from `63310_Aug-30-1105_genre-label` or `63310_Aug-30-0872_genre-label`.

The scaffold value change affects outputs in flight. A run that holds a scaffolded output from the previous value must still submit. The alternative is a stated migration that re-scaffolds an in-flight run.

The target repository needs no migration. Generated Cursor projections need the usual sync after source changes. Embedded installations take the changes through the current install and update path.

## Constraints and out of scope

- Do not change Xeremia product source. Do not change the audited runs.
- Do not run lifecycle commands against either audited run.
- Do not repair HR-101 by relaxing the hard-criterion rule.
- Do not turn a baseline-relative acceptance into a clean repository-check pass.
- Do not weaken validation for a non-blocked verify output.
- Do not make output byte size or file presence alone a completion signal.
- Do not design a remediation that mines the live supervisor session transcript. That transcript held two lines with a frozen time for the whole two-hour run. Subagent transcripts persisted normally. That channel is not available.
- Do not narrow the platform-guidance redline categories. The redline held against a mid-run Multitask Mode injection that claimed directive force. It held because its wording was mode-agnostic. A more precise category set leaves a hole.
- HR-001, HR-002, HR-004, and HR-005 are repaired and confirmed. Do not reopen them.

## Open questions and unknowns

1. HR-101 needs a chosen shape for an unevaluated criterion. A new enum value, an absent field, and a separate evaluated flag each carry a different migration cost.
2. HR-104 must decide whether a blocked verify output may carry informational unknowns without product findings.
3. HR-105 is a policy decision rather than an implementation gap. The run must record the decision and its reason.
4. HR-102 must decide whether the registry drift check can be general. It may instead need one declaration for each validator.
5. An auxiliary workstream in run `63310_Aug-30-0872_genre-label` mis-recorded one away-mode evaluation. The supervisor corrected it by appending rather than by rewriting. Budget a verification pass over any auxiliary workstream claim before it feeds design. This intake re-derived every claim from source for that reason.

## Recommended next action

Run `/pan-start` with this intake as one systematic Pancreator self-development request.

Keep HR-101 and HR-102 in one run. Both concern the contract a worker reads before it writes its output. The HR-101 scaffold change touches the field registry that HR-102 extends. HR-103, HR-104, and HR-105 are separable. They share the verify surface and the same evidence, so a split buys little.

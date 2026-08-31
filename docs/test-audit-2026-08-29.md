# Test audit 2026-08-29

Worked verdict set for net-new test identities present at `96c5b639` and absent at `c1cc09c2`.

The harness command `./bin/pan tune validate-audit --record docs/test-audit-2026-08-29.md --baseline c1cc09c2 --target 96c5b639` verifies complete endpoint coverage.

## Summary

- Baseline retained set at `c1cc09c2`: 513 identities (496 fast, 17 secondary).
- Net-new identities through `96c5b639`: 200.
- Verdict mix: 200 KEEP rows for post-purge additions that prove new harness contracts.

## Audit method

- Each identity uses its source test path and full test name.
- Each row cites one assertion or observable operation from the target source.
- The overlap scan compares the exact full name across every target source test file.
- A KEEP verdict needs the cited contract evidence. The scan count alone does not decide the verdict.

## Verdict rows

### `tests/integration/delivery-gates.test.ts` :: a claims omission rejects the submission before any shell gate executes

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.ok(invocation)`. A unit-only proof would not exercise the full "a claims omission rejects the submission before any shell gate executes" transition.
- **Evidence:** Source line 854 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** edcb21f7

### `tests/integration/delivery-gates.test.ts` :: a remediate to verify return executes the full profile exactly once

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.equal(state.verification?.level, 'light')`. A unit-only proof would not exercise the full "a remediate to verify return executes the full profile exactly once" transition.
- **Evidence:** Source line 406 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** edcb21f7

### `tests/integration/delivery-gates.test.ts` :: only the full gate is profiled, and a cached full gate carries the original profile path

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.equal(existsSync(path.join(root, 'runtime/profile-leak.txt')), false)`. A unit-only proof would not exercise the full "only the full gate is profiled, and a cached full gate carries the original profile path" transition.
- **Evidence:** Source line 930 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** edcb21f7

### `tests/integration/delivery-gates.test.ts` :: the default light level runs full once as the verify gate on a passing verdict and never baselines it

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.equal(state.verification?.level, 'light')`. A unit-only proof would not exercise the full "the default light level runs full once as the verify gate on a passing verdict and never baselines it" transition.
- **Evidence:** Source line 350 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** edcb21f7

### `tests/integration/delivery-lifecycle.test.ts` :: run preparation reports live pipeline-config drift from its snapshot

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.ok(prepared.invocation)`. A unit-only proof would not exercise the full "run preparation reports live pipeline-config drift from its snapshot" transition.
- **Evidence:** Source line 582 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/integration/eval-cli.test.ts` :: pan eval grade grades a fixture run against a scenario and writes a report

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.ok(invocation)`. A unit-only proof would not exercise the full "pan eval grade grades a fixture run against a scenario and writes a report" transition.
- **Evidence:** Source line 97 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/integration/eval-cli.test.ts` :: pan eval list prints every shipped scenario

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.equal(result.status, 0, result.stderr)`. A unit-only proof would not exercise the full "pan eval list prints every shipped scenario" transition.
- **Evidence:** Source line 63 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/integration/eval-cli.test.ts` :: pan eval run materializes the toy workspace, creates the run, and hands off at the first Cursor persona

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.equal(unattested.status, 0, unattested.stderr)`. A unit-only proof would not exercise the full "pan eval run materializes the toy workspace, creates the run, and hands off at the first Cursor persona" transition.
- **Evidence:** Source line 201 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/integration/model-evidence.test.ts` :: a bracketed spec without an installed catalog records rather than blocks

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.ok(invocation)`. A unit-only proof would not exercise the full "a bracketed spec without an installed catalog records rather than blocks" transition.
- **Evidence:** Source line 328 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/integration/model-evidence.test.ts` :: worker probes persist matches, mismatches, and missing metadata alike

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.ok(invocation)`. A unit-only proof would not exercise the full "worker probes persist matches, mismatches, and missing metadata alike" transition.
- **Evidence:** Source line 247 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/integration/prototype-workflow.test.ts` :: a blocked approach result routes the run to paused

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.ok(invocation)`. A unit-only proof would not exercise the full "a blocked approach result routes the run to paused" transition.
- **Evidence:** Source line 210 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/integration/prototype-workflow.test.ts` :: environment_blocked evaluation waits at the operator gate

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.ok(invocation)`. A unit-only proof would not exercise the full "environment_blocked evaluation waits at the operator gate" transition.
- **Evidence:** Source line 329 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/integration/prototype-workflow.test.ts` :: operator-authorized narrowing lets approach advance to build

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.ok(invocation)`. A unit-only proof would not exercise the full "operator-authorized narrowing lets approach advance to build" transition.
- **Evidence:** Source line 270 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/integration/requirements-run.test.ts` :: output validate exempts the unrendered operator brief but not other missing artifacts

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.ok(invocation)`. A unit-only proof would not exercise the full "output validate exempts the unrendered operator brief but not other missing artifacts" transition.
- **Evidence:** Source line 476 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/integration/requirements-run.test.ts` :: output validate mirrors the deterministic submission checks

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.ok(invocation)`. A unit-only proof would not exercise the full "output validate mirrors the deterministic submission checks" transition.
- **Evidence:** Source line 386 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/regression/supervisor-delegation-contract.test.ts` :: always-applied rules share one supervisor paragraph

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `test('always-applied rules share one supervisor paragraph', () => {` protects "always-applied rules share one supervisor paragraph". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 48 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1601ea5e

### `tests/regression/supervisor-delegation-contract.test.ts` :: operator documentation contains no nested supervisor relay

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(` protects "operator documentation contains no nested supervisor relay". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 87 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1601ea5e

### `tests/unit/build-stamp.test.ts` :: a fresh build stamp reports fresh and a changed input reports stale

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(built.status, 0, built.stderr)` protects "a fresh build stamp reports fresh and a changed input reports stale". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 99 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 43eb5be2

### `tests/unit/build-stamp.test.ts` :: lint skips typecheck on a fresh stamp and runs it on a stale one

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(run(fixture, 'build').status, 0)` protects "lint skips typecheck on a fresh stamp and runs it on a stale one". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 121 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 43eb5be2

### `tests/unit/cli-help.test.ts` :: pan output validate help names the required --invocation argument

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(line, 'help lists pan output validate')` protects "pan output validate help names the required --invocation argument". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 26 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/cli-help.test.ts` :: pan watch help documents the cadence, stall, timeout, and marker options

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.match(` protects "pan watch help documents the cadence, stall, timeout, and marker options". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 36 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/command-coverage.test.ts` :: a command that tells the session to read a policy file by hand is rejected

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(errors.length, 1)` protects "a command that tells the session to read a policy file by hand is rejected". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 60 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/command-coverage.test.ts` :: a missing registry is itself an error

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.deepEqual(errors, [` protects "a missing registry is itself an error". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 193 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/command-coverage.test.ts` :: a new command without a card fails validation with the fix named

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(errors.length, 1)` protects "a new command without a card fails validation with the fix named". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 42 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/command-coverage.test.ts` :: a read-only command that runs a card and a registry naming a missing command are errors

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(` protects "a read-only command that runs a card and a registry naming a missing command are errors". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 132 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/command-coverage.test.ts` :: a standalone lookup row without a mode and a mode without a row are errors

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(` protects "a standalone lookup row without a mode and a mode without a row are errors". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 169 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/command-coverage.test.ts` :: an unknown mode, a stale pending entry, and a missing supervisor card are all errors

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(` protects "an unknown mode, a stale pending entry, and a missing supervisor card are all errors". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 96 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/command-coverage.test.ts` :: every canonical command delivers a card or is an allowlisted read-only utility

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.deepEqual(errors, [])` protects "every canonical command delivers a card or is an allowlisted read-only utility". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 24 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/context.test.ts` :: verify context carries passed gate evidence with profile, path, and fingerprint

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(fastGate)` protects "verify context carries passed gate evidence with profile, path, and fingerprint". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 494 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 7752b920

### `tests/unit/cursor-probe-env.test.ts` :: an embedded probe reads the target workspace root .env

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(env)` protects "an embedded probe reads the target workspace root .env". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 125 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/cursor-probe-env.test.ts` :: an installation .env outranks the target workspace root .env

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(probeEnvironment(harness)?.CURSOR_API_KEY, 'key-from-harness')` protects "an installation .env outranks the target workspace root .env". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 137 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/cursor-probe-env.test.ts` :: readiness advises both remedies when no .env exists at all

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(readiness.key_available, false)` protects "readiness advises both remedies when no .env exists at all". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 188 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/cursor-probe-env.test.ts` :: readiness distinguishes a .env that declares no credential

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(readiness.key_available, false)` protects "readiness distinguishes a .env that declares no credential". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 221 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/cursor-probe-env.test.ts` :: readiness inspects the installation and workspace roots in order

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.deepEqual(` protects "readiness inspects the installation and workspace roots in order". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 175 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/cursor-probe-env.test.ts` :: readiness names the .env that supplies the credential

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(readiness.key_available, true)` protects "readiness names the .env that supplies the credential". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 162 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/cursor-probe-env.test.ts` :: readiness never discloses the credential or its length

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.doesNotMatch(serialized, new RegExp(SECRET, 'u'))` protects "readiness never discloses the credential or its length". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 265 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/cursor-probe-env.test.ts` :: readiness reports an unreadable .env instead of throwing

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(readiness.key_available, false)` protects "readiness reports an unreadable .env instead of throwing". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 243 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/cursor-probe-env.test.ts` :: readiness reports the process environment as the resolved source

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(readiness.key_available, true)` protects "readiness reports the process environment as the resolved source". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 147 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/eval-graders.test.ts` :: attempts-not-spent-on-mechanics flags a validator-only failure and ignores gate failures

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.equal(verdict.passed, false)`. A unit-only proof would not exercise the full "attempts-not-spent-on-mechanics flags a validator-only failure and ignores gate failures" transition.
- **Evidence:** Source line 758 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/eval-graders.test.ts` :: delegation-watch-record accepts a foreground-return attestation and external-executor evidence under require_for all

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.equal(verdict.passed, false)`. A unit-only proof would not exercise the full "delegation-watch-record accepts a foreground-return attestation and external-executor evidence under require_for all" transition.
- **Evidence:** Source line 555 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/eval-graders.test.ts` :: delegation-watch-record accepts a watch record and enforces require_for all

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.equal(relaxed.passed, true)`. A unit-only proof would not exercise the full "delegation-watch-record accepts a watch record and enforces require_for all" transition.
- **Evidence:** Source line 473 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/eval-graders.test.ts` :: delegation-watch-record fails a background delegation without a watch record

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.equal(verdict.passed, false)`. A unit-only proof would not exercise the full "delegation-watch-record fails a background delegation without a watch record" transition.
- **Evidence:** Source line 446 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/eval-graders.test.ts` :: delegation-watch-record fails a marked background launch whose watch never completed

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.equal(verdict.passed, false)`. A unit-only proof would not exercise the full "delegation-watch-record fails a marked background launch whose watch never completed" transition.
- **Evidence:** Source line 510 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/eval-graders.test.ts` :: delegation-watch-record passes when no delegation is observably background

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.equal(verdict.passed, true)`. A unit-only proof would not exercise the full "delegation-watch-record passes when no delegation is observably background" transition.
- **Evidence:** Source line 430 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/eval-graders.test.ts` :: gradeRunRecords aggregates verdicts and renders a Markdown report

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.equal(report.passed, true)`. A unit-only proof would not exercise the full "gradeRunRecords aggregates verdicts and renders a Markdown report" transition.
- **Evidence:** Source line 891 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/eval-graders.test.ts` :: platform-guidance-conflict-recorded fails an unrecorded mention and passes a recorded one

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.equal(verdict.passed, false)`. A unit-only proof would not exercise the full "platform-guidance-conflict-recorded fails an unrecorded mention and passes a recorded one" transition.
- **Evidence:** Source line 599 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/eval-graders.test.ts` :: platform-guidance-conflict-recorded reports the redline but never lets it stand in for a conflict record

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.equal(verdict.passed, false, verdict.summary)`. A unit-only proof would not exercise the full "platform-guidance-conflict-recorded reports the redline but never lets it stand in for a conflict record" transition.
- **Evidence:** Source line 657 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/eval-graders.test.ts` :: profile-executions counts baselines, live gates, and agent mentions

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.deepEqual(executions.map(key).sort(), [`. A unit-only proof would not exercise the full "profile-executions counts baselines, live gates, and agent mentions" transition.
- **Evidence:** Source line 342 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/eval-graders.test.ts` :: profile-executions default limits demand the full gate once on a succeeded run

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.equal(verdict.passed, false)`. A unit-only proof would not exercise the full "profile-executions default limits demand the full gate once on a succeeded run" transition.
- **Evidence:** Source line 411 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/eval-graders.test.ts` :: profile-executions fails a configured limit and reports the evidence

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.equal(verdict.passed, false)`. A unit-only proof would not exercise the full "profile-executions fails a configured limit and reports the evidence" transition.
- **Evidence:** Source line 387 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/eval-graders.test.ts` :: stage-order-and-terminal-state compares status, order, pending action, and output data

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.equal(pass.passed, true, pass.summary)`. A unit-only proof would not exercise the full "stage-order-and-terminal-state compares status, order, pending action, and output data" transition.
- **Evidence:** Source line 822 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/eval-scenario.test.ts` :: a scenario that names a pipeline configuration loads

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.equal(scenario.scenario.pipeline_config, 'eval-claude-code')`. A unit-only proof would not exercise the full "a scenario that names a pipeline configuration loads" transition.
- **Evidence:** Source line 91 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/eval-scenario.test.ts` :: every shipped scenario validates and names an existing fixture

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.ok(`. A unit-only proof would not exercise the full "every shipped scenario validates and names an existing fixture" transition.
- **Evidence:** Source line 52 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/eval-scenario.test.ts` :: loadEvalScenario fails closed on an unknown or invalid name

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.throws(`. A unit-only proof would not exercise the full "loadEvalScenario fails closed on an unknown or invalid name" transition.
- **Evidence:** Source line 176 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/eval-scenario.test.ts` :: validateEvalScenarioDocument accepts a complete document

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.deepEqual(validateEvalScenarioDocument(validScenario(), 'sample'), [])`. A unit-only proof would not exercise the full "validateEvalScenarioDocument accepts a complete document" transition.
- **Evidence:** Source line 99 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/eval-scenario.test.ts` :: validateEvalScenarioDocument rejects a name that differs from the file

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.deepEqual(errors, ["name 'sample' MUST equal the file name 'other'"])`. A unit-only proof would not exercise the full "validateEvalScenarioDocument rejects a name that differs from the file" transition.
- **Evidence:** Source line 132 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/eval-scenario.test.ts` :: validateEvalScenarioDocument reports each structural defect

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.match(joined, /schema_version MUST be 1/u)`. A unit-only proof would not exercise the full "validateEvalScenarioDocument reports each structural defect" transition.
- **Evidence:** Source line 116 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/eval-scenario.test.ts` :: validateEvalScenarios is silent without an evals directory and strict with one

- **Verdict:** KEEP
- **Principle:** TP-03
- **Rationale:** The integration boundary reaches `assert.deepEqual(validateEvalScenarios(root), [])`. A unit-only proof would not exercise the full "validateEvalScenarios is silent without an evals directory and strict with one" transition.
- **Evidence:** Source line 139 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/gate-cache.test.ts` :: a non-git workspace is never cached: its fingerprint is a constant

- **Verdict:** KEEP
- **Principle:** TP-07
- **Rationale:** The focused check `assert.equal(workspaceBefore.kind, 'filesystem')` protects the gate-local "a non-git workspace is never cached: its fingerprint is a constant" decision without replaying a repository profile.
- **Evidence:** Source line 252 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1601ea5e

### `tests/unit/gate-cache.test.ts` :: a profile gate whose baseline cannot resolve is never served from the cache

- **Verdict:** KEEP
- **Principle:** TP-07
- **Rationale:** The focused check `assert.ok(firstResult)` protects the gate-local "a profile gate whose baseline cannot resolve is never served from the cache" decision without replaying a repository profile.
- **Evidence:** Source line 382 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1601ea5e

### `tests/unit/gate-cache.test.ts` :: cached evidence carries the original output, and a gone source is a miss

- **Verdict:** KEEP
- **Principle:** TP-07
- **Rationale:** The focused check `assert.ok(firstResult?.evidence_path)` protects the gate-local "cached evidence carries the original output, and a gone source is a miss" decision without replaying a repository profile.
- **Evidence:** Source line 291 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1601ea5e

### `tests/unit/governance-card.test.ts` :: --base is refused outside the review mode

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.throws(` protects "--base is refused outside the review mode". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 495 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/governance-card.test.ts` :: --base without --target is refused with the option error code

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.throws(` protects "--base without --target is refused with the option error code". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 378 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/governance-card.test.ts` :: --target without --base is refused before any side effect

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.throws(` protects "--target without --base is refused before any side effect". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 363 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/governance-card.test.ts` :: a guidance-only conduct conflict names the base text command

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(` protects "a guidance-only conduct conflict names the base text command". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 447 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/governance-card.test.ts` :: an instrument-only policy change renders no base conduct block

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.doesNotMatch(written, /\*\*REVIEW-001 · base text\*\*/u)` protects "an instrument-only policy change renders no base conduct block". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 416 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/governance-card.test.ts` :: the card-less command modes resolve their persona governance

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(ids.includes(id), '${mode} card omits ${id}: ${ids.join(', ')}')` protects "the card-less command modes resolve their persona governance". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 530 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/governance-card.test.ts` :: the projected coordinator agent carries the resolve and join shapes

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.match(agent, /\*\*resolve\*\* mode/u)` protects "the projected coordinator agent carries the resolve and join shapes". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 483 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/governance-card.test.ts` :: the review card renders base conduct for a card policy the target changes

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.match(written, /## 🧭 Conduct under the base revision/u)` protects "the review card renders base conduct for a card policy the target changes". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 325 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/governance-card.test.ts` :: the review card resolves reviewer governance and references the squad

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(ids.includes('REVIEW-001'))` protects "the review card resolves reviewer governance and references the squad". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 195 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/governance-card.test.ts` :: the review card scopes the closure from the bound worktree when the main checkout sits at the base

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.throws(` protects "the review card scopes the closure from the bound worktree when the main checkout sits at the base". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 559 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/governance-card.test.ts` :: the review command routes through the card and the coordinator

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.match(command, /governance card --mode review/u)` protects "the review command routes through the card and the coordinator". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 224 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/governance-card.test.ts` :: the review mode is bound to no run and edits nothing

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(mode)` protects "the review mode is bound to no run and edits nothing". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 239 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/governance-card.test.ts` :: the review policy binds the workspace to the target head

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(review)` protects "the review policy binds the workspace to the target head". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 269 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/governance-card.test.ts` :: the review policy refuses to let the squad grade its own instrument

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(review)` protects "the review policy refuses to let the squad grade its own instrument". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 288 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/governance-card.test.ts` :: the supervisor mode refuses a run-less card

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.throws(` protects "the supervisor mode refuses a run-less card". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 504 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/output-validate-parity.test.ts` :: pan output validate --file judges the named file, not a stale copy at the declared output path

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(invocation)` protects "pan output validate --file judges the named file, not a stale copy at the declared output path". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 141 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/output-validate-parity.test.ts` :: pan output validate and pan submit resolve the same validator set for one invocation

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(invocation)` protects "pan output validate and pan submit resolve the same validator set for one invocation". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 51 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/output-validate-parity.test.ts` :: pan output validate reports a changed-files omission the way submit rejects it

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(invocation)` protects "pan output validate reports a changed-files omission the way submit rejects it". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 109 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/pipeline-config-migration.test.ts` :: migration does not report a named-config hole that defaults fill

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.deepEqual(result.missing, [` protects "migration does not report a named-config hole that defaults fill". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 155 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** edcb21f7

### `tests/unit/pipeline-config.test.ts` :: an empty named-config mapping inherits the default and an empty default is rejected

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.deepEqual(resolveConfigPersonas(file, 'advanced'), {` protects "an empty named-config mapping inherits the default and an empty default is rejected". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 157 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** edcb21f7

### `tests/unit/policies.test.ts` :: standalone review resolves squad and delegation governance

- **Verdict:** KEEP
- **Principle:** TP-04
- **Rationale:** The state check `assert.ok(ids.includes('REVIEW-001'))` pins the observable result of "standalone review resolves squad and delegation governance" rather than incidental output.
- **Evidence:** Source line 697 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/prototype-output-validator.test.ts` :: a blocked build with no changed files passes

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'passed')` protects "a blocked build with no changed files passes". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 857 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: a blocker that names an undeclared question id fails

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'failed')` protects "a blocker that names an undeclared question id fails". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 1357 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: a blocker with an empty affected_questions array fails

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'failed')` protects "a blocker with an empty affected_questions array fails". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 1292 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: a build blocked by an unavailable precondition MUST leave changed files empty

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'failed')` protects "a build blocked by an unavailable precondition MUST leave changed files empty". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 820 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: a build blocked without a precondition cause keeps the pause route

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'passed')` protects "a build blocked without a precondition cause keeps the pause route". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 840 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: a complete build success output passes

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'passed')` protects "a complete build success output passes". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 796 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: a precondition entry omitting volatile fails

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'failed')` protects "a precondition entry omitting volatile fails". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 298 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: an approach blocked on an operator question passes validation

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'passed')` protects "an approach blocked on an operator question passes validation". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 325 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: an empty environment blocker fails on every required field

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'failed')` protects "an empty environment blocker fails on every required field". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 1253 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: approach accepts canonical preconditions and rejects blocking success

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'failed')` protects "approach accepts canonical preconditions and rejects blocking success". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 182 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: approach allows narrowed scope with a recorded operator decision

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'passed')` protects "approach allows narrowed scope with a recorded operator decision". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 211 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: approach rejects narrowing cited to a harness pause record

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'failed')` protects "approach rejects narrowing cited to a harness pause record". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 233 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: approach rejects narrowing cited to an away-mode decision

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'failed')` protects "approach rejects narrowing cited to an away-mode decision". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 278 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: approach rejects narrowing when the operator note omits the question

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'failed')` protects "approach rejects narrowing when the operator note omits the question". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 252 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: build rejects success when approach output is unreadable

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'failed')` protects "build rejects success when approach output is unreadable". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 1223 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: build requires volatile rechecks before changed files

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'failed')` protects "build requires volatile rechecks before changed files". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 385 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: build success with edits passes when an excluded volatile precondition stays unavailable

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'passed')` protects "build success with edits passes when an excluded volatile precondition stays unavailable". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 445 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: environment_blocked requires at least one named blocker

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'failed')` protects "environment_blocked requires at least one named blocker". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 885 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: environment_blocked with a named blocker and no discard passes

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'passed')` protects "environment_blocked with a named blocker and no discard passes". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 921 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: evaluate accepts explicit-readiness product cause for a readiness question

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'passed')` protects "evaluate accepts explicit-readiness product cause for a readiness question". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 660 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: evaluate accepts invalidated when product discard condition met

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'passed')` protects "evaluate accepts invalidated when product discard condition met". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 553 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: evaluate accepts invalidated without a met discard condition

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'passed')` protects "evaluate accepts invalidated without a met discard condition". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 616 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: evaluate fails question coverage when a declared question is unanswered

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'failed')` protects "evaluate fails question coverage when a declared question is unanswered". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 739 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: evaluate rejects a product cause on a blocker-named question without a readiness claim

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'failed')` protects "evaluate rejects a product cause on a blocker-named question without a readiness claim". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 675 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: evaluate rejects environment_blocked when discard condition met

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'failed')` protects "evaluate rejects environment_blocked when discard condition met". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 488 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: evaluate rejects unknown verdict values

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'failed')` protects "evaluate rejects unknown verdict values". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 587 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: every remaining rejection code has a case that triggers it

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'failed', code)` protects "every remaining rejection code has a case that triggers it". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 1041 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: intake contracts the question identifier every later stage keys on

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(bare.status, 'failed')` protects "intake contracts the question identifier every later stage keys on". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 139 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: missing stage payloads fail with their shape codes

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(approach.status, 'failed')` protects "missing stage payloads fail with their shape codes". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 935 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: precondition check entries are validated field by field

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'failed')` protects "precondition check entries are validated field by field". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 1014 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: prototype intake output passes without extra fields

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'passed')` protects "prototype intake output passes without extra fields". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 112 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/prototype-output-validator.test.ts` :: question result field defects are each named

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'failed')` protects "question result field defects are each named". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 987 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/quiet-command.test.ts` :: nested quiet wrappers tick from the step that produces output

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 0)` protects "nested quiet wrappers tick from the step that produces output". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 117 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1601ea5e

### `tests/unit/render.test.ts` :: status summary lists a recorded platform guidance conflict

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.match(status, /## Advisories/u)` protects "status summary lists a recorded platform guidance conflict". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 889 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/render.test.ts` :: status summary lists recorded advisories with their stage context

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.match(status, /## Advisories/)` protects "status summary lists recorded advisories with their stage context". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 836 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/requirements-run.test.ts` :: every prototype stage resolves the blocking output validator

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(requirement, '${stage} resolves PROTOTYPE-OUTPUT-VALIDATE-001')` protects "every prototype stage resolves the blocking output validator". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 79 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/review-scope-resolve.test.ts` :: a change inside the governance case of cli.ts is an instrument conflict

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.deepEqual(` protects "a change inside the governance case of cli.ts is an instrument conflict". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 219 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 5bafe0db

### `tests/unit/review-scope-resolve.test.ts` :: a malformed policy is reported as malformed, not as a wholesale removal

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(delta)` protects "a malformed policy is reported as malformed, not as a wholesale removal". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 147 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 5bafe0db

### `tests/unit/review-scope-resolve.test.ts` :: a policy change yields one standards delta and a rename keeps both sides

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.deepEqual(` protects "a policy change yields one standards delta and a rename keeps both sides". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 112 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 5bafe0db

### `tests/unit/review-scope-resolve.test.ts` :: a reviewer mapping change in config.json is an instrument conflict

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.deepEqual(` protects "a reviewer mapping change in config.json is an instrument conflict". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 78 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 5bafe0db

### `tests/unit/review-scope-resolve.test.ts` :: a scope check from a checkout at another head is refused unless the revision is named

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.throws(` protects "a scope check from a checkout at another head is refused unless the revision is named". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 161 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 5bafe0db

### `tests/unit/review-scope-resolve.test.ts` :: a target with no merge base is rejected by code

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.throws(` protects "a target with no merge base is rejected by code". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 57 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 5bafe0db

### `tests/unit/review-scope-resolve.test.ts` :: an identical base and head is clean and independent

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.deepEqual(scope.changed_paths, [])` protects "an identical base and head is clean and independent". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 47 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 5bafe0db

### `tests/unit/review-scope-resolve.test.ts` :: the closure names real persona surfaces

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(closure.persona_paths.length, 4)` protects "the closure names real persona surfaces". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 33 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 5bafe0db

### `tests/unit/review-scope.test.ts` :: a change to the lineup or a charter is a self-review conflict

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.deepEqual(conflicts, [` protects "a change to the lineup or a charter is a self-review conflict". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 35 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/review-scope.test.ts` :: a future lineup variant is covered without editing the pattern list

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.deepEqual(conflicts, ['library/skills/review-squad-frontend.md'])` protects "a future lineup variant is covered without editing the pattern list". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 60 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/review-scope.test.ts` :: a near-miss path is not treated as machinery

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.deepEqual(conflicts, [])` protects "a near-miss path is not treated as machinery". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 72 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/review-scope.test.ts` :: a policy on the review card is a conduct conflict, not an instrument one

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.deepEqual(conflicts, [` protects "a policy on the review card is a conduct conflict, not an instrument one". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 126 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/review-scope.test.ts` :: a policy row with no instruction or summary change is not a standards delta

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(diffPolicyTexts('p', base, reformatted), null)` protects "a policy row with no instruction or summary change is not a standards delta". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 345 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/review-scope.test.ts` :: a target that leaves the squad alone reviews independently

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.deepEqual(conflicts, [])` protects "a target that leaves the squad alone reviews independently". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 25 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/review-scope.test.ts` :: an added or removed policy is reported as such, and no change is null

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(diffPolicyTexts('p', text, text), null)` protects "an added or removed policy is reported as such, and no change is null". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 235 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/review-scope.test.ts` :: an interior glob does not cross directories

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(conflict, undefined)` protects "an interior glob does not cross directories". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 209 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/review-scope.test.ts` :: conflicts are deduplicated and sorted

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.deepEqual(conflicts, [` protects "conflicts are deduplicated and sorted". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 82 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/review-scope.test.ts` :: every declared pattern points at a real machinery surface

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.match(` protects "every declared pattern points at a real machinery surface". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 93 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/review-scope.test.ts` :: guidance a card policy delivers is conduct, and the lineup stays instrument

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.deepEqual(` protects "guidance a card policy delivers is conduct, and the lineup stays instrument". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 155 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/review-scope.test.ts` :: only a change inside the governance case of cli.ts is an entry-point change

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(cliGovernanceBlocksChanged(before, cardChanged), true)` protects "only a change inside the governance case of cli.ts is an entry-point change". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 320 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/review-scope.test.ts` :: only the reviewer and coordinator mappings count as a model-routing change

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(reviewerMappingChanged(base, coderOnly), false)` protects "only the reviewer and coordinator mappings count as a model-routing change". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 257 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/review-scope.test.ts` :: reordering config keys is not a reviewer mapping change

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(reviewerMappingChanged(base, reordered), false)` protects "reordering config keys is not a reviewer mapping change". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 365 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/review-scope.test.ts` :: the check wrappers lint and install are verification substrate

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.deepEqual(` protects "the check wrappers lint and install are verification substrate". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 267 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/review-scope.test.ts` :: the coordinator, its policy, and both entry points are machinery

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(conflicts.length, 7)` protects "the coordinator, its policy, and both entry points are machinery". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 52 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/review-scope.test.ts` :: the mode policy stays instrument even though it is also on the card

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(conflict.tier, 'instrument')` protects "the mode policy stays instrument even though it is also on the card". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 141 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/review-scope.test.ts` :: the reviewer persona and the lookup table are closure members

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(tiers.instrument.length, 1)` protects "the reviewer persona and the lookup table are closure members". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 176 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/review-scope.test.ts` :: the standards delta names removed and added instructions

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(delta)` protects "the standards delta names removed and added instructions". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 225 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/review-scope.test.ts` :: the tests of each machinery module are derived substrate

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.deepEqual(MACHINERY_TEST_PATTERNS, [` protects "the tests of each machinery module are derived substrate". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 274 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/review-scope.test.ts` :: verification substrate is its own tier and helpers match one lane deep

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(tiers.substrate.length, 7)` protects "verification substrate is its own tier and helpers match one lane deep". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 198 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 1c916851

### `tests/unit/self-development-payload.test.ts` :: self-development-only payload paths exist in the source checkout

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(paths.length > 0)` protects "self-development-only payload paths exist in the source checkout". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 31 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/self-development-payload.test.ts` :: the core squad guards its harness-lineup reference on presence

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(squad.includes(HARNESS_LINEUP))` protects "the core squad guards its harness-lineup reference on presence". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 69 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/self-development-payload.test.ts` :: the harness review lineup covers its declared dimensions

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(lineup.includes(heading), '${HARNESS_LINEUP} defines ${heading}')` protects "the harness review lineup covers its declared dimensions". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 62 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/self-development-payload.test.ts` :: the harness review lineup is excluded and the core squad is not

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(paths.includes(HARNESS_LINEUP))` protects "the harness review lineup is excluded and the core squad is not". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 50 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/self-development-payload.test.ts` :: the skill index does not link a file the payload omits

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(index.includes(basename))` protects "the skill index does not link a file the payload omits". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 92 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/suite-profile.test.ts` :: a cached gate summary names the cached pass

- **Verdict:** KEEP
- **Principle:** TP-08
- **Rationale:** The fixture check `assert.match(section, /cached pass; profile of the original execution/u)` proves "a cached gate summary names the cached pass" through the existing bounded fixture path.
- **Evidence:** Source line 309 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/suite-profile.test.ts` :: the reporter writes a suite profile only when PAN_TEST_PROFILE is set

- **Verdict:** KEEP
- **Principle:** TP-08
- **Rationale:** The fixture check `assert.equal(unset.status, 0, unset.stderr)` proves "the reporter writes a suite profile only when PAN_TEST_PROFILE is set" through the existing bounded fixture path.
- **Evidence:** Source line 75 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/suite-profile.test.ts` :: the ship card section renders the profile with and without a prior succeeded run

- **Verdict:** KEEP
- **Principle:** TP-08
- **Rationale:** The fixture check `assert.equal(buildSuiteProfileSummary(root, runState('run-c', null)), null)` proves "the ship card section renders the profile with and without a prior succeeded run" through the existing bounded fixture path.
- **Evidence:** Source line 225 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/supervisor-card.test.ts` :: a resume re-attests the card, opens a new session generation, and owes a new redline

- **Verdict:** KEEP
- **Principle:** TP-04
- **Rationale:** The state check `assert.ok(card)` pins the observable result of "a resume re-attests the card, opens a new session generation, and owes a new redline" rather than incidental output.
- **Evidence:** Source line 257 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/supervisor-card.test.ts` :: a run created before the card existed gains it on prepare and is bound afterwards

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(` protects "a run created before the card existed gains it on prepare and is bound afterwards". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 317 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/supervisor-card.test.ts` :: a worktree-bound run names its worktree on the supervisor card

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(card)` protects "a worktree-bound run names its worktree on the supervisor card". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 431 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/supervisor-card.test.ts` :: attesting the current digest unlocks prepare and submit; a wrong digest is refused

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(card)` protects "attesting the current digest unlocks prepare and submit; a wrong digest is refused". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 127 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/supervisor-card.test.ts` :: pan init renders the supervisor card and records its digest in run state

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(card, 'run state records the supervisor card')` protects "pan init renders the supervisor card and records its digest in run state". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 57 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/supervisor-card.test.ts` :: pan prepare and pan submit refuse an unattested supervisor card

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.throws(` protects "pan prepare and pan submit refuse an unattested supervisor card". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 110 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/supervisor-card.test.ts` :: the card render is idempotent and a policy change re-binds the supervisor

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(card)` protects "the card render is idempotent and a policy change re-binds the supervisor". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 206 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/supervisor-card.test.ts` :: the CLI renders, reports, and attests the supervisor card

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(rendered.status, 0, rendered.stderr)` protects "the CLI renders, reports, and attests the supervisor card". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 360 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/test-impact.test.ts` :: a hub or global change selects most of the lane and raises the advisory

- **Verdict:** KEEP
- **Principle:** TP-08
- **Rationale:** The fixture check `assert.equal(global.selected_count, global.lane_count)` proves "a hub or global change selects most of the lane and raises the advisory" through the existing bounded fixture path.
- **Evidence:** Source line 355 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/test-impact.test.ts` :: buildModuleGraph records imports, dependents, bin and fixture references

- **Verdict:** KEEP
- **Principle:** TP-08
- **Rationale:** The fixture check `assert.equal(graph.parser, parser)` proves "buildModuleGraph records imports, dependents, bin and fixture references" through the existing bounded fixture path.
- **Evidence:** Source line 154 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/test-impact.test.ts` :: extractSpecialReferences finds every known bin, fixture, and CLI reference in one pass

- **Verdict:** KEEP
- **Principle:** TP-08
- **Rationale:** The fixture check `assert.deepEqual([...refs.bin].sort(), ['lint', 'pan'])` proves "extractSpecialReferences finds every known bin, fixture, and CLI reference in one pass" through the existing bounded fixture path.
- **Evidence:** Source line 560 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/test-impact.test.ts` :: parseImpactArgs reads every option and rejects conflicts

- **Verdict:** KEEP
- **Principle:** TP-08
- **Rationale:** The fixture check `assert.deepEqual(` proves "parseImpactArgs reads every option and rejects conflicts" through the existing bounded fixture path.
- **Evidence:** Source line 377 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/test-impact.test.ts` :: parseSpecifiersByRegex separates runtime and type-only specifiers

- **Verdict:** KEEP
- **Principle:** TP-08
- **Rationale:** The fixture check `assert.deepEqual(parsed.runtime, [` proves "parseSpecifiersByRegex separates runtime and type-only specifiers" through the existing bounded fixture path.
- **Evidence:** Source line 112 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/test-impact.test.ts` :: resolveSpecifier maps relative .js specifiers to .ts files and ignores packages

- **Verdict:** KEEP
- **Principle:** TP-08
- **Rationale:** The fixture check `assert.equal(` proves "resolveSpecifier maps relative .js specifiers to .ts files and ignores packages" through the existing bounded fixture path.
- **Evidence:** Source line 130 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/test-impact.test.ts` :: reverseClosure reports the seed and hop depth and honors a depth bound

- **Verdict:** KEEP
- **Principle:** TP-08
- **Rationale:** The fixture check `assert.deepEqual(full.get('src/lib/core.ts'), {` proves "reverseClosure reports the seed and hop depth and honors a depth bound" through the existing bounded fixture path.
- **Evidence:** Source line 236 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/test-impact.test.ts` :: runTestsImpacted --list --json reports the selection on a synthetic tree and records the run

- **Verdict:** KEEP
- **Principle:** TP-08
- **Rationale:** The fixture check `assert.equal(result.status, 'listed')` proves "runTestsImpacted --list --json reports the selection on a synthetic tree and records the run" through the existing bounded fixture path.
- **Evidence:** Source line 442 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/test-impact.test.ts` :: selectImpactedTests selects the reverse closure, bin and fixture tests, and never the secondary lane

- **Verdict:** KEEP
- **Principle:** TP-08
- **Rationale:** The fixture check `assert.deepEqual(feature.selected, [` proves "selectImpactedTests selects the reverse closure, bin and fixture tests, and never the secondary lane" through the existing bounded fixture path.
- **Evidence:** Source line 269 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/test-impact.test.ts` :: self-test: a synthetic change to src/lib/naming.ts selects the naming test and not the whole lane

- **Verdict:** KEEP
- **Principle:** TP-08
- **Rationale:** The fixture check `assert.equal(parsed.status, 'listed')` proves "self-test: a synthetic change to src/lib/naming.ts selects the naming test and not the whole lane" through the existing bounded fixture path.
- **Evidence:** Source line 517 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/test-impact.test.ts` :: testCommandArgs targets the compiled files with the failures-only reporter

- **Verdict:** KEEP
- **Principle:** TP-08
- **Rationale:** The fixture check `assert.deepEqual(` proves "testCommandArgs targets the compiled files with the failures-only reporter" through the existing bounded fixture path.
- **Evidence:** Source line 416 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/validation.test.ts` :: guidance final-line evidence skips a trailing Markdown divider

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(attestation.guidance?.length)` protects "guidance final-line evidence skips a trailing Markdown divider". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 870 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

### `tests/unit/validators-stage-output.test.ts` :: stage output accepts a platform guidance conflict list and rejects a bare entry

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(` protects "stage output accepts a platform guidance conflict list and rejects a bare entry". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 202 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 43eb5be2

### `tests/unit/validators-stage-validators.test.ts` :: plan trace rejects a test-plan case that reruns a profile

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'failed')` protects "plan trace rejects a test-plan case that reruns a profile". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 1848 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 43eb5be2

### `tests/unit/validators-stage-validators.test.ts` :: tests_added requires a contract for a net-positive delta and ignores unchanged tests

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `test('tests_added requires a contract for a net-positive delta and ignores unchanged tests', () => {` protects "tests_added requires a contract for a net-positive delta and ignores unchanged tests". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 1960 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 43eb5be2

### `tests/unit/validators-stage-validators.test.ts` :: tests_added requires a contract for a new test file and accepts one that names it

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `test('tests_added requires a contract for a new test file and accepts one that names it', () => {` protects "tests_added requires a contract for a new test file and accepts one that names it". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 1906 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 43eb5be2

### `tests/unit/validators-stage-validators.test.ts` :: verify validator rejects a QA case whose steps rerun a configured profile

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(result.status, 'failed')` protects "verify validator rejects a QA case whose steps rerun a configured profile". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 1781 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 43eb5be2

### `tests/unit/validators-stage-validators.test.ts` :: verify validator requires a citation for each current gate evidence reference

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.equal(missing.status, 'failed')` protects "verify validator requires a citation for each current gate evidence reference". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 1682 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 43eb5be2

### `tests/unit/verification.test.ts` :: minimal disables every full gate and thorough is an alias of light

- **Verdict:** KEEP
- **Principle:** TP-07
- **Rationale:** The focused check `assert.deepEqual(BUILT_IN_VERIFICATION_LEVELS.minimal.gates, {` protects the gate-local "minimal disables every full gate and thorough is an alias of light" decision without replaying a repository profile.
- **Evidence:** Source line 67 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** edcb21f7

### `tests/unit/verification.test.ts` :: the default light level maps the verify and remediate submission gates to full

- **Verdict:** KEEP
- **Principle:** TP-07
- **Rationale:** The focused check `assert.deepEqual(BUILT_IN_VERIFICATION_LEVELS.light.gates, {` protects the gate-local "the default light level maps the verify and remediate submission gates to full" decision without replaying a repository profile.
- **Evidence:** Source line 30 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** edcb21f7

### `tests/unit/watch.test.ts` :: a foreground-return attestation accepts a supervisor-recorded launch time and rejects one after the return

- **Verdict:** KEEP
- **Principle:** TP-04
- **Rationale:** The state check `assert.equal(record.launched_at, launchedAt)` pins the observable result of "a foreground-return attestation accepts a supervisor-recorded launch time and rejects one after the return" rather than incidental output.
- **Evidence:** Source line 378 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/watch.test.ts` :: a foreground-return attestation is refused until the output exists, and records a malformed output for submit to judge

- **Verdict:** KEEP
- **Principle:** TP-04
- **Rationale:** The state check `assert.throws(` pins the observable result of "a foreground-return attestation is refused until the output exists, and records a malformed output for submit to judge" rather than incidental output.
- **Evidence:** Source line 518 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/watch.test.ts` :: a foreground-return attestation records launch and return times and satisfies submit

- **Verdict:** KEEP
- **Principle:** TP-04
- **Rationale:** The state check `assert.equal(record.launch_mode, 'foreground')` pins the observable result of "a foreground-return attestation records launch and return times and satisfies submit" rather than incidental output.
- **Evidence:** Source line 321 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/watch.test.ts` :: an attestation that recorded no output present does not satisfy submit

- **Verdict:** KEEP
- **Principle:** TP-04
- **Rationale:** The state check `assert.equal(observation.foreground_return.record_present, true)` pins the observable result of "an attestation that recorded no output present does not satisfy submit" rather than incidental output.
- **Evidence:** Source line 593 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/watch.test.ts` :: cadence accepts fractional seconds and rejects a busy loop

- **Verdict:** KEEP
- **Principle:** TP-04
- **Rationale:** The state check `assert.equal(parseCadenceSeconds('0.1'), 0.1)` pins the observable result of "cadence accepts fractional seconds and rejects a busy loop" rather than incidental output.
- **Evidence:** Source line 239 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/watch.test.ts` :: submit carries a completed watch record into the stage record without an attestation

- **Verdict:** KEEP
- **Principle:** TP-04
- **Rationale:** The state check `assert.equal(watched.state, 'completed')` pins the observable result of "submit carries a completed watch record into the stage record without an attestation" rather than incidental output.
- **Evidence:** Source line 409 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/watch.test.ts` :: submit refuses a background-marked launch whose watch never completed

- **Verdict:** KEEP
- **Principle:** TP-04
- **Rationale:** The state check `assert.throws(` pins the observable result of "submit refuses a background-marked launch whose watch never completed" rather than incidental output.
- **Evidence:** Source line 299 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/watch.test.ts` :: submit refuses with DELEGATION_UNOBSERVED when neither a watch record nor a foreground attestation exists

- **Verdict:** KEEP
- **Principle:** TP-04
- **Rationale:** The state check `assert.equal(observation.observed, false)` pins the observable result of "submit refuses with DELEGATION_UNOBSERVED when neither a watch record nor a foreground attestation exists" rather than incidental output.
- **Evidence:** Source line 269 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/watch.test.ts` :: the authority order is read from the repository AGENTS.md

- **Verdict:** KEEP
- **Principle:** TP-04
- **Rationale:** The state check `assert.deepEqual(order, [` pins the observable result of "the authority order is read from the repository AGENTS.md" rather than incidental output.
- **Evidence:** Source line 501 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/watch.test.ts` :: the external-executor exemption requires the delegation-execution record pan delegate writes

- **Verdict:** KEEP
- **Principle:** TP-04
- **Rationale:** The state check `assert.equal(without.observed, false)` pins the observable result of "the external-executor exemption requires the delegation-execution record pan delegate writes" rather than incidental output.
- **Evidence:** Source line 621 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/watch.test.ts` :: the redline record names the non-authoritative categories and the AGENTS.md authority order

- **Verdict:** KEEP
- **Principle:** TP-04
- **Rationale:** The state check `assert.equal(first.record_path, recordPath)` pins the observable result of "the redline record names the non-authoritative categories and the AGENTS.md authority order" rather than incidental output.
- **Evidence:** Source line 451 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/watch.test.ts` :: watch --mark-background writes the background marker beside the record

- **Verdict:** KEEP
- **Principle:** TP-04
- **Rationale:** The state check `assert.equal(` pins the observable result of "watch --mark-background writes the background marker beside the record" rather than incidental output.
- **Evidence:** Source line 224 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/watch.test.ts` :: watch completes when the invocation output appears and records every arming and wake

- **Verdict:** KEEP
- **Principle:** TP-04
- **Rationale:** The state check `assert.equal(result.state, 'completed')` pins the observable result of "watch completes when the invocation output appears and records every arming and wake" rather than incidental output.
- **Evidence:** Source line 101 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/watch.test.ts` :: watch reports stalled after the configured unchanged wakes

- **Verdict:** KEEP
- **Principle:** TP-04
- **Rationale:** The state check `assert.equal(result.state, 'stalled')` pins the observable result of "watch reports stalled after the configured unchanged wakes" rather than incidental output.
- **Evidence:** Source line 140 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/watch.test.ts` :: watch reports timed_out at the timeout when the paths keep changing

- **Verdict:** KEEP
- **Principle:** TP-04
- **Rationale:** The state check `assert.equal(result.state, 'timed_out')` pins the observable result of "watch reports timed_out at the timeout when the paths keep changing" rather than incidental output.
- **Evidence:** Source line 183 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/watch.test.ts` :: watch returns completed at once for an output already present and stays idempotent

- **Verdict:** KEEP
- **Principle:** TP-04
- **Rationale:** The state check `assert.equal(first.state, 'completed')` pins the observable result of "watch returns completed at once for an output already present and stays idempotent" rather than incidental output.
- **Evidence:** Source line 204 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** 733ad2eb

### `tests/unit/workflow.test.ts` :: prototype stages declare their precondition data and criteria

- **Verdict:** KEEP
- **Principle:** TP-01
- **Rationale:** The check `assert.ok(stage.required_data?.[dataKey], '${slug} requires ${dataKey}')` protects "prototype stages declare their precondition data and criteria". The exact-name scan found 1 candidate source file.
- **Evidence:** Source line 146 contains the cited operation. The endpoint exact-name scan found 1 candidate source file.
- **Introducing commit:** a8229470

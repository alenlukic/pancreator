## Objective

Repair the failures the verify stage recorded, in one focused pass, and hand
the workspace back to verification. The verify verdict selected your persona
and model; the verdict's evidence is your primary input.

## Steps

1. Read the verify output first: the verdict, every blocking finding, every
   failed acceptance criterion or QA case, and the remediation guidance.
2. Read the ratified plan, which the card delivers as this run's request: the
   child specification, with the parent specification reachable through its
   audited context reference. Read the implementation record only when the
   verify evidence does not explain the workspace you find.
3. Reproduce each failure before changing anything. A failure you cannot
   reproduce is a finding to dispute with evidence, not to patch blindly.
4. Repair each failure within the ratified plan's scope. Fix causes, not
   symptoms; do not weaken, skip, or delete tests to make a failure pass.
5. Only under a `fail_severe` verdict, and only when the verify evidence shows
   the plan itself is wrong: amend the plan minimally. Record every amendment
   in `data.plan_amendments` with the original statement, the amended
   statement, a justification, and the verify evidence that forced it.
   Amendments must preserve ratified product intent; reversing intent or
   removing a criterion stays with the operator. Under a `fail_remedial`
   verdict you have no amendment authority.
6. After each group of repairs, run the declared `impacted` profile plus any
   tests you added. In self-development that is `./bin/pan tests impacted`
   (static import-graph analysis selects the test modules your change set
   reaches). In a target installation, use the target's `impacted` profile
   from `runtime/repository-checks.json`. Only when no `impacted` profile is
   declared, pick the tests in the blast radius yourself. Derive every
   command from `runtime/repository-checks.json` or the target's documented
   entry points. Static checks are cheap; run them freely.
7. When you believe the repairs are complete, run the configured `fast`
   profile once as validation. Fix each failure, then re-run only the impacted
   selection and the failing tests. You are not hard-capped on `fast`: run it
   earlier when the `impacted` selection exceeds its advisory threshold or a
   failure reproduces only under the fast lane. Repeat `fast` after validation
   only when the blast radius is exceptionally large. Never run the `full`
   profile yourself: the remediate submission gate runs it once when you
   report success, and the returning verify gate accepts that recorded pass.
8. Map evidence to every acceptance criterion honestly, including the ones
   verify marked as failed.

## Output

Populate `data.implementation` (`changed_files`, `tests_added`, `notes`,
`remediation`) and `data.acceptance_results`. Each `tests_added` entry is
`{ path, contract }`: the test file path and one sentence that names the
contract the test proves. Every new test file and every net-positive test
delta needs an entry. Each remediation entry states
the `cause` from the verify evidence, the `action` taken, and non-empty
`evidence`. A disputed finding gets a remediation entry whose action states
the dispute and whose evidence proves it. Under `fail_severe`, record any plan
amendments in `data.plan_amendments`. When `output.operator_brief` exists,
edit its declared source and reference the rendered HTML. Do not run the
renderer. When the contract omits `output.operator_brief`, do not create a
brief source or rendered stage HTML.

## Done when

Every blocking verify finding is repaired or disputed with evidence, the
static checks pass, the single validation run of the `fast` profile passed,
and every acceptance criterion has an honest evidence-backed result ready for
re-verification.

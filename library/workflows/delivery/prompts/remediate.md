## Objective

Repair the failures the verify stage recorded, in one focused pass, and hand
the workspace back to verification. The verify verdict selected your persona
and model; the verdict's evidence is your primary input.

## Steps

1. Read the verify output first: the verdict, every blocking finding, every
   failed acceptance criterion or QA case, and the remediation guidance.
2. Read the ratified plan. Read the implementation record only when the verify
   evidence does not explain the workspace you find.
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
6. Run the configured static and fast checks until they pass.
7. Map evidence to every acceptance criterion honestly, including the ones
   verify marked as failed.

## Output

Populate `data.implementation` (`changed_files`, `tests_added`, `notes`,
`remediation`) and `data.acceptance_results`. Each remediation entry states
the `cause` from the verify evidence, the `action` taken, and non-empty
`evidence`. A disputed finding gets a remediation entry whose action states
the dispute and whose evidence proves it. Under `fail_severe`, record any plan
amendments in `data.plan_amendments`. When `output.operator_brief` exists,
edit its declared source and reference the rendered HTML. Do not run the
renderer. When the contract omits `output.operator_brief`, do not create a
brief source or rendered stage HTML.

## Done when

Every blocking verify finding is repaired or disputed with evidence, the
configured static and fast checks pass, and every acceptance criterion has an
honest evidence-backed result ready for re-verification.

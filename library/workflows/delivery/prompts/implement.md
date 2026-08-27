## Objective

Implement the ratified plan with focused tests, and map evidence to every
acceptance criterion.

## Steps

1. Read the ratified planning artifact referenced by the card: specification,
   engineering plan, acceptance criteria, and test plan.
2. Read `runtime/repository-checks.json` and use the configured `static` and
   `fast` profiles for local verification. Do not substitute guessed ecosystem
   commands.
3. Implement the plan within its declared scope. Prefer existing abstractions;
   do not add structure the plan did not call for.
4. Add or update tests that prove the changed behavior. Do not weaken, skip,
   or delete existing tests to make the change pass; a needed test change must
   be disclosed in the notes with its reason.
5. Run the configured static and fast checks until they pass.
6. Map evidence to every acceptance criterion honestly. Report a criterion you
   could not satisfy as unmet; do not claim unsupported completion.

## Output

Populate `data.implementation` (`changed_files`, `tests_added`, `notes`) and
`data.acceptance_results`. Each acceptance result states the criterion `id`,
a `result`, and non-empty `evidence`. On a retry attempt, also populate
`data.implementation.remediation` with one entry per prior failure cause:
`cause`, `action`, and non-empty `evidence`. When `output.operator_brief`
exists, edit its declared source and reference the rendered HTML. Do not run
the renderer. When the contract omits `output.operator_brief`, do not create a
brief source or rendered stage HTML.

## Done when

The plan is implemented within scope, configured static and fast checks pass,
tests prove the changed behavior, and every acceptance criterion has an honest
evidence-backed result.

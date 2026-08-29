## Objective

Implement the ratified plan with focused tests, and map evidence to every
acceptance criterion.

## Steps

1. Read the ratified planning artifact referenced by the card: specification,
   engineering plan, acceptance criteria, and test plan.
2. Read `runtime/repository-checks.json` and the target's documented test entry
   points. Derive every test command from them. Do not substitute guessed
   ecosystem commands.
3. Implement the plan within its declared scope. Prefer existing abstractions;
   do not add structure the plan did not call for.
4. Add or update tests that prove the changed behavior. Do not weaken, skip,
   or delete existing tests to make the change pass; a needed test change must
   be disclosed in the notes with its reason.
5. After each group of changes, run `./bin/pan tests impacted` (the
   `impacted` profile: static import-graph analysis selects the test modules
   your change set reaches), plus any tests you added. Only when the target
   declares no `impacted` profile, pick the tests in the immediate blast
   radius yourself (for example `node --test dist/tests/unit/<file>.test.js`
   after `./bin/build`, or the target's equivalent). Static checks are cheap;
   run them freely.
6. When you believe the change is complete, run the configured `fast` profile
   once as validation. Fix each failure, then re-run only the impacted
   selection and the failing tests. You may run `fast` earlier when the
   `impacted` selection exceeds its advisory threshold or a failure reproduces
   only under the fast lane. Repeat `fast` after validation only when the
   blast radius is exceptionally large; the verify and remediate stages catch
   what slips.
7. On a retry attempt that changed only output claims or evidence, do not run
   any suite. Cite the prior run's evidence instead.
8. Map evidence to every acceptance criterion honestly. Report a criterion you
   could not satisfy as unmet; do not claim unsupported completion.

## Output

Populate `data.implementation` (`changed_files`, `tests_added`, `notes`) and
`data.acceptance_results`. Each `tests_added` entry is `{ path, contract }`:
the test file path and one sentence that names the contract the test proves.
Every new test file and every net-positive test delta needs an entry. A change
with no new tests leaves `tests_added` empty. Each acceptance result states the criterion `id`,
a `result`, and non-empty `evidence`. On a retry attempt, also populate
`data.implementation.remediation` with one entry per prior failure cause:
`cause`, `action`, and non-empty `evidence`. When `output.operator_brief`
exists, edit its declared source and reference the rendered HTML. Do not run
the renderer. When the contract omits `output.operator_brief`, do not create a
brief source or rendered stage HTML.

## Done when

The plan is implemented within scope, the static checks pass, the single
validation run of the `fast` profile passed, tests prove the changed behavior,
and every acceptance criterion has an honest evidence-backed result.

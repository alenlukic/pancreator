## Objective

Interactively verify prototypes and confirm acceptance criteria are testable from a
user-observable perspective. This stage does not run repository-check shell suites
because the design workflow does not mutate tracked source.

## Steps

1. Read the card, design output, successful review output, and the handbook
   guidance the card references.
2. Inspect every web UI surface by reading and following the `BROWSER-001`
   guidance this card references. Exercise primary flows, keyboard or
   accessibility passes, and the states the prototypes own.
3. Confirm layout, navigation, affordances, named design tokens, and motion against
   the ratified design specification.
4. Record each case with setup, action, expected result, actual result, and
   evidence.
5. Classify defects; do not convert environment blocks into product passes.
6. Map results to every acceptance criterion.

## Output

Populate `data.test` with `verdict`, `cases`, `defects`, and `acceptance_results`.
Author the QA brief at the declared source path. Do not run the renderer.
Reference the rendered HTML as the narrative artifact.

## Done when

Flows and states are exercised, acceptance criteria are verified or explicitly unmet,
and the verdict is honest about blockers.

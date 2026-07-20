## Objective

Interactively verify prototypes and confirm acceptance criteria are testable from a
user-observable perspective. This stage does not run repository-check shell suites
because the design workflow does not mutate tracked source.

## Steps

1. Read the card, design output, successful review output, and unrolled handbook
   guidance.
2. Start the documented prototype server and confirm its local URL is reachable.
3. For each web UI surface, use the `chrome-devtools` MCP server and open a fresh,
   dedicated page with `new_page`; never attach to an operator's personal browser.
   Close every page you open with `close_page` when inspection finishes, including
   on failure.
4. Use navigation, snapshots, and interaction tools to exercise primary flows,
   hover/focus/active/selected/disabled states, empty/loading/error/success states,
   and keyboard or accessibility passes against the HTML prototypes. Prefer DOM
   snapshots for evidence and use screenshots for pixel-level visual confirmation.
5. Confirm layout, navigation, affordances, named design tokens, and motion against
   the ratified design specification.
6. Record every Chrome DevTools MCP action and DOM observation in a case with
   setup, action, expected result, actual result, and evidence.
7. Classify defects; do not convert environment blocks into product passes.
8. Map results to every acceptance criterion.

## Output

Populate `data.test` with `verdict`, `cases`, `defects`, and `acceptance_results`.
Author the QA brief as the invocation's schema-valid brief JSON and reference the
rendered HTML first and the brief JSON second.

## Done when

Flows and states are exercised, acceptance criteria are verified or explicitly unmet,
and the verdict is honest about blockers.

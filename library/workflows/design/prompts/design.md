## Objective

Convert the ratified design brief into a design specification, token set,
self-contained HTML prototypes, and draft acceptance criteria for a later
corresponding `delivery` run.

## Steps

1. Read the card, ratified intake, and the DESIGN-001 handbook guidance the card
   references.
2. Draft the design spec: problem, users, flows, information architecture, and
   states including empty, loading, error, and success.
3. Define design tokens (CSS custom properties) before laying out screens.
4. For key screens, explore multiple HTML variants, then converge using the
   screenshot-or-accessibility-snapshot → score-against-heuristics → fix-top-issues
   loop. `BROWSER-001` governs browser use for this loop and permits a disclosed
   capture fallback when browser tooling is unavailable.
5. Write authoritative self-contained HTML prototypes under the run’s
   `artifacts/mocks/` with semantic landmarks (`header`, `main`, `section`,
   `footer`). Use HTML as the authoritative mock medium.
6. Draft observable acceptance criteria consumable by a subsequent `delivery` request.

## Output

Populate `data.design_spec` (`summary`, `screens`, `tokens`), `data.mocks` (entries
with `kind` `html`, `screen`, and `path`), and `data.acceptance_criteria`. When
`output.operator_brief` exists, edit its declared source and reference the
rendered HTML. Do not run the renderer. When the contract omits
`output.operator_brief`, do not create either brief file.

## Done when

The spec, tokens, HTML mocks, and draft acceptance criteria are complete and
mapped to the brief.

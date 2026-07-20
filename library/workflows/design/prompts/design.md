## Objective

Convert the ratified design brief into a design specification, token set,
self-contained HTML prototypes, best-effort Figma artifacts, and draft acceptance
criteria for a later corresponding `dev` run.

## Steps

1. Read the card, ratified intake, and unrolled DESIGN-001 / handbook guidance.
2. Draft the design spec: problem, users, flows, information architecture, and
   states including empty, loading, error, and success.
3. Define design tokens (CSS custom properties) before laying out screens.
4. For key screens, explore multiple HTML variants, then converge using the
   screenshot-or-accessibility-snapshot → score-against-heuristics → fix-top-issues
   loop. Prefer MCP/browser tools when available; otherwise use Bash capture
   fallbacks and disclose the method.
5. Write authoritative self-contained HTML prototypes under the run’s
   `artifacts/mocks/` with semantic landmarks (`header`, `main`, `section`,
   `footer`). Use HTML as the authoritative mock medium.
6. Attempt best-effort Figma MCP artifacts when tooling is available. If Figma is
   unavailable or fails, record a degradation note and continue.
7. Draft observable acceptance criteria consumable by a subsequent `dev` request.

## Output

Populate `data.design_spec` (`summary`, `screens`, `tokens`), `data.mocks` (entries
with `kind` `html` or `figma`, `screen`, and `path` or `url`), and
`data.acceptance_criteria`. Author the design brief as the invocation's schema-valid
brief JSON and reference the rendered HTML first and the brief JSON second.

## Done when

The spec, tokens, HTML mocks, draft acceptance criteria, and any Figma degradation
notes are complete and mapped to the brief.

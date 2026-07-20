## Objective

Turn the operator request into a bounded UI/UX product specification for a design
predecessor run. Preserve intent; do not invent the visual solution.

## Steps

1. Read the operator request and any clarification turns referenced by the card.
2. Restate the request as a concise summary and observable user stories focused on
   users, flows, brand or product context, and success signals.
3. Name constraints and out-of-scope behavior explicitly, including what belongs to
   a later corresponding `dev` run rather than this design run.
4. Capture unresolved questions instead of inventing answers. Use at most five
   clarification turns, then record what remains open.

## Output

Populate `data.product_spec` with `summary`, `user_stories`, `constraints`,
`out_of_scope`, and `open_questions`. Author the operator-facing specification as
the invocation's schema-valid brief JSON, render it to the exact HTML path from
the output contract, and reference the HTML first and the brief JSON second.

## Done when

The spec faithfully covers the request, user stories describe observable UX
outcomes, and the operator summary is concise and actionable.

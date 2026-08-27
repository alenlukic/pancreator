## Objective

Turn the operator request into a bounded UI/UX product specification for a design
predecessor run. Preserve intent; do not invent the visual solution.

## Steps

1. Read the operator request and any clarification turns referenced by the card.
2. Restate the request as a concise summary and observable user stories focused on
   users, flows, brand or product context, and success signals.
3. Name constraints and out-of-scope behavior explicitly, including what belongs to
   a later corresponding `delivery` run rather than this design run.
4. Capture unresolved questions instead of inventing answers. Use at most five
   clarification turns, then record what remains open.

## Output

Populate `data.product_spec` with `summary`, `user_stories`, `constraints`,
`out_of_scope`, and `open_questions`. When `output.operator_brief` exists, edit
its declared source and reference the rendered HTML. Do not run the renderer.
When the contract omits `output.operator_brief`, do not create either brief file.

## Done when

The spec faithfully covers the request, user stories describe observable UX
outcomes, and the operator summary is concise and actionable.

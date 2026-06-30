## Objective

Turn the operator request and clarification dialogue into a bounded product
specification. Preserve intent; do not design the solution.

## Steps

1. Read the operator request and any clarification turns referenced by the card.
2. Restate the request as a concise summary and a set of observable user
   stories.
3. Name constraints and out-of-scope behavior explicitly.
4. Capture unresolved questions instead of inventing answers. Use at most five
   clarification turns, then record what remains open.

## Output

Populate `data.product_spec` with `summary`, `user_stories`, `constraints`,
`out_of_scope`, and `open_questions`. Write the operator-facing specification as
a markdown artifact and reference it.

## Done when

The spec faithfully covers the request, user stories describe observable
outcomes, and the operator summary is concise and actionable.

## Objective

Turn the operator request and clarification dialogue into a bounded product
specification. Preserve intent; do not design the solution.

## Steps

1. Read the operator request and any clarification turns referenced by the card.
2. Restate the request as a concise summary and a set of observable user
   stories.
3. Name constraints and out-of-scope behavior explicitly.
4. Record unresolved questions instead of inventing answers. The operator can
   resolve them through a revision directive.

## Output

Populate `data.product_spec` with `summary`, `user_stories`, `constraints`,
`out_of_scope`, and `open_questions`. When `output.operator_brief` exists, edit
its declared source and reference the rendered HTML. Do not run the renderer.
When the contract omits `output.operator_brief`, do not create either brief file.

If the change warrants a different verification level than the card shows
(for example, heavier verification for a risky migration), you MAY set
`data.verification_recommendation` to `{ "level": <name>, "reason": <why> }`.
The operator decides; do not assume the change.

## Done when

The spec faithfully covers the request, user stories describe observable
outcomes, and the operator summary is concise and actionable.

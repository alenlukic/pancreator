# Write a stage output

Use when completing any worker stage and producing its declared JSON output.

## Principle

The output is a validated machine contract. The operator-facing narrative lives
in a markdown artifact you reference; the JSON carries the structured fields the
harness checks.

## Steps

1. Start from `library/templates/stage-output.example.json` and keep the
   invocation ID exactly as the card states.
2. Create every artifact you reference before referencing it. The primary
   deliverable is a markdown artifact (see the craft-operator-artifact skill).
3. Fill every rubric criterion with a result, concrete evidence, and an
   explanation of why the evidence is sufficient.
4. Populate every required `data` field with the declared type.
5. State risks and unknowns honestly; an empty list means you checked, not that
   you skipped.

## Quality bar

- The summary is concise and operator-first: outcome, blockers, evidence
  pointers, next action. Raw logs belong in evidence files, not the summary.
- Set `result` to `blocked` only when you genuinely cannot proceed, and say why.
- Never claim a hard criterion passed without evidence the harness or a
  supervisor could verify.

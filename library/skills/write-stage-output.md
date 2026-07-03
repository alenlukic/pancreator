# Write a stage output

Use when completing any worker stage and producing its declared JSON output.

## Principle

The stage output is a validated machine contract. The operator-facing narrative
is authored as brief JSON and rendered to self-contained HTML; the stage output
references both while carrying the structured fields the harness checks.

## Steps

1. Start from `library/templates/stage-output.example.json` and keep the
   invocation ID exactly as the card states.
2. Read `output.operator_brief` from the invocation card. Author schema-valid
   brief JSON at its `source_path`, then render it to its exact `rendered_path`
   with `pan briefs render`.
3. Put the rendered HTML at `artifacts[0]` and its source brief JSON at
   `artifacts[1]`. Create any additional evidence artifacts before referencing
   them. Markdown is permitted only for execution-contract exceptions such as
   invocation/delegation records, PR copy, or legacy artifacts.
4. Fill every rubric criterion with a result, concrete evidence, and an
   explanation of why the evidence is sufficient.
5. Populate every required `data` field with the declared type.
6. State risks and unknowns honestly; an empty list means you checked, not that
   you skipped.

The harness rerenders the declared brief source during submission. A missing or
invalid source, a non-HTML primary artifact, or artifact paths that differ from
the invocation contract fail the stage.

## Quality bar

- The summary is concise and operator-first: outcome, blockers, evidence
  pointers, next action. Raw logs belong in evidence files, not the summary.
- The HTML brief begins with an executive summary and follows the profile
  headings required by the active stage.
- Set `result` to `blocked` only when you genuinely cannot proceed, and say why.
- Never claim a hard criterion passed without evidence the harness or a
  supervisor could verify.

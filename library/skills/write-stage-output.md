# Write a stage output

Use when completing any worker stage and producing its declared JSON output.

## Principle

The stage output is a validated machine contract. The operator-facing narrative
is authored as brief JSON and rendered to self-contained HTML.
The stage output references both while carrying the structured fields the
harness checks.

## Steps

1. Start from `library/templates/stage-output.example.json` and keep the
   invocation ID exactly as the card states.
2. Follow the card's `output.operator_brief` contract. When it exists, author
   schema-valid brief JSON at its `source_path` and do not run the renderer.
3. Create each extra evidence artifact before referencing it. Markdown
   is permitted only for execution-contract exceptions such as
   invocation/delegation records, PR copy, or legacy artifacts.
4. Fill every rubric criterion with a result, concrete evidence, and an
   explanation of why the evidence is enough.
5. Populate every required `data` field with the declared type.
6. State risks and unknowns honestly. An empty list means you checked, not that
   you skipped.
7. When the output carries `invocation_attestation`, the scaffold prefills the
   identity fields and status `pending`.
   Change the status to `read` after you read the complete contract, or to
   `reference_failed` with the concrete error and result `blocked`.
   Submission rejects `pending`.
8. Do not transcribe per-section or per-guidance digest tables into the
   attestation — the single `contract_sha256` is the whole requirement.
   Read every referenced guidance selection the card lists.
   When a source file no longer matches its digest, read the exact selected
   bytes from the invocation JSON snapshot.
9. On a retry, you may submit a revision rather than the whole document.
   A revision is a JSON file of the form
   `{ "revises": "<prior-invocation-id>", "patch": { ... } }`, where `patch` is
   an RFC 7386 JSON merge patch over the prior output (objects merge
   recursively, arrays replace whole, `null` deletes).
10. The patch has to set `invocation_id` and `invocation_attestation` to the
    current card's values.
    The harness applies the patch and validates the merged document.
    Keep everything you were not asked to change.

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

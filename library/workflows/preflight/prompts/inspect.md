## Objective

Inspect the harness structure and validation evidence for integrity. Do not
modify any files.

## Steps

1. Read the card and the harness layout it references.
2. Let the harness rerun `npm run validate` and `npm test`.
3. Report configuration errors, missing required files, and operational risks.

## Output

Populate `data.inspection` (`findings`, `verdict`). Set the verdict to fail if
any deterministic check fails or a required file is missing. Write a markdown
inspection summary artifact and reference it.

## Done when

Configuration validates, harness tests pass, and findings are recorded with
concrete evidence.

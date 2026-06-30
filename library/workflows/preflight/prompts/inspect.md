## Objective

Inspect the installed Pancreator harness structure and validation evidence for
integrity. Do not modify target-repository files.

## Steps

1. Read the card and the harness layout it references.
2. Let the harness rerun its own validation and automated tests from the
   Pancreator installation root, independent of the target repository's
   language, package manager, or project layout.
3. Report configuration errors, missing required files, and operational risks.

## Output

Populate `data.inspection` (`findings`, `verdict`). Set the verdict to fail if
any deterministic check fails or a required file is missing. Write a markdown
inspection summary artifact and reference it.

## Done when

Harness configuration validates, harness tests pass, and findings are recorded
with concrete evidence.

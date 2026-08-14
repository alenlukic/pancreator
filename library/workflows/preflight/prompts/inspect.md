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
any deterministic check fails or a required file is missing. Author the
inspection summary at the declared brief source path. Do not run the renderer.
Reference the rendered HTML as the narrative artifact.

## Done when

Harness configuration validates, harness tests pass, and findings are recorded
with concrete evidence.

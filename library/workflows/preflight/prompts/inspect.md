## Objective

Inspect the installed Pancreator harness structure and validation evidence for
integrity. Do not modify target-repository files.

## Steps

1. Read the card and the harness layout it references.
2. Let the harness rerun its own validation from the Pancreator installation
   root, independent of the target repository's language, package manager, or
   project layout. The test gate runs the harness suite in self-development
   and the configured `fast` profile in an installation. An installation that
   configures no `fast` profile records the gate as not configured.
3. Report configuration errors, missing required files, and operational risks.

## Output

Populate `data.inspection` (`findings`, `verdict`). Set the verdict to fail if
any deterministic check fails or a required file is missing. When
`output.operator_brief` exists, edit its declared source and reference the
rendered HTML. Do not run the renderer. When the contract omits
`output.operator_brief`, do not create either brief file.

## Done when

Harness configuration validates, the configured test gate passes or records
that no profile is configured, and findings are recorded with concrete
evidence.

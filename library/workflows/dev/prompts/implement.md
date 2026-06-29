## Objective

Implement the approved engineering plan and acceptance criteria with focused
tests, keeping changes scoped.

## Steps

1. Read the plan, acceptance criteria, card, target-repository primer, and
   `runtime/repository-checks.json`; inspect the repository before editing.
2. If this is a remediation or restart attempt, review the existing workspace
   changes, prior implementation output, and any operator feedback before
   deciding what to keep, refactor, or replace.
3. Implement the smallest coherent change, adding tests at the right boundary.
4. Preserve behavior outside the requested change.
5. Iterate with the narrowest verified repository commands. Use explicit
   repository-declared toolchain entrypoints and the configured probes; do not
   substitute an ambiguous PATH interpreter or guess a package manager.
6. Let the harness rerun the configured `static` and `fast` repository-check
   profiles. Report an unconfigured profile rather than describing it as a pass.

## Output

Populate `data.implementation` (`changed_files`, `tests_added`, `notes`) and
`data.acceptance_results`, mapping evidence to each acceptance criterion. Write
a markdown implementation summary artifact and reference it.

## Done when

Every acceptance criterion has supporting evidence, configured static and fast
checks pass when rerun, any unconfigured checks are disclosed, and no
unsupported completion is claimed.

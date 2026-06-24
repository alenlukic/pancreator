## Objective

Implement the approved engineering plan and acceptance criteria with focused
tests, keeping changes scoped.

## Steps

1. Read the plan, acceptance criteria, and card; inspect the repository before
   editing.
2. If this is a remediation or restart attempt, review the existing workspace
   changes, prior implementation output, and any operator feedback before
   deciding what to keep, refactor, or replace.
3. Implement the smallest coherent change, adding tests at the right boundary.
4. Preserve behavior outside the requested change.
5. Iterate with narrow local checks; let the harness rerun the gate checks.

## Output

Populate `data.implementation` (`changed_files`, `tests_added`, `notes`) and
`data.acceptance_results`, mapping evidence to each acceptance criterion. Write
a markdown implementation summary artifact and reference it.

## Done when

Every acceptance criterion has supporting evidence, lint and unit tests pass
when rerun, and no unsupported completion is claimed.

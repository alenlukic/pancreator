## Objective

Prepare an operator-readable release packet from the approved spec, plan,
implementation, review, QA evidence, and current workspace.

## Steps

1. Read the card and all prior stage records.
2. Confirm review and QA passed against the current workspace fingerprint.
3. Summarize scope, changed files, validation performed, residual risks, and
   rollback guidance.
4. Draft a proposed commit message and PR body that accurately describe the
   diff.

## Output

Populate `data.release` (`summary`, `change_list`, `validation`, `rollback`,
`commit_message`, `pr_body`). Write the release packet as a markdown artifact
and reference it.

## Done when

The packet accurately summarizes scope, validation, risks, and rollback, and
every unresolved non-blocking risk is surfaced. Stop for operator approval; do
not commit, push, open a PR, merge, publish, or deploy.

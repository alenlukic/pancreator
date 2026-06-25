## Objective

Prepare an operator-readable release packet from the approved spec, plan,
implementation, review, QA evidence, and current workspace.

## Steps

1. Read the card and all prior stage records.
2. Confirm review and QA are satisfied by successful evidence or explicit
   fingerprint-bound waivers against the current or operator-accepted
   workspace fingerprint.
3. List every active operator gate waiver, deferred acceptance criterion, and
   linked follow-up case; do not describe waived evidence as an ordinary pass.
4. Summarize scope, changed files, validation performed, residual risks, and
   rollback guidance.
5. When Git metadata is available, draft a proposed commit message and PR body
   that accurately describe the diff.

## Output

Populate `data.release` (`summary`, `change_list`, `validation`, `rollback`,
`waivers`, `follow_up_cases`).
Include optional Git metadata fields (`commit_message`, `pr_body`) only when
they are available and requested. Write the release packet as a markdown
artifact and reference it.

## Done when

The packet accurately summarizes scope, validation, risks, and rollback, and
every unresolved non-blocking risk is surfaced. Stop for operator approval; do
not commit, push, open a PR, merge, publish, or deploy.

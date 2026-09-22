Report harness cleanup actions, get approval, and apply the reported plan.

1. Read `{{PANCREATOR_HARNESS_PATH}}AGENTS.md`. Then run `{{PANCREATOR_PAN_COMMAND}} governance card --mode cleanup` and read the card in full. Do not generate a second card for the same session.
2. Treat `$ARGUMENTS` as optional `--days <positive-integer>` and repeatable `--class <name>` selections. Reject `--apply`, shell syntax, and every other option.
3. Run `{{PANCREATOR_PAN_COMMAND}} cleanup [$ARGUMENTS] --json`. Present every action, skipped path, worktree, and branch from the plan.
4. Ask the operator to approve this exact destructive sweep. Do not apply the plan before the operator approves it.
5. After approval, run `{{PANCREATOR_PAN_COMMAND}} cleanup [$ARGUMENTS] --apply --json`.
6. Report each removed worktree with its branch and merged status. Keep every branch.
7. Report each skipped path with its refusal reason. A live owner, a nonterminal run, or uncommitted work is a successful safety decision.
8. Do not push, publish, deploy, delete a Git branch, or change Git history.

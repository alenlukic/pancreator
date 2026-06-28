Write a pull-request description for the current branch and worktree.

1. Read `AGENTS.md`, `runtime/target-repo-primer.md`, and `library/skills/write-pr-description.md`.
2. Treat `$ARGUMENTS` as either empty or one literal Git base ref. Use `main` when it is empty. Reject multiple arguments, options, shell syntax, or a ref that `git rev-parse --verify` cannot resolve to a commit.
3. Resolve the current branch, the selected base ref, and their merge base. Compare all committed branch changes plus staged, unstaged, and relevant untracked worktree changes against that merge base. Do not compare only `HEAD` or only the unstaged diff.
4. Convert the current branch and base ref to filename-safe slugs by replacing every run of characters outside `[A-Za-z0-9._-]` with `-` and trimming leading or trailing `-`. Choose a unique harness-relative output path under `runtime/pr-descriptions/` named `<UTC timestamp>-<branch-slug>-against-<base-slug>.md`. In an embedded installation, write the corresponding file under `.pancreator/runtime/pr-descriptions/`.
5. Invoke the `release-steward` subagent in standalone PR-writing mode with the selected base ref and output path. Require it to apply `library/skills/write-pr-description.md`, inspect the actual Git delta, write no other file, and omit the delivery-pipeline manifest unless a workflow run was explicitly supplied.
6. Stop without writing a description when there is no committed or worktree delta against the merge base, when the base cannot be resolved, or when the repository is in a detached or otherwise ambiguous state that prevents an accurate PR comparison.
7. Do not modify source, workflow state, release metadata, commits, branches, remotes, or pull requests. Do not run `gh pr create`, commit, push, merge, publish, or deploy.
8. Surface the selected base, merge base, output path, and the complete generated Markdown in one fenced `markdown` block. Do not replace the generated description with a summary.

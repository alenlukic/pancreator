Scan changed operator artifacts, repair eligible prose, and record a clean checkpoint.

1. Read `{{PANCREATOR_HARNESS_PATH}}AGENTS.md`. Then run `{{PANCREATOR_PAN_COMMAND}} governance card --mode conform` and read the card it writes in full. When a worktree is named, add `--worktree <name>` so the card creates or resolves it and binds the session workspace to it. Do not generate a second card for the same session.
2. Treat `$ARGUMENTS` as at most one optional `--worktree <name>` selection plus optional conform flags: `--since <ref>` or `--all`. Reject any other option, multiple overrides, shell syntax, or a ref that `git rev-parse --verify` cannot resolve to a commit.
3. Run `{{PANCREATOR_PAN_COMMAND}} conform scan [--since <ref> | --all] [--worktree <name>] --json`. Read the result and count the editable files with issues.
4. Stop when the scan selects no eligible artifacts.
5. When the scan reports more than five editable files with issues, delegate the repairs to `pan-librarian` with the scan JSON included. Do not edit the files inline in this session.
6. When the scan reports one to five editable files with issues, open each editable file and repair the reported Simplified Technical English issues. Edit only the harness-owned `docs/issues/**/*.md` and `runtime/pr-descriptions/*.md`.
7. Do not edit rendered HTML or `CHANGELOG.md`. Report their issues only. `CHANGELOG.md` is release metadata a ship stage and `/pan-release` own.
8. After each repaired file, run `{{PANCREATOR_PAN_COMMAND}} requirements run --persona librarian --workflow standalone --stage conform --kind standalone --registry SIMPLIFIED-ENGLISH-VALIDATE-001 --target <path> [--worktree <name>] --json`. Stop when validation fails.
9. After every editable file passes validation, run `{{PANCREATOR_PAN_COMMAND}} conform checkpoint [--worktree <name>] --json`.
10. Do not commit, push, merge, publish, deploy, or change Git history.

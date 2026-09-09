Scan the workspace source for code style issues, repair them, and record a clean checkpoint.
Accept one optional `--worktree <name>` selection and forward it to every style command. Omit the flag when the operator names no worktree.

1. Read `{{PANCREATOR_HARNESS_PATH}}AGENTS.md`. Then run `{{PANCREATOR_PAN_COMMAND}} governance card --mode style` and read the card it writes in full. When the operator selects a worktree, add `--worktree <name>` so the card creates or resolves it, and treat the reported worktree path as the workspace. Do not generate a second card for the same session.
2. Treat `$ARGUMENTS` as optional style flags: `--since <ref>`, `--all`, or `--worktree <name>`. Reject any other option, multiple selection overrides, shell syntax, or a ref that `git rev-parse --verify` cannot resolve to a commit.
3. Run `{{PANCREATOR_PAN_COMMAND}} style scan --worktree <name> --json`, and add `--since <ref>` or `--all` when the operator selects one of them. Read the result and count the editable files with issues.
4. Stop when the scan selects no eligible artifacts.
5. When the scan reports more than five editable files with issues, delegate the repairs to `pan-librarian` with the scan JSON included. Do not edit the files inline in this session.
6. When the scan reports one to five editable files with issues, open each editable file and repair the reported code style issues, plus the judgment-level rules the style guidance states.
7. Do not edit a report-only file. A harness file inside an embedded target workspace is report-only, and the configured formatter stays authoritative for mechanical style.
8. After each repaired file, run `{{PANCREATOR_PAN_COMMAND}} requirements run --persona librarian --workflow standalone --stage style --kind standalone --registry CODE-STYLE-VALIDATE-001 --target <path> --json`. Stop when validation fails.
9. After every editable file passes validation, run the configured static profile with `{{PANCREATOR_PAN_COMMAND}} repository-check static`, then run `{{PANCREATOR_PAN_COMMAND}} style checkpoint --worktree <name> --json`.
10. Do not commit, push, merge, publish, deploy, or change Git history.

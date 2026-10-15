Complete local release preparation for `$ARGUMENTS`, which must select one `--worktree <name>`.

1. Read `{{PANCREATOR_HARNESS_PATH}}AGENTS.md`. Resolve and read the complete release card with `{{PANCREATOR_PAN_COMMAND}} governance card --mode release --worktree <name>`.
2. Read the target primer, release steward persona, and `library/skills/update-release-metadata.md`. Apply their self-development and workspace boundaries.
3. Check for concurrent mutating work in the selected workspace. Complete source synchronization and verification before release. Release MUST NOT run tests.
4. Inspect the complete release delta, choose major, minor, or patch, and author one Unreleased entry. Checkpoint eligible changes. Stop without mutation when no releasable delta exists.
5. Collect one bundle with `{{PANCREATOR_PAN_COMMAND}} release evidence --worktree <name> --run <run-id> --json`. Finish the evidence review and every other preparation check. Under SHIP-001, return missing or stale proof to verify.
6. As the final local operation, run `{{PANCREATOR_PAN_COMMAND}} release land --worktree <name> --run <run-id> --bump <major|minor|patch> --json`. It allocates, updates metadata, and finalizes once under the landing mutex, then advances pan-dev. Do not allocate or finalize beforehand.
7. Report the version, release and index commits, and tip. Surface a refusal with its remediation command. Preserve any completed pair on retry.
8. Return control before any push, pull request, publication, deployment, or history rewrite.

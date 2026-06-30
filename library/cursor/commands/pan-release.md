Prepare or regenerate Pancreator release metadata from the complete repository delta. Treat `$ARGUMENTS` only as optional operator context; never use it as a substitute for inspecting Git history and the worktree.

1. Read `AGENTS.md`, `docs/target-repo-primer.md`, `library/personas/release-steward.md`, and `library/skills/update-release-metadata.md`.
2. Read `project.json` and stop without mutation unless `installation_mode` is `self_development`. This command does not version embedded target repositories.
3. Run `./bin/pan list --json`. Stop if a mutating workflow is active against this workspace; the workflow ship stage owns its own automatic release update.
4. Invoke the `release-steward` subagent in standalone release-metadata mode. Require it to apply `VERSION-001` and `library/skills/update-release-metadata.md`, inspect the complete change range since the last committed release bump, select exactly `major`, `minor`, or `patch`, author or regenerate the current release notes, and synchronize all required version-bearing files.
5. Require idempotence: when an uncommitted candidate already exists, regenerate it in place rather than incrementing again. When there are no changes and no candidate, make no edits.
6. Permit edits only to `CHANGELOG.md`, `VERSION`, `package.json`, `package-lock.json`, `README.md`, and version-bearing Markdown under `docs/`. Never edit `release/index.json`.
7. Run `npm run format:check`, `npm run typecheck`, and `npm run validate`. If validation fails, provide the exact failures to the release steward for one correction attempt and rerun the failed checks.
8. Do not commit, push, open or merge a PR, publish, deploy, rewrite history, or invent the future release commit hash.
9. Surface the baseline commit, selected bump, previous and proposed versions, changed release files, validation results, and the rendered latest changelog entry.

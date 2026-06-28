Rebuild the target repository primer.

1. Read the applicable operating cards. In self-development, read `AGENTS.md`; in an embedded installation, read the target repository's `AGENTS.md` when present and `.pancreator/AGENTS.md`, then treat the parent repository as the target workspace.
2. Use the harness-relative output path `runtime/target-repo-primer.md`. For Cursor filesystem operations in an embedded installation, the corresponding path is `.pancreator/runtime/target-repo-primer.md`.
3. Invoke the `librarian` subagent with the target workspace root and output path. Require it to apply `PRIMER-001`, read the existing primer first when present, inspect representative code and authoritative repository documentation, inspect setup/build/install/test scripts and manifests, and inspect bounded `git log` history when available.
4. Require the librarian to write no file other than the primer and to return the complete generated Markdown.
5. Run `./bin/pan requirements run --persona librarian --workflow standalone --stage build-docs --kind documentation --registry TARGET-REPO-PRIMER-VALIDATE-001 --target runtime/target-repo-primer.md --json`.
6. If validation fails, provide the validator issues to the librarian for one correction attempt, then rerun the same validation. Stop and surface unresolved issues if the second attempt fails.
7. Do not modify target source, workflow state, or governance and do not commit, push, merge, publish, or deploy.
8. Surface the validated primer path, source HEAD recorded by the primer, and a concise summary of the sections rebuilt.

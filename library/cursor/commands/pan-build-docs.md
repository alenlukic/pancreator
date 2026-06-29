Rebuild the target repository primer and verification profile.

1. Read `AGENTS.md` and treat its declared workspace as the target. The embedded projection expands this instruction to the target and harness operating cards.
2. Use the harness-relative output paths `runtime/target-repo-primer.md` and `runtime/repository-checks.json`. In an embedded installation, Cursor filesystem operations use `.pancreator/runtime/target-repo-primer.md` and `.pancreator/runtime/repository-checks.json`, while CLI arguments retain the harness-relative paths.
3. Invoke the `librarian` subagent with the target workspace root and both output paths. Require it to apply `PRIMER-001` and `REPO-001`, read the existing outputs first when present, inspect representative code and authoritative repository documentation, inspect setup/build/install/test scripts and manifests, and inspect bounded `git log` history when available.
4. Require the librarian to populate repository-check profiles only from verified target conventions. Commands that depend on an interpreter, virtual environment, SDK, compiler, or package manager must use the explicit repository-declared entrypoint when available and should include identity/version probes. Empty profiles are valid; guessed commands are not.
5. Require the librarian to write no files other than the primer and repository-check configuration and to return the complete generated Markdown plus a concise profile summary.
6. Run `./bin/pan requirements run --persona librarian --workflow standalone --stage build-docs --kind documentation --registry TARGET-REPO-PRIMER-VALIDATE-001 --target runtime/target-repo-primer.md --json`.
7. Run `./bin/pan repository-check validate --json`.
8. If either validation fails, provide the issues to the librarian for one correction attempt, then rerun both validations. Stop and surface unresolved issues if the second attempt fails.
9. Do not modify target source, workflow state, or governance and do not commit, push, merge, publish, or deploy.
10. Surface both validated paths, the source HEAD recorded by the primer/configuration, and a concise summary of the sections and profiles rebuilt.

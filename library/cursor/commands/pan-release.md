Coordinate the local release for `$ARGUMENTS`, which must select one `--worktree <name>`.

1. Read `{{PANCREATOR_HARNESS_PATH}}AGENTS.md`. Resolve and read the complete release card with `{{PANCREATOR_PAN_COMMAND}} governance card --mode release --worktree <name>`.
2. Read the target primer, release steward persona, and `library/skills/update-release-metadata.md`. Apply their self-development and workspace boundaries.
3. Check for concurrent mutating work in the selected workspace. Keep shared release resources under the landing mutex and allocation authority.
4. Use the declared release delta to choose major, minor, or patch and author one Unreleased entry. Checkpoint eligible changes. Stop without mutation when no releasable delta exists.
5. In workflow mode, carry forward the supplied `data.verify.evidence_packet` reference and release disclosures without checking their evidence. Standalone release needs no workflow verification records. Do not collect a bundle or invent stage proofs.
6. Require exactly two new commits on `pan-dev`: one squashed commit with all changes and release metadata, followed by an index commit that records its hash. Use the operator's Git identity as author and committer. Commit messages describe only changes and contain no authorship attribution.
7. Run `{{PANCREATOR_PAN_COMMAND}} release land --worktree <name> --bump <major|minor|patch> --json`. Add `--run <run-id>` only for a supplied workflow run. Do not allocate or finalize beforehand. Report the version, release commit, index commit, and tip. Preserve a completed pair on retry.
8. Return control before any push, pull request, publication, deployment, or additional history rewrite.

Release MUST NOT run tests, inspect, collect, or check evidence, review artifact
diagnostics, validate release artifacts, or gate on validation. The verifier and
harness own evidence correctness, runtime normalization, and the final fast
profile check. Release follows their supplied data without checking it.

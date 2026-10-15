# Update release metadata

Use for a Pancreator self-development ship stage or `/pan-release`.
Embedded and detached target releases do not change harness metadata.

## Outcome

Complete verification first. Collect one evidence bundle, choose the Semantic
Versioning bump, and author the release notes. Allocate the version, synchronize
metadata, finalize once, and merge only as the final local operation.

## Establish the baseline

Read the committed version and the commit that introduced it. Inspect the complete
committed and working delta since that baseline, including existing Unreleased
notes. Stop without edits when there is no releasable change. Checkpoint source
changes before collecting evidence. The candidate must already contain pan-dev;
any synchronization that changes source requires another verify pass.

## Choose the bump

Choose `major` for incompatible contracts or migrations, `minor` for compatible
capabilities, and `patch` for compatible fixes, documentation, or maintenance.
Record the decision without allocating a number. Regenerate an existing draft
in place. Preserve a completed release pair on a retry.

## Author release notes

Write one `## [Unreleased]` entry grounded in the actual delta. Use Changed,
Added, Removed, and Fixed groups in that order when applicable. Link statements
to existing evidence. Preserve historical entries. Checkpoint the notes.

## Collect evidence once

Run `pan release evidence --worktree <name> --run <run-id> --json` once. This
collects the successful verify proof and its source fingerprint into one reusable
bundle. A repeated call at the same fingerprint reuses that bundle. Review it
and finish every other preparation check before landing.

Under VERSION-001, release commands and the release steward do not run tests. The verify stage
owns configuration validation, the resolved release profile, and the final fast
wall report, in that order after the other required verification checks pass.
Missing or stale proof returns the work to verify.

## Final local operation

Run `pan release land --worktree <name> --run <run-id> --bump <major|minor|patch>
--json`. It consumes the bundle without rerunning tests. Under the landing mutex,
it allocates the version, updates metadata once, finalizes once, validates the
release/index topology, and advances pan-dev. It preserves candidate dependency
and documentation changes. The topology guard necessarily follows commit creation.

Record the returned version, release commit, index commit, and tip. Populate
`release.versioning` from these results: current_version, recommendation,
proposed_version, baseline_commit, rationale, compatibility, updated_files, and
release_index_action. Do not run a separate allocate or finalize beforehand.

## Boundaries

Only the release commands may create the immutable release and index commits.
Only `pan release land` may advance pan-dev. Remote actions require the operator.

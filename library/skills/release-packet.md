# Release packet

Use when preparing the ship stage's release proposal.

## Principle

The packet is a proposal the operator can act on in one read. It never performs
the irreversible action; it makes the decision easy and safe.

## Contents

- Summary: what changed and why, in operator terms.
- Change list: the files and components touched.
- Validation: which gates passed and against which workspace fingerprint.
- Residual risks: every unresolved non-blocking risk, stated plainly.
- Rollback: a credible way to undo the change.
- For Pancreator self-development, the completed version bump, fetched-main
  hash, immutable release commit, separate release-index commit, and clean
  worktree result.
- PR description artifact at
  `runtime/logs/workflows/<run-id>/operator/pr-description.md` for layout v2.
  For layout v1, use
  `runtime/logs/workflows/<run-id>/artifacts/markdown/pr-description.md`.
  Produce it through `write-pr-description.md`.
  Put `<release-commit>..<index-commit>` in its Changelist.

## Checks before proposing

- Review and QA passed against the current workspace fingerprint; if evidence is
  stale, stop and report it.
- The proposed commit/PR text matches the actual change and does not overstate.

## Boundaries

Use only the local release command to edit `release/index.json` and commit. Do
not push, open or merge a PR, publish, or deploy. Stop for operator approval.

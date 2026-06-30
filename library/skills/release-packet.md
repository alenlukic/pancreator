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
- Proposed commit message when Git metadata is available.
- For Pancreator self-development, the completed version bump, baseline commit,
  release-note update, synchronized files, and deferred `release/index.json`
  action produced by `update-release-metadata.md`.
- PR description artifact at
  `runtime/logs/workflows/<run-id>/artifacts/markdown/pr-description.md`,
  produced via `write-pr-description.md` (suggested conventional-commit title
  on line 1, then Summary, Changelist, and optional Delivery Pipeline
  Manifest).

## Checks before proposing

- Review and QA passed against the current workspace fingerprint; if evidence is
  stale, stop and report it.
- The proposed commit/PR text matches the actual change and does not overstate.

## Boundaries

Do not edit `release/index.json`, commit, push, open or merge a PR, publish, or
deploy. Stop for operator approval.

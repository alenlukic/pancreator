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
- Proposed commit message and PR body that accurately describe the diff.

## Checks before proposing

- Review and QA passed against the current workspace fingerprint; if evidence is
  stale, stop and report it.
- The proposed commit/PR text matches the actual change and does not overstate.

## Boundaries

Do not commit, push, open or merge a PR, publish, or deploy. Stop for operator
approval.

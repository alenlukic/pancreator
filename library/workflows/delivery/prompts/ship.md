## Objective

Prepare an accurate release packet from the ratified scope and current verification.

## Procedure

1. Read the card and required inputs. Confirm current successful verify evidence
   and disclose every waiver, warning, deferred criterion, and unresolved risk.
2. Finish the governance artifact review and repair safe runtime artifact defects.
   Return implementation or test concerns to verify through the declared route.
3. In self-development, inspect the complete release delta, choose the version
   bump, and prepare one Unreleased changelog entry. Checkpoint eligible changes
   in the managed worktree. Any source synchronization belongs before verify.
4. Collect one bundle with `pan release evidence --worktree <name> --run <run-id>
--json`. Use the candidate build through `PANCREATOR_EXEC_ROOT` when available.
   A missing or stale bundle requires verify. Do not execute tests during ship.
5. Finish the change list, validation disclosure, rollback guidance, and one
   observation per criterion verify marked observe. An observation names its
   criterion, signal, source, window, and exact check. Use the primer's tool and
   query when it supplies one; do not query that tool during release.
6. As the final local operation, run `pan release land --worktree <name>
--run <run-id> --bump <major|minor|patch> --json`. It consumes the bundle,
   allocates the version, updates metadata, finalizes once, checks the immutable
   release/index pair, and advances pan-dev. Do not allocate or finalize earlier.
7. Populate the packet and versioning fields from the returned results. Attribute
   every changed metadata path in workspace_changes. Preserve completed commits
   on retry. Surface a refusal and its supplying command without rerunning tests.
8. Embedded and detached targets do not mutate harness release metadata. Return
   the packet for operator approval before any remote action.

A landing that changes the harness root checkout is an operator step after submit.
The release steward changes only the managed worktree during its stage.

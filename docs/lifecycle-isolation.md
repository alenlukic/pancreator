# Lifecycle isolation

A recorded run executes with its pipeline configuration snapshot. Preparation
validates that required snapshot before checking the live configuration for
drift. Submission continues to use the recorded invocation and snapshot.
Settings and historical snapshots need no migration.
Valid live configuration changes still produce the existing drift advisories,
including the recorded and newly active configuration names.

When a live configuration or projection is incompatible with the executing
version, preparation records `PIPELINE_CONFIG_ADVISORY_UNAVAILABLE`, the original
error code and message, and a remedy. The run continues on its snapshot. Repair
the live configuration or projection for the selected executable, then run
`./bin/pan models --sync` to restore drift checks.
The recovery advisory names the installation's absolute `bin/pan` path so
rendering the remedy does not need to parse the incompatible live configuration.

Recovery is limited to `INVALID_PIPELINE_CONFIG`, `INVALID_PROJECT_CONFIG`,
`INVALID_PROJECTION_MANIFEST`, `INVALID_CURSOR_AGENT`, `INVALID_CURSOR_CATALOG`,
and `UNRESOLVED_CURSOR_MODEL` raised during advisory work. Required snapshot and
workflow errors remain fatal. Malformed JSON and unexpected filesystem failures
also remain fatal; advisory recovery does not suppress `INVALID_JSON`, which can
represent an I/O failure. New runs and legacy runs without a recorded pipeline
snapshot still require valid live configuration.

## Select a candidate executable

From the installation root, explicitly select a healthy candidate:

```sh
PANCREATOR_EXEC_ROOT=worktrees/operator/candidate ./bin/pan prepare <run-id>
PANCREATOR_EXEC_ROOT=worktrees/operator/candidate ./bin/pan submit <run-id> runtime/logs/workflows/<run-id>/agent/outputs/<invocation-id>.json
PANCREATOR_EXEC_ROOT=worktrees/operator/candidate ./bin/pan worktree list --json
```

The candidate must be a Pancreator checkout with an executable `bin/run-built`,
the expected package name, and a source or built CLI. A missing or invalid
candidate fails with `EXEC_ROOT_INVALID`; selection never falls back to another
checkout.

Only the candidate's build wrapper and CLI execute. The controller need not
compile. Its installation remains the working directory, so relative output
paths and other command arguments keep their installation meaning. Relative
execution roots also resolve from the installation, even when the wrapper is
called from another directory.

`PANCREATOR_ROOT` remains pinned to the installation, retaining run state,
worktree indices, caches, and mutexes there. An existing explicit
`PANCREATOR_ROOT` pin is preserved. The execution override is removed before the
candidate starts; unrelated child invocations therefore select their own
checkout. Build readiness is scoped to the checkout that produced it.

Candidate selection does not change active configuration, historical
snapshots, release authority, or landing requirements.

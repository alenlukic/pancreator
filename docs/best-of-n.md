# Best-of-N

Best-of-N attempts one task with several independent candidate runs, then
consolidates the results into a single implementation. Use it when the approach
matters more than the throughput: different models, or the same model with
different personas, explore the problem in parallel and a dedicated consolidation
run picks the best of what they produced.

The mode is governed by [`BESTOFN-001`](../governance/policies/BESTOFN-001.json).

## Shape of a session

1. `delivery-candidate` runs, one per candidate, each in its own detached Git
   worktree. `delivery-candidate` is `delivery` without the `ship` stage, and
   every gate is autonomous, so a candidate finishes without operator attention.
2. One `metacritic` run in the main workspace. Its `consolidate` stage evaluates
   every candidate diff, writes one consolidated implementation, and then hands
   off to the joint verification stage and release preparation. `ship` keeps
   its operator gate.

Nothing in a session commits, pushes, merges, or deletes a branch. Candidate work
stays uncommitted in its worktree until you remove it.

## Starting a session

Invoke the projected `pan-meta-orchestrator` agent from Cursor chat and give it
the task plus the configs path. It preserves the task under `runtime/inbox/`,
runs `./bin/pan best-of-n init`, and drives the session from there.

The meta-orchestrator runs as a nested subagent. It directly supervises every
session run and invokes run-scoped stage workers in foreground. This flattened
shape avoids an unsupported second level of subagent delegation.

## Configs file

The configs file names one persona-to-model map per candidate, plus one for the
consolidation run. Each map merges over `config.json` defaults, and each model
string uses the same syntax as `config.json`.

```json
{
  "schema_version": 1,
  "candidates": [
    {
      "name": "opus",
      "personas": { "coder": "claude-opus-5[effort=high]" }
    },
    {
      "name": "gpt",
      "personas": { "coder": "gpt-5.6-sol[effort=high]" }
    }
  ],
  "consolidation": {
    "name": "consolidation",
    "personas": { "metacritic": "claude-fable-5[]" }
  },
  "setup": ["npm ci"]
}
```

- At least two candidates are required.
- `name` is optional; candidates default to `candidate-1`, `candidate-2`, and so
  on. Names must be lowercase, alphanumeric, and hyphen-separated.
- `setup` commands run once in every fresh worktree. A worktree starts without
  installed dependencies, so declare whatever the repository checks need. A
  failed setup command fails `init`.
- Every persona key must name a persona the candidate or consolidation workflow
  declares, or one `config.json` maps a default for. A misspelled key fails
  `init` instead of silently running the default model.
- The consolidation map is validated at `init` with the same rigor as the
  candidates, so a bad consolidation config cannot surface only after N
  candidate runs completed. `consolidate` also verifies the stored configs copy
  still matches the digest recorded at `init`.

Each candidate gets run-scoped Cursor subagent variants at
`.cursor/agents/pan-<persona>--<suffix>.md` carrying its models. They are
disposable, like everything else under `.cursor/`.

## Commands

| Command                                                                                                      | Effect                                                                   |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `pan best-of-n init --request <file> --configs <file> [--workflow <slug>] [--consolidation-workflow <slug>]` | Creates the worktrees, the agent variants, and the candidate runs.       |
| `pan best-of-n status <bon-id>`                                                                              | Reports each candidate's run status and whether consolidation can start. |
| `pan best-of-n refresh-agents <bon-id>`                                                                      | Rebuilds run-scoped agents from each run's pinned model snapshot.        |
| `pan best-of-n abandon <bon-id> <run-id> --note <reason>`                                                    | Records your decision to exclude one candidate.                          |
| `pan best-of-n consolidate <bon-id>`                                                                         | Writes the consolidation request and creates the `metacritic` run.       |
| `pan best-of-n clean <bon-id> [--force]`                                                                     | Removes the worktrees and the agent variants.                            |
| `pan best-of-n prune [--force]`                                                                              | Removes dangling resources from every finished or missing session.       |

Only one of these commands mutates a session at a time. A second command that
arrives while another is still writing the session record fails with
`RUN_OPERATION_IN_PROGRESS` instead of overwriting it, and a mutex left behind by
a killed command is recovered automatically.

Every session command also reconciles the record against the child runs' own
durable state. A process killed between creating a child run and recording it in
the session cannot orphan the run: `status` reports the adopted view, the next
mutating command persists it, and a retried `consolidate` adopts the existing
consolidation run instead of creating a second one against the same workspace.

## When init fails

`init` records the session before it creates the first worktree, so a failure
part-way through leaves a session you can inspect and remove rather than orphaned
worktrees. The failure message names the session id and both recovery commands.

`status` reports such a session as `session_status: "initializing"` and lists the
claimed-but-incomplete slots under `incomplete`. `consolidate` refuses it,
because its candidate set was never completed. Remove it with `clean` and start a
new session.

## When a candidate fails

An ordinary terminal candidate failure remains evidence and does not stop the
other candidates. The meta-orchestrator continues and consolidates when at least
one candidate succeeds.

A non-terminal candidate stops only when it cannot execute because required
bytes, state, workspace, authentication, or tools are unavailable. The
meta-orchestrator reports that blocker with the run id and durable evidence.

Consolidation starts only when every candidate is finished or excluded, and at
least one candidate succeeded. With no successful candidate the session is
blocked, and `consolidate` exits non-zero.

An excluded candidate is still listed in the consolidation request and still gets
evaluated. Exclusion removes it from the success count, not from the evidence.

## Cleaning up

`clean` is destructive: candidate work is never committed, so removing a dirty
worktree discards it. The command refuses a dirty worktree unless you pass
`--force`. It also refuses while a non-abandoned candidate run or the
consolidation run is still in flight — a candidate at intake or plan has a
clean worktree that is still its workspace, and the consolidation run reads the
candidate worktrees and needs its agent variants for every later operation.
Finish or abort the runs first, or pass `--force` to discard them. `clean`
never deletes a branch or a commit.

`prune` cleans completed sessions and removes orphaned registered worktrees and
run-scoped agent variants. It always preserves active or consolidation-ready
sessions. It reports active, dirty, or unregistered resources under `skipped`;
`--force` permits only the dirty terminal or orphaned worktrees.

## Known gaps

- `pan archive` does not remove `runtime/logs/best-of-n/` session records.
- N concurrent runs multiply model cost, and their repository checks compete for
  the same package caches and ports.

# Runtime protocol

## Run invariants

- One run executes one workflow snapshot.
- A run has exactly one current stage or a terminal status.
- A run exposes exactly one pending action.
- State changes occur under a per-run exclusive file lock.
- `state.json` is atomically replaced; `events.jsonl` is append-only.
- Every invocation has a unique ID and one canonical output path.
- Repeating `pan prepare` while an invocation is pending returns the same invocation.
- Output from any other invocation ID is rejected.

## Pending actions

| Action                  | Owner                     | Meaning                                        |
| ----------------------- | ------------------------- | ---------------------------------------------- |
| `prepare_invocation`    | supervisor/CLI            | Generate the next immutable invocation card    |
| `invoke_agent`          | supervisor + named worker | Execute the card and write its declared output |
| `supervisor_assessment` | supervisor                | Judge only the listed prose criteria           |
| `operator_approval`     | operator                  | Ratify intake or release preparation           |
| `operator_decision`     | operator                  | Resolve a pause/circuit breaker                |
| `none`                  | nobody                    | Run is terminal                                |

## Effective stage outcome

A stage is successful only when all of the following hold:

1. Output shape is valid and belongs to the active invocation.
2. Every declared criterion has a self-evaluation.
3. No hard self-evaluated criterion is failed or marked not applicable.
4. Workspace mutation policy is respected.
5. Every hard deterministic criterion passes.
6. The worker result is `success`.

A `blocked` result pauses. A failure follows the declared remediation transition. A successful result may still wait at a supervisor or operator gate.

## Evidence and invalidation

Every deterministic check records:

- exact command
- start and finish time
- exit code or signal
- stdout and stderr
- workspace fingerprint

Review and QA records also carry a workspace fingerprint. Ship refuses stale QA evidence if the Git-visible workspace changed after QA.

## Circuit breakers

Each workflow declares:

- maximum total transitions
- maximum attempts per stage
- maximum consecutive failures

Exceeding a limit pauses the run and writes a decision record. The operator may resume from an explicit stage or abort. The harness never silently resets a budget.

## Recovery

- Inspect: `./bin/pan status <run-id> --json`
- Resume same stage: `./bin/pan resume <run-id>`
- Resume chosen stage: `./bin/pan resume <run-id> --stage implement`
- Abort: `./bin/pan abort <run-id> --note "reason"`

Do not repair state by editing files. A future repair command can be added once real corruption modes are observed.

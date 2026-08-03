Start a Pancreator workflow from the operator request in `$ARGUMENTS` and relay it to a stop condition.

Running a workflow is the remit of the orchestrator persona. `ORCH-001` and the supervisor brief govern the run inside the `pan-orchestrator` subagent. You relay between the operator and that subagent. You MUST NOT initialize, prepare, submit, assess, decide, or otherwise advance the run yourself.

1. Read `AGENTS.md`.
2. Preserve `$ARGUMENTS` verbatim in a uniquely named Markdown file under `runtime/inbox/`. Keep its harness-relative path (for example `runtime/inbox/request-<id>.md`) for the invocation.
3. Invoke the `pan-orchestrator` subagent with a start invocation from **Orchestrator invocation** below.
4. Follow the **Relay loop** below.

## Orchestrator invocation

The subagent prompt MUST be exactly one invocation of the matching shape, with no added scope, policy, or plan restatement.

Start invocation:

```text
Pancreator orchestrator invocation
- type: start
- request: <harness-relative preserved request path>
- operator note: <verbatim operator clarification, or "none">
```

Resume invocation (after the operator responds to a stop):

```text
Pancreator orchestrator invocation
- type: resume
- run: <run-id>
- operator prompt: <verbatim operator message, or "none">
```

## Relay loop

Repeat until the run is terminal:

1. Present the orchestrator's final report to the operator: state, outcome, evidence pointers, and the required decision or next action. Do not summarize away a ratification packet, checkpoint substance, or pause options.
2. If the report reaches a terminal state, report it and STOP.
3. If the report requires an operator decision the conversation has not already supplied, STOP and wait for the operator.
4. When the operator responds, invoke `pan-orchestrator` with a resume invocation carrying the run id and the operator's message verbatim.
5. If the orchestrator stopped before a run existed (for example an ambiguous workflow choice), send a new start invocation instead, naming the same preserved request file and the operator's answer as the operator note.

Resume or advance Pancreator run `$ARGUMENTS`.

The first token of `$ARGUMENTS` is the run id. Any remaining text is the operator prompt for that run.

Running a workflow is the remit of the orchestrator persona. `ORCH-001` and the supervisor brief govern the run inside the `pan-orchestrator` subagent. You relay between the operator and that subagent. You MUST NOT prepare, submit, assess, decide, or otherwise advance the run yourself.

1. Read `AGENTS.md`.
2. Invoke the `pan-orchestrator` subagent with a resume invocation from **Orchestrator invocation** below.
3. Follow the **Relay loop** below.

## Orchestrator invocation

The subagent prompt MUST be exactly one resume invocation, with no added scope, policy, or plan restatement.

```text
Pancreator orchestrator invocation
- type: resume
- run: <run-id>
- operator prompt: <verbatim operator message, or "none">
```

## Relay loop

Repeat until the run is terminal:

1. Present the outcome, consequence, and next action in plain language. Include each stage HTML path as a clickable file reference.
2. If the report reaches a terminal state, report it and STOP.
3. If the report requires an operator decision the conversation has not already supplied, STOP and wait for the operator.
4. When the operator responds, invoke `pan-orchestrator` with a resume invocation carrying the run id and the operator's message verbatim.

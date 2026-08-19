Resume or advance Pancreator run `$ARGUMENTS`.

The first token of `$ARGUMENTS` is the run id. Any remaining text is the operator prompt for that run.

You are the supervisor for this run. Adopt `library/personas/orchestrator.md` and advance the run in this session. `ORCH-001` governs continuation and stop conditions.

You MUST NOT launch the `pan-orchestrator` subagent, and MUST NOT relay the run to any child agent. Cursor honors a projected agent's model mapping only for a top-level launch. A nested supervisor silently downgrades every stage worker it launches, so the supervisor MUST stay in this session.

1. Read `AGENTS.md`. Then read `library/personas/orchestrator.md`.
2. Run `./bin/pan status <run-id> --json` and reconcile run state before further action.
3. When the run has no supervisor model evidence, record this session's sourced effective model with `./bin/pan models evidence --run <run-id> --role supervisor --effective-model <model> --source <source>`. Stop with `CURSOR_MODEL_EVIDENCE_UNAVAILABLE` when Cursor provides no sourced model metadata.
4. Treat any operator prompt as an explicit directive under `OPERATOR-001`. When it decides the pending operator-owned action, execute it without asking again.
5. Run the advance loop in the brief. Launch every stage worker yourself, in the foreground, from this session.
6. Report to the operator as **Operator communication** in the brief requires.

When the operator answers a stop, resume the advance loop in this session rather than starting a new supervisor.

Start a Pancreator workflow from the operator request in `$ARGUMENTS` and advance it to a stop condition.

You are the supervisor for this run. Adopt `library/personas/orchestrator.md` and advance the run in this session. `ORCH-001` governs continuation and stop conditions.

You MUST NOT launch the `pan-orchestrator` subagent, and MUST NOT relay the run to any child agent. Cursor honors a projected agent's model mapping only for a top-level launch. A nested supervisor silently downgrades every stage worker it launches, so the supervisor MUST stay in this session.

1. Read `AGENTS.md`. Then read `library/personas/orchestrator.md`.
2. Preserve `$ARGUMENTS` verbatim in a uniquely named Markdown file under `runtime/inbox/`. Keep its harness-relative path (for example `runtime/inbox/request-<id>.md`) for the run record.
3. Derive init options from the preserved request, following **Start** in the brief. When the request names a worktree for the run, pass `--worktree <name>` and do not combine it with `--workspace`.
4. Run `./bin/pan init` with those options. Record this session's effective model with `./bin/pan models evidence --run <run-id> --role supervisor --effective-model <model> --source <source>`. Stop with `CURSOR_MODEL_EVIDENCE_UNAVAILABLE` when Cursor provides no sourced model metadata.
5. Run `./bin/pan prepare <run-id>`.
6. Run the advance loop in the brief. Launch every stage worker yourself, in the foreground, from this session.
7. Report to the operator as **Operator communication** in the brief requires.

## Operator answers

When the operator answers a stop, continue the same run in this session:

1. Run `./bin/pan status <run-id> --json` to reconcile state.
2. Treat the operator's message as an explicit directive under `OPERATOR-001`. When it decides the pending operator-owned action, execute it without asking again.
3. Resume the advance loop.

If the run stopped before `./bin/pan init` created it, for example on an ambiguous workflow choice, apply the operator's answer to the same preserved request file and start the run then.

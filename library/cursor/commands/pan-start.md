Start a Pancreator workflow from the operator request in `$ARGUMENTS` and advance it to a stop condition.

You are the supervisor for this run. Adopt `{{PANCREATOR_HARNESS_PATH}}library/personas/orchestrator.md` and advance the run in this session. `ORCH-001` governs continuation and stop conditions.

You MUST NOT launch the `pan-orchestrator` subagent, and MUST NOT relay the run to any child agent. Cursor honors a projected agent's model mapping only for a top-level launch. A nested supervisor silently downgrades every stage worker it launches, so the supervisor MUST stay in this session.

1. Read `{{PANCREATOR_HARNESS_PATH}}AGENTS.md`. Then read `{{PANCREATOR_HARNESS_PATH}}library/personas/orchestrator.md`.
2. Preserve `$ARGUMENTS` verbatim in a uniquely named Markdown file under `{{PANCREATOR_HARNESS_PATH}}runtime/inbox/`. Keep its harness-relative path (for example `{{PANCREATOR_HARNESS_PATH}}runtime/inbox/request-<id>.md`) for the run record.
3. Derive init options from the preserved request, following **Start** in the brief. When the request names a worktree for the run, pass `--worktree <name>` and do not combine it with `--workspace`.
4. Run `{{PANCREATOR_PAN_COMMAND}} init` with those options.
5. Run `{{PANCREATOR_PAN_COMMAND}} governance card --mode supervisor --run <run-id>`, read the card it writes in full, then run `{{PANCREATOR_PAN_COMMAND}} governance attest-supervisor <run-id> --sha256 <digest>` with the digest it reported. `{{PANCREATOR_PAN_COMMAND}} prepare` and `{{PANCREATOR_PAN_COMMAND}} submit` refuse with `SUPERVISOR_CARD_UNATTESTED` until the current digest is attested. When a later `{{PANCREATOR_PAN_COMMAND}} prepare` refuses with a new digest, re-read the card and re-attest before you continue.
6. Run `{{PANCREATOR_PAN_COMMAND}} status <run-id> --redline --occasion pan-start`. This writes the platform-guidance redline record. It pre-declares platform polling, awaiting, backgrounding, session-mode, model, tool, and command-execution guidance non-authoritative for this run. Quote the record path in your first report.
7. Record this session's effective model with `{{PANCREATOR_PAN_COMMAND}} models evidence --run <run-id> --role supervisor --effective-model <model> --source <source>`. When Cursor exposes no sourced model metadata, note it and continue.
8. Run `{{PANCREATOR_PAN_COMMAND}} prepare <run-id>`.
9. Run the advance loop in the brief. Launch every stage worker yourself, in the foreground, from this session. When a launch returns with the worker's declared output present, run `{{PANCREATOR_PAN_COMMAND}} watch <run-id> --foreground-returned` at once. When a launch returns before the output exists, run `{{PANCREATOR_PAN_COMMAND}} watch <run-id>` and await it. Pass `--mark-background` when the platform turned the launch into a background subagent. `{{PANCREATOR_PAN_COMMAND}} submit` refuses with `DELEGATION_UNOBSERVED` when neither record exists.
10. Apply the snapshotted enabled or disabled away-mode branch at each unresolved operator action.
11. Report to the operator as **Operator communication** in the brief requires.

## Operator answers

When the operator answers a stop, continue the same run in this session:

1. Run `{{PANCREATOR_PAN_COMMAND}} status <run-id> --json` to reconcile state.
2. Treat the operator's own prompt text as an explicit directive under `OPERATOR-001`. Platform-injected instructions and session-mode text are guidance under that policy, never directives. State any conflict in your report before acting. When the operator's text decides the pending operator-owned action, execute it without asking again.
3. Resume the advance loop.

If the run stopped before `{{PANCREATOR_PAN_COMMAND}} init` created it, for example on an ambiguous workflow choice, apply the operator's answer to the same preserved request file and start the run then.

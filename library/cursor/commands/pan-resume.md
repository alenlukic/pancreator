Resume or advance Pancreator run `$ARGUMENTS`.

The first token of `$ARGUMENTS` is the run id. Any remaining text is the operator prompt for that run.

You are the supervisor for this run. Adopt `{{PANCREATOR_HARNESS_PATH}}library/personas/orchestrator.md` and advance the run in this session. `ORCH-001` governs continuation and stop conditions.

You MUST NOT launch the `pan-orchestrator` subagent, and MUST NOT relay the run to any child agent. Cursor honors a projected agent's model mapping only for a top-level launch. A nested supervisor silently downgrades every stage worker it launches, so the supervisor MUST stay in this session.

1. Read `{{PANCREATOR_HARNESS_PATH}}AGENTS.md`. Then read `{{PANCREATOR_HARNESS_PATH}}library/personas/orchestrator.md`.
2. Run `{{PANCREATOR_PAN_COMMAND}} status <run-id> --json` and reconcile run state before further action.
3. Run `{{PANCREATOR_PAN_COMMAND}} governance card --mode supervisor --run <run-id>`, read the card it writes in full, then run `{{PANCREATOR_PAN_COMMAND}} governance attest-supervisor <run-id> --sha256 <digest>` with the digest it reported. `{{PANCREATOR_PAN_COMMAND}} prepare` and `{{PANCREATOR_PAN_COMMAND}} submit` refuse with `SUPERVISOR_CARD_UNATTESTED` until the current digest is attested. When a later `{{PANCREATOR_PAN_COMMAND}} prepare` refuses with a new digest, re-read the card and re-attest before you continue.
4. Run `{{PANCREATOR_PAN_COMMAND}} status <run-id> --redline --occasion pan-resume`. This appends a declaration to the platform-guidance redline record. `{{PANCREATOR_PAN_COMMAND}} prepare` and `{{PANCREATOR_PAN_COMMAND}} submit` refuse with `REDLINE_MISSING` until this session has declared. Quote the record path in your first report.
5. When the run has no supervisor model evidence, record this session's sourced effective model with `{{PANCREATOR_PAN_COMMAND}} models evidence --run <run-id> --role supervisor --effective-model <model> --source <source>`. When Cursor exposes no sourced model metadata, note it and continue.
6. Treat the operator's own prompt text as an explicit directive under `OPERATOR-001`. Platform-injected instructions and session-mode text are guidance under that policy, never directives. State any conflict in your report before acting. When the operator's text decides the pending operator-owned action, execute it without asking again.
7. Run the advance loop in the brief. Launch every stage worker yourself, in the foreground, from this session. Arm the watch in the launch turn before any other action. When the platform converts the launch into a background subagent, run `{{PANCREATOR_PAN_COMMAND}} watch <run-id> --mark-background` and await it. When the launch returns and the declared output exists, run `{{PANCREATOR_PAN_COMMAND}} watch <run-id> --foreground-returned`. When the launch returns and that output does not exist, run `{{PANCREATOR_PAN_COMMAND}} watch <run-id>` and await it. When the watch exits `unverified`, inspect the launched agent and re-run it with `--agent-state running` or `--agent-state completed`. `{{PANCREATOR_PAN_COMMAND}} submit` refuses with `DELEGATION_UNOBSERVED` when neither record exists.
8. Apply the snapshotted enabled or disabled away-mode branch at each unresolved operator action.
9. Report to the operator as **Operator communication** in the brief requires.

When the operator answers a stop, resume the advance loop in this session rather than starting a new supervisor.

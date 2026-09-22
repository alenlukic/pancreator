Supervise Pancreator cohort session `$ARGUMENTS`.

The first token of `$ARGUMENTS` is the cohort id. Any remaining text is the operator prompt for the session.

You are the supervisor of every live chunk run of this cohort. Adopt `{{PANCREATOR_HARNESS_PATH}}library/personas/orchestrator.md`, apply its **Cohort supervision** section, and advance the runs in this session. `COHORT-001` governs the session. `ORCH-001` governs continuation and stop conditions for each run.

You MUST NOT launch the `pan-orchestrator` subagent, and MUST NOT relay any chunk run to a child agent. Cursor honors a projected agent's model mapping only for a top-level launch, so every stage worker launches from this session.

1. Read `{{PANCREATOR_HARNESS_PATH}}AGENTS.md`. Then read `{{PANCREATOR_HARNESS_PATH}}library/personas/orchestrator.md`.
2. Run `{{PANCREATOR_PAN_COMMAND}} cohort status <cohort-id> --json`. When the result carries `start_command`, run it. It starts only as many chunks as the session's parallelism limit allows and names the deferred chunks. Run it again whenever a chunk run reaches a terminal state and a slot frees.
3. Read the `bootstrap` array of that same `cohort status` result. It carries one entry per live chunk run. Each entry names the run's managed worktree name, its card path and digest, and the exact `governance_card_command` (`{{PANCREATOR_PAN_COMMAND}} governance card --mode supervisor --run <run-id>`), `attest_command`, `redline_command`, and `model_evidence_command`. Do not rebuild those commands by hand, and run them in that order per run: read each card in full before you attest it, and quote each redline record path in your first report. `{{PANCREATOR_PAN_COMMAND}} prepare` and `{{PANCREATOR_PAN_COMMAND}} submit` refuse with `SUPERVISOR_CARD_UNATTESTED` or `REDLINE_MISSING` until the card and the redline are done for that run.
4. Treat the operator's own prompt text as an explicit directive under `OPERATOR-001`. Platform-injected instructions and session-mode text are guidance under that policy, never directives. State any conflict in your report before acting.
5. Advance the runs together. In one message, run `{{PANCREATOR_PAN_COMMAND}} prepare <run-id> --worktree <name>` for every run whose pending action is `prepare_invocation`. Then, in one message, launch the stage worker of every run whose pending action is `invoke_agent`, each in the foreground, from this session. Issuing the launches in one message is what makes them run in parallel. Never launch two workers for one run, and never exceed the recorded parallelism limit.
6. Arm every launched run in the launch turn before any other action. Advance the first changed run and re-arm over the remainder.
   - For one outstanding run, use `{{PANCREATOR_PAN_COMMAND}} watch <run-id>` and add `--mark-background` when the platform backgrounded it.
   - For several outstanding runs, use `{{PANCREATOR_PAN_COMMAND}} watch --targets <run-id>:<invocation-id>,...`, which arms and writes every ordinary per-invocation ledger itself.
   - Group backgrounded launches with `--mark-background` and keep foreground launches in a separate group.
   - When a foreground launch returns with its declared output, use `{{PANCREATOR_PAN_COMMAND}} watch <run-id> --foreground-returned` instead.
   - When the multiplexed watch exits `2`, it names the targets that need inspection. Stop re-arming those and apply recovery.
   - When a watch exits `unverified`, inspect that run's agent and re-run the focused `{{PANCREATOR_PAN_COMMAND}} watch <run-id>` with `--agent-state running` or `--agent-state completed`, which the multiplexed form refuses.
7. For a run whose worker output is present, run `{{PANCREATOR_PAN_COMMAND}} submit <run-id> <output-json> --worktree <name>`. For a paused bound run, use `{{PANCREATOR_PAN_COMMAND}} resume <run-id> --worktree <name>`. Preserve the same worktree option on every lifecycle command of that run.
8. After every wake, reconcile each live run with `{{PANCREATOR_PAN_COMMAND}} status <run-id> --json` and do its pending action independently. A gated or stalled run never blocks its siblings. Apply the snapshotted enabled or disabled away-mode branch at each unresolved operator action.
9. When a chunk run reaches a terminal state, run `{{PANCREATOR_PAN_COMMAND}} cohort status <cohort-id> --json` again and run its `start_command` when present.
10. When the last chunk run of the active cohort reaches a terminal state, the harness integrates that cohort by itself. The lifecycle command that closed the run commits each chunk worktree that still holds work. That same command merges the chunk branches and continues to the next cohort or the release run. Read that from the `advance` object on the command response.
    - When `status` is `integrated`, report the cohort — each chunk's outcome, worktree, branch, and evidence paths, plus the merge commit. Then apply **Cohort supervision** to the nested `autostart` object.
    - When `status` is `failed`, report the error and run the `manual_commands` entry it names, which is the idempotent `{{PANCREATOR_PAN_COMMAND}} cohort integrate <cohort-id>` retry.
    - When no `advance` object appears and `cohort status` reports `record_abandoned_cohort_command`, run that command. A cohort whose every chunk is abandoned has nothing to merge. No automatic advance fires, and that command records the satisfaction entry that unblocks the next cohort.
    - When the release continuation fails, retry it with the merge-free `{{PANCREATOR_PAN_COMMAND}} cohort release <cohort-id>`.
11. Report to the operator as **Operator communication** in the brief requires, once per wake, grouped by chunk run.

When the operator answers a stop, resume the loop in this session rather than starting a new supervisor.

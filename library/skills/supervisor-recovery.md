# Supervisor recovery

Use when a supervisor resumes an interrupted run or session, or meets a
coordination failure during supervision. `ORCH-001` and `BESTOFN-001` reference
this skill. It binds the orchestrator and the meta-orchestrator equally.

## Principle

Harness records are the source of truth, and delegation is not idempotent. A
resumed supervisor knows nothing about work in flight until it reconciles
recorded state. A second worker on one invocation contaminates the workspace,
and no later verification from that workspace can be trusted or attributed.

## Resume procedure

Follow these steps after any interruption: a session timeout, a crash, a lost
subagent result, or a handoff from an earlier supervisor pass.

1. Reconcile state from records, not from memory or from the resume prompt
   alone. Run `./bin/pan status <run-id>` for each run, and
   `./bin/pan best-of-n status <bon-id>` for a session.
2. Read `pending_action` and the current invocation id before any action.
3. When `pending_action` is `invoke_agent`, do not delegate immediately. First
   establish whether a worker from the interrupted pass is still active on that
   invocation.
4. Inspect the evidence of prior delivery: the
   `invocations/<invocation-id>.delegation.md` record, worker content in the
   declared stage output beyond the scaffold, and fresh edits in the run
   workspace (`git -C <workspace> status --porcelain` plus recent file
   modification times).
5. When prior delivery is evident and liveness is uncertain, observe the
   workspace over an interval. A quiet tree across two checks several minutes
   apart, with no worker result pending in your own session, indicates the
   prior worker ended.
6. Relaunch a worker only after the prior worker's end is established. When
   liveness cannot be established, report the ambiguity to the operator instead
   of launching a duplicate.
7. Record in your report what you found, what you concluded, and why a relaunch
   was or was not safe.

## Duplicate worker containment

Apply these steps when two workers hold one invocation, whether discovered
mid-flight or from a worker's blocked output.

1. Stop further delegation for that run immediately.
2. Treat any verification result produced while the tree was shared as
   untrusted evidence. Do not submit it as a product verdict.
3. Preserve both workers' outputs and the workspace as evidence. Do not revert
   or clean.
4. Surface the conflict to the operator with the run id, the invocation id, and
   the overlap evidence. The operator selects the owning attempt, typically
   through `pan resume --stage <stage> --note <directive>` for a rerun with one
   owner.

## Common failures

| Symptom                                           | Likely cause                                                  | First action                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pending_action` is `invoke_agent` after a resume | The interrupted pass may already hold an active worker        | Run the resume procedure before delegation                                                     |
| Delegation record missing for a delivered card    | The interrupted pass stopped between delivery and persistence | Repair the record against the same active invocation                                           |
| Harness command emits no output for minutes       | A long test or build rather than a hang                       | Inspect the process tree before you declare a hang                                             |
| Unexplained edits in a run workspace              | A concurrent agent or an operator edit                        | Pause delegation and report. Do not absorb the edits into stage evidence                       |
| Harness automation fails with an internal error   | A harness defect                                              | Report the automation failure with its exact command. Do not hand-assemble the result silently |

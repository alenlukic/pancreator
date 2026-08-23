# Hypervisor procedure

Use this procedure for a scheduled or manual hypervisor tick.

## Health scan

1. Reconcile active run invocations with registry, transcript, process, and executor evidence.
2. Keep health unknown when the evidence cannot prove a state.
3. Require two unchanged scans before a stalled verdict.
4. Write the registry atomically.
5. Append each health change to the event log.

## Recovery

1. Never recover an agent with unknown health.
2. Try a nudge before a session resume.
3. Try validated re-delivery when resume is unavailable.
4. Re-prepare only after validation or workspace drift.
5. Quarantine the second matching recovery failure.

## Away decision

1. Rank only actions permitted by the run snapshot.
2. Reject each option without a complete manual rollback plan.
3. Reject hard-denied actions before a model ranks them.
4. Append the evaluation and apply result to the ledger.

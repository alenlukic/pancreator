# Copilot process observation

Run-scoped focused and multiplexed watches use indexed activity when available.
An absent or unregistered launch handle, or a lookup with no activity, falls
back to the Copilot process observer. An unrelated unknown agent ID still
reports `unregistered`.

The observer consumes the existing `DelegationLiveRecord` for the active run,
invocation, stage role, and attempt. It selects the newest unambiguous launch
created after the invocation. Equal-time launches leave activity unknown, but
their launch time still bounds final audit freshness: an older audit cannot
complete the watch or release submission. A live observation requires recorded process
start identities and an explicit wrapper record link. The sampled relay and
child must belong to that wrapper's process tree. Missing identity, an
unreadable process table, or a missing wrapper remains unknown.

A matching process and a wrapper heartbeat no older than two wrapper heartbeat
intervals suppress silence stalls. Watch output and attach liveness label this
basis `process`. Heartbeat snapshot rewrites do not change the progress
fingerprint; emitted relay events still do.

Two consecutive wakes with the same launch and deterministic fault retain the
existing causes: `shell_dead`, `shell_stopped`, and `shell_heartbeat_stale`.
PID reuse is a dead identity, never evidence that the original worker lives.

Only the matching final execution audit establishes a process stop. It must
name the run, invocation, executor, and stage, and postdate the invocation and
latest live launch. A successful stop requires exit zero, no timeout or error,
and a nonempty result session. A failed exit, timeout, or missing result ends
the watch as unverified. A live completion event, an ended relay snapshot, or
a plausible stage output alone cannot complete a process-backed watch.
Submission's activity guard requires the same matching final audit. A missing
or nonmatching audit blocks submission because execution remains active or
unverified. A matching error audit releases activity custody, but does not
establish a successful watch or stage result.

The watch still wakes every 60 seconds. Attach recovery, ledger fields, output
requirements, and terminal evidence rules retain their existing contracts.

## Recorded retries

A declared stage-worker retry can replace an earlier executor pin only after
both the prior child and relay have ended and the previous watch is terminal.
Both host handles must belong to ordered worker records for that invocation.
An unknown handle, an active predecessor, or an unfinished watch cannot reset
the pin. The same worker still keeps its original launch clock when rearmed.

Before adopting the retry, the harness retains the prior launch record, watch
ledger, blocking receipts, background marker, and foreground-return attestation
under `<invocation>-worker-attempt-<previous-attempt>/` in the evidence directory.
The active launch is replaced atomically and uses the retry's recorded clock;
old observations never count as supervision of the new worker. The observer then
selects the retry's unambiguous live identity and validates its matching final
audit through the ordinary completion checks. Submission uses the same recovery,
including for an existing declared retry recorded before this repair.

Automatic verification regrading can start sequential executor sessions inside
one controller wrapper. The original pin anchors that wrapper. The observer
follows its protected custody records to the latest child, rejects overlapping
or simultaneous children, and requires the public mirror to match the protected
record. A missing or changed mirror cannot make an older audit complete a newer
child. A different controller still needs the declared retry procedure above.

Protected predecessor records establish termination when available. A public
claim that a predecessor ended cannot override protected evidence that it runs.

The regression in
[`copilot-retry-observation.test.ts`](../tests/regression/copilot-retry-observation.test.ts)
proves retained history, retry completion, idempotent rearming, recovery at
submission, controller lineage, mirror integrity, and rejection of undeclared
or still-active replacements.

## Denied reads

A denied plain `ls`, `cat`, `pwd`, or `ps` command is a read failure, rather than
a write attempt. This recognition accepts only literal arguments and ordinary
quoted paths. Shell substitutions, redirections, compound commands, and unknown
executables retain the existing unresolved denial record. The process sandbox
and write authorization checks remain authoritative. The regressions in
[`scope-custody.test.ts`](../tests/unit/scope-custody.test.ts) cover the observed
listing failure and preserve denial records for commands that could write.

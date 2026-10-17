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

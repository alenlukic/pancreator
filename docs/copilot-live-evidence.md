# Copilot live evidence

Copilot delegation remains synchronous. The engine holds its operation mutex
while `runCopilotCli` waits for a Node relay child. The relay asynchronously
pumps the CLI; it never changes grants, scope verdicts, or watch policy.

## Wire format

The relay receives one JSON request on stdin: prompt, workspace, model,
tools, `adapterParentPid` (the adapter's PID), optional effort/resume/timeout,
and optional live identity. Credentials travel only in its environment.
CLI stdin receives the prompt; argv carries
only launch settings. Relay stdout carries exactly one final
`CopilotInvocationResult` JSON envelope. Its stdout/stderr fields are sanitized
CLI captures, not relay output. The parent does not replay those captures.
Relay stderr forwards sanitized complete lines as they arrive, so the enclosing
`bin/pan-run` log receives progress before delegation returns.

`DelegationLiveIdentity` names run, invocation, role (`stage` or evidence role),
attempt, and a unique launch UUID. Every adapter call allocates a UUID, including
resume failures and their fresh fallback. Before CLI launch the relay binds a
fresh session UUID with `--session-id=<uuid>`, or uses `--resume=<id>` for an
existing session. `requested_session_id` records that binding separately from
`session_id`, which is populated only by an accepted CLI event naming a session.
`resumed_from_session_id` retains the resume association. Missing observed
identity stays absent, including when an unfinished CLI emits only session
configuration and tool events. Success requires the final result to name the
requested session; an earlier session event does not replace this check.
Every fresh fallback receives a new session UUID and launch UUID.

`delegationLivePaths(root, identity)` resolves these files under the run's
layout-aware evidence directory:

```text
<invocation>.copilot.<role>.attempt-<attempt>.<launch>.live.json
<invocation>.copilot.<role>.attempt-<attempt>.<launch>.events.jsonl
```

The version 1 snapshot carries relay and child PIDs and their `ps` start
identities (null means unknown), launch and heartbeat times, optional
`PAN_RUN_RECORD` wrapper linkage, optional observed session, event and stream
sequences, truncation, and terminal exit/signal/error fields. It is written
before CLI launch, updated at child launch and every event, and refreshed every
30 seconds. `ended_at` is written after CLI close and stream drainage, or when
startup fails before a CLI exists.
The final delegation execution audit remains separate.

The event file is append-only, with one sanitized `DelegationLiveEvent` per
line. Each carries launch UUID, globally increasing sequence, stream,
per-stream sequence, receipt time, kind, and complete sanitized text. Kinds are
assistant, tool, session, completion, and diagnostic. Unknown/malformed JSON
and stderr remain diagnostics. A completion event is an observation, not proof
of process success. Sequence order reflects receipt of complete lines by the
relay; cross-stream order is not a provider guarantee. UTF-8 decoding and
secret-prefix buffering precede framing, so partial bytes and split keys do
not leak. Known credential values, their JSON-escaped forms, and exact prompt
echoes are redacted before capture, persistence, or progress output.
Complete matches stay buffered while an overlapping longer credential can
still arrive. Divergent continuations and the final flush resolve that
ambiguity without disclosing a credential suffix.

## Bounds and recovery

Raw CLI output and the event file each have a 64 MiB ceiling. Frames have a
4 Mi character ceiling (JavaScript UTF-16 code units). This supports bounded CLI
tool-result frames larger than the previous 256 Ki character allowance while
keeping the aggregate budgets unchanged. Exceeding a bound fails delegation explicitly and
marks truncation; the raw-output ceiling is configurable downward for tests.
The relay's internal limits argument supports small saturation fixtures without
adding a wire setting. Production calls use `COPILOT_RELAY_LIMITS`: `4 * 1024 * 1024`
frame characters and `64 * 1024 * 1024` serialized event bytes.
Diagnostics identify the frame, aggregate-output, or event-file cause and give
the observed size, limit, units, and raw output byte count without echoing rejected
content. Frame and aggregate diagnostics also name the stream and accepted
event-file bytes. Observed sizes describe the first detected overflow, not the
full size of a rejected frame that has not finished arriving.
Timeout, signal, spawn, evidence-write, and model mismatch failures cannot
become success merely because a result event appeared.

The CLI runs in its own process group. The relay terminates that group on
failure, escalates to SIGKILL after 500 ms, and kills remaining descendants
after close. Signal handlers own cleanup before the detached child is spawned.
The adapter binds its PID into the private request before spawning the relay.
The relay validates that PID and checks ownership before creating a CLI,
including when the adapter exits before relay entry or during stdin delivery.
It checks again after identity lookup and continues checking for parent loss.
The synchronous parent has an outer timeout with a grace period for relay cleanup.

Readers use `loadDelegationLiveRecord(root, identity)`. Missing files return
null; malformed records, path escape, and mismatched attempts throw. Writers
reject launch reuse, sequence regression, and updates after terminal state.
Readers must bind the full identity and check process start identity before
claiming liveness. Older invocations have no live record and retain their
existing observation fallback. No migration is required; rollback stops
producing the additive evidence and leaves prior captures readable.

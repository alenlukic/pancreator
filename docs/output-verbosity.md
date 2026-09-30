# Execution output and Cursor SDK logging

`OUTPUT-001` owns the deterministic execution-output contract: what `bin/run-quiet`
suppresses or replays, and what the Cursor SDK invocation logger emits. `COMMS-001`
owns the operator-facing rules an agent obeys when it reports progress, a finding,
or a failure in chat.

## npm scripts

Verification-oriented scripts run through `bin/run-quiet`. The wrapper
captures stdout and stderr, emits nothing on stdout when the command succeeds,
and replays the captured output when it fails. npm lifecycle banners are
disabled by the repository `.npmrc`. The aggregate `npm run check` command
applies the same contract across build, lint, and validation. Test execution
belongs to `npm test` and `npm run test:coverage`, so a passing check never
runs the suite.

When stderr is an interactive terminal, the wrapper prints one `.` to stderr
for each five-second interval in which the wrapped command produced new
output, then a closing newline. The dots track real progress, not wall
clock: a flowing stream means the command is still emitting output, and a
stopped stream means it has gone silent, which usually signals a hang.
By default ticks stay off whenever stderr is not a terminal, so captured or
redirected output stays byte-identical to the quiet contract. `PAN_PROGRESS=1`
forces ticks on even when stderr is captured, in which case the dots land in
the capture; a caller that compares captured bytes clears the opt-in.
`PAN_PROGRESS=0` forces them off, and `PAN_PROGRESS_INTERVAL_SECONDS`
overrides the interval.

Nested wrappers share one tick sink. The outermost wrapper that enables ticks
opens a private copy of its stderr and exports it as `PAN_PROGRESS_FD`; every
wrapper below it writes dots there and treats the variable as its enable
condition. `npm run check` therefore ticks from the step that is producing
output, even though the outer wrapper observes no bytes until a step fails.

Test scripts run `node --test` with the failures-only reporter at
`tests/reporters/failures-only.ts`. The reporter prints one block per failed
test, with its name, location, and error, and then the run summary. It prints
nothing for a passing test, so a failing run replays only the failures.
`./bin/pan tests impacted` (`npm run test:impacted`) runs the same reporter over
only the lane tests the changed files reach; `--list` prints the selection
without a run.

Set `PAN_VERBOSE=1` to stream command output while diagnosing a problem:

```sh
PAN_VERBOSE=1 npm test
```

Commands such as `npm run pan`, `npm run validate`, migrations, and Markdown
validation still emit their requested result payloads. Their prerequisite build
step remains quiet.

Deterministic coverage:

- `tests/integration/quiet-command.test.ts`

The former `tests/unit/npm-verbosity.test.ts` and `tests/unit/bin-layout.test.ts` were deleted as
config-shape tests; `runtime/inbox/test-audit-20260829-verdicts.md` records both verdicts.

## Cursor SDK invocations

`src/lib/cursor-sdk-logging.ts` wraps a Cursor SDK run without depending on
unstable tool argument or result schemas. It consumes the stable stream-event
envelope and renders a low-chrome operator transcript:

- concise assistant plan and progress summaries
- grouped tool-call logs such as `Explored 3 files` or `Ran 2 commands`
- explicit findings and issues
- a current-task update after 120 seconds without another visible emission

The wrapper accepts an optional `recordEvent` sink so callers can persist raw SDK
events separately from the summarized operator stream.

```ts
const result = await withCursorSdkInvocationLogging({
  task: 'investigating the missed automation',
  invoke: () => agent.send(prompt),
  write: (chunk) => process.stderr.write(chunk),
  recordEvent: (event) => appendSdkEvent(event),
})
```

The repository currently delegates workflow stages through Cursor project
subagents rather than invoking the SDK itself. Under `OUTPUT-001`, new SDK
execution paths use this wrapper at their invocation boundary. The wrapper
renders what the SDK emits; `COMMS-001` governs what an agent writes for the
operator to read.

Deterministic coverage:

- `tests/unit/cursor-sdk-logging.test.ts`

## Agent shell commands

`bin/pan-run` wraps every agent shell command with a redacted durable log, a heartbeat, and an exit record. It accepts two forms:

```sh
bin/pan-run [--label <name>] [--quiet] [--cwd <dir>] [--heartbeat-seconds <n>] -- <command> [args...]
bin/pan-run [same options] -c '<shell string>'
```

Each invocation writes to `runtime/logs/shell/<timestamp>-<label>-<hex>/`. `runtime/logs/shell/latest` links to the newest of these directories, refreshed at every start:

- `record.json` — redacted command, working directory, command and wrapper pids, start and end times, exit code, signal, log path. Written at start and at end.
- `output.log` — redacted output of both streams, appended as the command runs.
- `heartbeat.json` — written at start and on each beat: elapsed seconds, log bytes, the bytes at the previous beat (`last_beat_bytes`), the time of that beat (`beat_at`), the time of the last output, and the last five output lines.
- `stdout.log`, `stderr.log` — in quiet mode only, one per stream. Removed after a successful quiet run; kept for the failure replay.

Streaming mode keeps stdout and stderr on their own streams. The command reads the wrapper's stdin. The wrapper prints one stderr line at start naming the log and the exact `pan watch` observation command:

```
[pan-run] <label> started pid=<pid> log: <log> observe: ./bin/pan watch --process <pid> --label <label> --output <log> --exit-record <record.json>
```

Redaction applies to values from the process environment, from the harness root `.env`, and from the `.env` at the command's Git top level, whose names match `TOKEN`, `SECRET`, `PASSWORD`, `PASSWD`, `API_KEY`, `ACCESS_KEY`, `PRIVATE_KEY`, `CREDENTIAL`, `AUTH`, or `SESSION` (case-insensitive) and are at least 8 characters long. One secret set serves the output, the heartbeat tail, and the recorded command.

The heartbeat cadence defaults to 30 seconds; `--heartbeat-seconds` or `PAN_RUN_HEARTBEAT_SECONDS` can lower it. Any value above 60 is clamped to 60. Heartbeat lines go to stderr when streaming. In quiet mode they go only to `PAN_PROGRESS_FD` or a terminal stderr, and the wrapper exports that sink so nested quiet wrappers beat to it. A beat that found new output prints a header naming the byte growth (`+<n>B`) followed by the last `PAN_RUN_TAIL_LINES` lines (default 5), each indented two spaces; a beat that found none prints `no new output for <n>s` instead, so a silent command still shows as silent rather than repeating stale output. `heartbeat.json`'s own `recent_lines` always keeps the last five lines regardless of `PAN_RUN_TAIL_LINES`. A fresh `heartbeat.json` (younger than two cadences) is the liveness signal for a wrapped command; `recent_lines` is the tail an agent or supervisor reads before it interrupts anything, and `DELEGATE-001` states how that reading and that interruption are governed.

SIGINT or SIGTERM to the wrapper stops the command and its direct children, records the signal in `record.json`, and exits with 128 plus the signal number. The command receives SIGTERM in both cases, because a background job in a non-interactive shell ignores SIGINT.

### Compaction

`bin/pan-run` compacts `runtime/logs/shell` at exit. A finished record survives at least ten minutes past its end (the grace window); past that, `PAN_RUN_KEEP_HOURS` (default 24) and `PAN_RUN_KEEP_RECORDS` (default 1000) bound it by age and by count, and either set to `0` disables compaction. A record whose wrapper is still alive, or whose `record.json` is not yet written but whose `.pan-run.cjs` marker still sits in the directory, is never removed. This is a per-run best-effort bound, not a replacement for the 30-day `shell-logs` retention class `./bin/pan cleanup` applies; that class skips the `latest` symlink.

`bin/run-quiet` is a thin shim that delegates to `pan-run`. `PAN_VERBOSE=1` streams by exec-ing `pan-run` without `--quiet`; otherwise it execs `pan-run --quiet`, which prints nothing on success and, on failure, replays the captured stdout on stdout and then the captured stderr on stderr, each truncated to its last 16 MiB.

`bin/pan-hook-shell-monitor` enforces the wrapper through the `beforeShellExecution` Cursor hook. It allows both wrapped forms, including a `-c` string that holds quoted pipes or chains, and a short read-only allowlist; it denies everything else and names both wrapper forms in the agent message.

Deterministic coverage:

- `tests/integration/pan-run.test.ts`
- `tests/integration/quiet-command.test.ts`
- `tests/integration/shell-monitor-hook.test.ts`
- `tests/unit/shell-monitor-validator.test.ts`

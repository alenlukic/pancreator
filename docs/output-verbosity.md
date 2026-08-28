# Execution output and Cursor SDK logging

`OUTPUT-001` owns the operator-facing verbosity contract.

## npm scripts

Verification-oriented scripts run through `bin/run-quiet`. The wrapper
captures stdout and stderr, emits nothing when the command succeeds, and replays
the captured output when it fails. npm lifecycle banners are disabled by the
repository `.npmrc`. The aggregate `npm run check` command applies the same
contract across lint, build, validation, and tests.

When stderr is an interactive terminal, the wrapper prints one `.` to stderr
for each five-second interval in which the wrapped command produced new
output, then a closing newline. The dots track real progress, not wall
clock: a flowing stream means the command is still emitting output, and a
stopped stream means it has gone silent, which usually signals a hang.
Ticks never appear in captured or redirected output, which stays
byte-identical to the quiet contract. `PAN_PROGRESS=1` forces ticks on,
`PAN_PROGRESS=0` forces them off, and `PAN_PROGRESS_INTERVAL_SECONDS`
overrides the interval.

Set `PAN_VERBOSE=1` to stream command output while diagnosing a problem:

```sh
PAN_VERBOSE=1 npm test
```

Commands such as `npm run pan`, `npm run validate`, migrations, and Markdown
validation still emit their requested result payloads. Their prerequisite build
step remains quiet.

Deterministic coverage:

- `tests/unit/quiet-command.test.ts`
- `tests/unit/npm-verbosity.test.ts`
- `tests/unit/bin-layout.test.ts`

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
execution paths use this wrapper at their invocation boundary.

Deterministic coverage:

- `tests/unit/cursor-sdk-logging.test.ts`

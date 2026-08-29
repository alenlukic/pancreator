# Execution output and Cursor SDK logging

`OUTPUT-001` owns the operator-facing verbosity contract.

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

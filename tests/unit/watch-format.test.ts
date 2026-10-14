import assert from 'node:assert/strict'
import test from 'node:test'

import { WatchDisplay } from '../../src/lib/watch/display.js'
import type { TranscriptStep } from '../../src/lib/transcripts/records.js'
import type {
  AgentActivity,
  ShellHeartbeat,
} from '../../src/lib/agent-index.js'
import {
  formatOpenCallSuffix,
  formatProcessWakeLines,
  formatStallEvidenceLine,
  formatWakeLine,
  stallEvidenceFrom,
  type GenericWatchRecordEntry,
  type WatchObservation,
  type WatchRecordEntry,
  type WatchStallEvidence,
} from '../../src/lib/watch.js'

function baseEntry(
  overrides: Partial<GenericWatchRecordEntry> = {},
): GenericWatchRecordEntry {
  return {
    schema_version: 1,
    event: 'wake',
    subject: '4242',
    label: 'build',
    recorded_at: '2026-09-30T19:00:00.000Z',
    cadence_seconds: 60,
    wake: 3,
    watch_session_id: 'session-1',
    ...overrides,
  }
}

test('formatProcessWakeLines renders growth with an indented tail', () => {
  const line = formatProcessWakeLines(
    baseEntry({
      output: {
        path: 'runtime/logs/shell/x/output.log',
        exists: true,
        size: 13,
        mtime_ms: 0,
        growth_bytes: 7,
        silent_seconds: 0,
        tail: ['first', 'second'],
      },
    }),
  )

  assert.equal(
    line,
    '[pan watch:build] wake 3 at 2026-09-30T19:00:00.000Z +7B\n  first\n  second',
  )
})

test('formatProcessWakeLines reports silence once past two cadences', () => {
  const line = formatProcessWakeLines(
    baseEntry({
      cadence_seconds: 10,
      output: {
        path: 'runtime/logs/shell/x/output.log',
        exists: true,
        size: 13,
        mtime_ms: 0,
        growth_bytes: 0,
        silent_seconds: 25,
      },
    }),
  )

  assert.equal(
    line,
    '[pan watch:build] wake 3 at 2026-09-30T19:00:00.000Z no new output for 25s',
  )
})

test('formatProcessWakeLines stays quiet about silence under two cadences', () => {
  const line = formatProcessWakeLines(
    baseEntry({
      cadence_seconds: 60,
      output: {
        path: 'runtime/logs/shell/x/output.log',
        exists: true,
        size: 13,
        mtime_ms: 0,
        growth_bytes: 0,
        silent_seconds: 15,
      },
    }),
  )

  assert.equal(line, '[pan watch:build] wake 3 at 2026-09-30T19:00:00.000Z')
})

test('formatProcessWakeLines appends the terminal state and the linked pan-run heartbeat', () => {
  const line = formatProcessWakeLines(
    baseEntry({
      terminal_state: 'exited',
      output: {
        path: 'runtime/logs/shell/x/output.log',
        exists: true,
        size: 13,
        mtime_ms: 0,
        growth_bytes: null,
        silent_seconds: 2,
        tail: ['done'],
      },
      heartbeat: {
        elapsed_seconds: 42,
        log_bytes: 13,
        last_output_at: '2026-09-30T18:59:58.000Z',
        beat_age_seconds: 3.7,
      },
    }),
  )

  assert.equal(
    line,
    '[pan watch:build] wake 3 at 2026-09-30T19:00:00.000Z -> exited\n' +
      '  done\n' +
      '  (pan-run beat 3s ago, 42s elapsed)',
  )
})

test('formatProcessWakeLines with no output or heartbeat matches the original one-line shape', () => {
  const line = formatProcessWakeLines(baseEntry({ terminal_state: 'elapsed' }))

  assert.equal(
    line,
    '[pan watch:build] wake 3 at 2026-09-30T19:00:00.000Z -> elapsed',
  )
})

// ── formatWakeLine / formatOpenCallSuffix ───────────────────────────────────

function baseObservation(
  overrides: Partial<WatchObservation> = {},
): WatchObservation {
  return {
    observed_at: '2026-09-30T19:00:00.000Z',
    output_path: 'runtime/logs/workflows/r/agent/output.json',
    output_present: true,
    output_parses: true,
    output_matches_invocation: true,
    output_is_scaffold: false,
    output_missing_required_fields: [],
    watched_paths: [],
    fingerprint: 'abc123',
    ...overrides,
  }
}

function baseWakeEntry(
  overrides: Partial<WatchRecordEntry> = {},
): WatchRecordEntry {
  return {
    schema_version: 1,
    event: 'wake',
    run_id: 'run-1',
    invocation_id: '00_implement-1_aaaaaaaa',
    recorded_at: '2026-09-30T19:00:00.000Z',
    cadence_seconds: 60,
    wake: 3,
    changed: false,
    unchanged_wakes: 2,
    ...overrides,
  }
}

function shellOpenCallActivity(
  shellHeartbeat: ShellHeartbeat | null,
): AgentActivity {
  return {
    agent_id: 'agent-1',
    aliases: [],
    event_file: 'runtime/logs/agents/agent-1.jsonl',
    event_count: 4,
    last_event_kind: 'call_started',
    last_event_tool: 'Shell',
    last_event_at: '2026-09-30T18:59:50.000Z',
    last_event_age_seconds: 10,
    open_call: {
      tool: 'Shell',
      started_at: '2026-09-30T18:58:50.000Z',
      shell_heartbeat: shellHeartbeat,
    },
    stall_suppressed: shellHeartbeat !== null,
    stop: null,
    transcript: null,
    signature: 'sig-1',
  }
}

test('formatWakeLine is unchanged when the observation carries no agent_activity', () => {
  const line = formatWakeLine(baseWakeEntry({ observation: baseObservation() }))

  assert.equal(
    line,
    '[pan watch:00_implement-1_aaaaaaaa] wake 3 at 2026-09-30T19:00:00.000Z: ' +
      'output present, unchanged x2',
  )
})

test('formatWakeLine appends the open-call suffix when agent_activity carries a linked shell heartbeat', () => {
  const activity = shellOpenCallActivity({
    record_path: 'runtime/logs/shell/x/record.json',
    heartbeat_at: '2026-09-30T18:59:55.000Z',
    age_seconds: 5,
    label: 'npm',
    pid: 4242,
    elapsed_seconds: 65,
    log_bytes: 128,
    last_output_at: '2026-09-30T18:59:55.000Z',
    recent_lines: ['compiling', 'done'],
  })
  const line = formatWakeLine(
    baseWakeEntry({
      observation: baseObservation({ agent_activity: activity }),
    }),
  )

  assert.match(
    line,
    /open:Shell \d+s \[pan-run npm pid=4242 beat 5s ago: done\]$/u,
  )
})

test('formatOpenCallSuffix names a shell open call with no linked record', () => {
  const activity = shellOpenCallActivity(null)

  assert.match(
    formatOpenCallSuffix(activity),
    /^ open:Shell \d+s \[no pan-run heartbeat\]$/u,
  )
})

test('formatOpenCallSuffix omits the heartbeat bracket for a non-shell open call', () => {
  const activity: AgentActivity = {
    agent_id: 'agent-1',
    aliases: [],
    event_file: 'runtime/logs/agents/agent-1.jsonl',
    event_count: 2,
    last_event_kind: 'call_started',
    last_event_tool: 'Read',
    last_event_at: '2026-09-30T18:59:50.000Z',
    last_event_age_seconds: 10,
    open_call: {
      tool: 'Read',
      started_at: '2026-09-30T18:59:40.000Z',
      shell_heartbeat: null,
    },
    stall_suppressed: true,
    stop: null,
    transcript: null,
    signature: 'sig-2',
  }

  assert.match(formatOpenCallSuffix(activity), /^ open:Read \d+s$/u)
})

test('formatOpenCallSuffix is empty with no open call', () => {
  assert.equal(formatOpenCallSuffix(null), '')
  assert.equal(formatOpenCallSuffix(undefined), '')
})

// ── formatStallEvidenceLine / stallEvidenceFrom ─────────────────────────────

function shellHeartbeatFixture(
  overrides: Partial<ShellHeartbeat> = {},
): ShellHeartbeat {
  return {
    record_path: 'runtime/logs/shell/x/record.json',
    heartbeat_at: '2026-09-30T18:59:55.000Z',
    age_seconds: 5,
    label: 'npm',
    pid: 4242,
    elapsed_seconds: 65,
    log_bytes: 128,
    last_output_at: '2026-09-30T18:59:55.000Z',
    recent_lines: ['compiling', 'done'],
    ...overrides,
  }
}

function displayFixture() {
  let steps: TranscriptStep[] = []
  const display = new WatchDisplay('', {
    context: () => ({ persona: 'coder', model: 'test-model' }),
    transcript: () => {
      const delta = steps
      steps = []
      return { steps: delta, notice: '' }
    },
    secrets: ['fixture-secret-value'],
  })
  return {
    display,
    append: (delta: TranscriptStep[]) => {
      steps.push(...delta)
    },
  }
}

test('watch display prints invariant context once and advances one idle counter', () => {
  const { display } = displayFixture()
  const header = display.start(
    baseWakeEntry({ event: 'session_started', timeout_seconds: 3600 }),
  )
  for (const field of [
    'run-1',
    '00_implement-1_aaaaaaaa',
    'coder',
    'test-model',
    '60s',
    '3600s',
  ]) {
    assert.ok(header.includes(field), field)
  }
  const first = display.wake(baseWakeEntry())
  const second = display.wake(baseWakeEntry({ wake: 4 }))
  assert.equal(first, '\r[pan watch] unchanged x1')
  assert.equal(second, '\r[pan watch] unchanged x2')
  for (const field of [
    'run-1',
    '00_implement-1_aaaaaaaa',
    'coder',
    'test-model',
    '60s',
    '3600s',
  ]) {
    assert.ok(!`${first}${second}`.includes(field), field)
  }
  const terminal = display.wake(
    baseWakeEntry({ wake: 5, terminal_state: 'stalled' }),
  )
  assert.match(terminal, /^\n\[pan watch\] wake 5/u)
  assert.match(terminal, /unchanged x2 -> stalled\n$/u)
})

test('watch display redacts, bounds and emits only new assistant text and ordered tool names', () => {
  const { display, append } = displayFixture()
  append([
    { role: 'user', text: 'private user prompt', tools: [] },
    {
      role: 'assistant',
      text: 'first fixture-secret-value\nAPI_KEY=inline-secret',
      tools: [
        { name: 'Read', input: { path: 'private tool arguments' } },
        { name: 'Read', input: {} },
        { name: 'Shell', input: {} },
        { name: 'Read', input: {} },
      ],
    },
  ])
  const first = display.wake(baseWakeEntry())
  assert.match(first, /chat: first \[REDACTED\]\n  API_KEY=\[REDACTED\]/u)
  assert.match(first, /tools: Read x2, Shell, Read/u)
  assert.doesNotMatch(first, /private|fixture-secret-value|inline-secret/u)
  append([
    {
      role: 'assistant',
      text: 'second',
      tools: [{ name: 'Grep', input: {} }],
    },
  ])
  const second = display.wake(baseWakeEntry())
  assert.match(second, /chat: second\n  tools: Grep/u)
  assert.doesNotMatch(second, /first|Read|Shell/u)
  const empty = display.wake(baseWakeEntry())
  assert.doesNotMatch(empty, /chat:|tools:/u)
  append([{ role: 'assistant', text: 'x'.repeat(2000), tools: [] }])
  const bounded = display.wake(baseWakeEntry())
  const chat = bounded.split('chat: ')[1]?.trimEnd().split('\n  ')
  assert.ok(chat?.every((line) => line.length <= 600))
  assert.equal(chat?.join(''), 'x'.repeat(2000))
})

test('watch display preserves full ordered messages and tools across bounded continuation lines', () => {
  const { display, append } = displayFixture()
  display.start(baseWakeEntry({ event: 'session_started' }))
  append(
    ['first', 'second'].map((name) => ({
      role: 'assistant' as const,
      text: `${name} ${'x'.repeat(1400)} fixture-secret-value\n\n${name}-END`,
      tools: Array.from({ length: 50 }, (_, index) => ({
        name: `${name}-tool-${index}`,
        input: { secret: 'private arguments' },
      })),
    })),
  )
  const rendered = display.wake(baseWakeEntry())
  const unwrapped = rendered.replace(/\n  /gu, '')
  for (const name of ['first', 'second']) {
    assert.equal(rendered.split(`${name}-END`).length - 1, 1)
    assert.ok(
      unwrapped.includes(`${name} ${'x'.repeat(1400)} [REDACTED]${name}-END`),
    )
    assert.deepEqual(
      unwrapped.match(new RegExp(`${name}-tool-\\d+`, 'gu')),
      Array.from({ length: 50 }, (_, index) => `${name}-tool-${index}`),
    )
  }
  assert.ok(rendered.indexOf('first-END') < rendered.indexOf('second-END'))
  assert.ok(rendered.indexOf('first-tool-0') < rendered.indexOf('chat: second'))
  assert.match(rendered, /\[REDACTED\]\n  \n  first-END/u)
  assert.doesNotMatch(
    rendered,
    /fixture-secret-value|private arguments|\.\.\./u,
  )
  assert.doesNotMatch(
    display.wake(baseWakeEntry({ wake: 4 })),
    /END|tool-|chat:/u,
  )
})

test('watch display wraps Unicode safely and removes terminal controls before a terminal wake', () => {
  const { display, append } = displayFixture()
  const text = `${'\u{1f642}'.repeat(601)} fixture-secret-\x07value\x1b]0;private title\x07\nEND`
  append([{ role: 'assistant', text, tools: [{ name: 'Shell', input: {} }] }])
  const rendered = display.wake(baseWakeEntry({ terminal_state: 'completed' }))
  assert.match(rendered, / -> completed\n/u)
  assert.match(rendered, /END\n  tools: Shell\n$/u)
  assert.doesNotMatch(
    rendered,
    /fixture-secret|private title|[\x00-\x09\x0b-\x1f]/u,
  )
  const chat = rendered.split('chat: ')[1]?.split('\n  tools:')[0]
  assert.equal(
    chat?.split('\n  ').join(''),
    `${'\u{1f642}'.repeat(601)} [REDACTED]END`,
  )
  assert.ok(chat?.split('\n  ').every((line) => Array.from(line).length <= 600))
})

test('watch display prints wrapper growth and newest line once, resetting for a new record', () => {
  const { display } = displayFixture()
  const heartbeat = shellHeartbeatFixture({
    log_bytes: 128,
    recent_lines: ['old', 'newest'],
  })
  const entry = () =>
    baseWakeEntry({
      observation: baseObservation({
        agent_activity: shellOpenCallActivity(heartbeat),
      }),
    })
  const first = display.wake(entry())
  assert.match(first, /wrapper \+128B: newest/u)
  assert.doesNotMatch(first, /old/u)
  assert.doesNotMatch(display.wake(entry()), /wrapper|newest/u)
  heartbeat.log_bytes = 150
  heartbeat.recent_lines.push('next')
  assert.match(display.wake(entry()), /wrapper \+22B: next/u)
  heartbeat.record_path = 'runtime/logs/shell/y/record.json'
  heartbeat.log_bytes = 5
  assert.match(display.wake(entry()), /wrapper \+5B: next/u)
})

test('watch display preserves terminal labels and never mutates observations', () => {
  const { display } = displayFixture()
  for (const terminal_state of [
    'completed',
    'stalled',
    'timed_out',
    'unverified',
    'interrupted',
  ] as const) {
    const entry = baseWakeEntry({
      terminal_state,
      observation: baseObservation(),
    })
    const before = JSON.stringify(entry)
    assert.ok(display.wake(entry).endsWith(` -> ${terminal_state}\n`))
    assert.equal(JSON.stringify(entry), before)
  }
})

test('watch display isolates multiplexed invocation idle counters', () => {
  const { display } = displayFixture()
  display.start(
    baseWakeEntry({ event: 'session_started', timeout_seconds: 60 }),
  )
  display.start(
    baseWakeEntry({
      invocation_id: 'second',
      event: 'session_started',
      timeout_seconds: 60,
    }),
  )
  assert.equal(display.wake(baseWakeEntry()), '\r[pan watch:1] unchanged x1')
  assert.equal(
    display.wake(baseWakeEntry({ invocation_id: 'second' })),
    '\r[pan watch:2] unchanged x1',
  )
  assert.equal(display.wake(baseWakeEntry()), '\r[pan watch:1] unchanged x2')
})

test('watch display replaces shorter multiplexed idle lines without stale suffixes', () => {
  const { display } = displayFixture()
  const first = baseWakeEntry()
  const second = baseWakeEntry({ invocation_id: 'second' })
  display.start(first)
  display.start(second)

  let output = ''
  const write = (text: string): string[] => {
    output += text
    const lines = ['']
    let column = 0

    for (const character of output) {
      if (character === '\r') {
        column = 0
      } else if (character === '\n') {
        lines.push('')
        column = 0
      } else {
        const index = lines.length - 1
        const line = lines[index] ?? ''
        lines[index] =
          line.slice(0, column) + character + line.slice(column + 1)
        column += 1
      }
    }

    return lines.map((line) => line.trimEnd())
  }

  for (let wake = 1; wake <= 10; wake += 1) {
    assert.deepEqual(write(display.wake({ ...first, wake })), [
      `[pan watch:1] unchanged x${wake}`,
    ])
  }

  assert.deepEqual(write(display.wake(second)), ['[pan watch:2] unchanged x1'])
  assert.deepEqual(write(display.wake(first)), ['[pan watch:1] unchanged x11'])
  assert.deepEqual(write(display.wake(second)), ['[pan watch:2] unchanged x2'])

  const progress = display.wake({ ...second, changed: true })
  const progressed = write(progress)
  assert.equal(progressed[0], '[pan watch:2] unchanged x2')
  assert.match(progressed[1] ?? '', /unchanged x2$/u)
  assert.equal(progressed[2], '')
  assert.deepEqual(write(display.wake(first)).slice(2), [
    '[pan watch:1] unchanged x12',
  ])
  assert.deepEqual(write(display.wake(second)).slice(2), [
    '[pan watch:2] unchanged x1',
  ])

  assert.equal(display.finish(), '\n')
  write('\n')
  assert.equal(display.finish(), '')
  const resumed = display.wake(second)
  assert.equal(resumed, '\r[pan watch:2] unchanged x2')
  assert.deepEqual(write(resumed).slice(2), [
    '[pan watch:2] unchanged x1',
    '[pan watch:2] unchanged x2',
  ])

  for (let index = 3; index <= 10; index += 1) {
    const header = display.start(
      baseWakeEntry({ invocation_id: `target-${index}` }),
    )
    assert.equal(header.startsWith('\n'), index === 3)
    write(header)
  }

  assert.equal(
    write(display.wake(baseWakeEntry({ invocation_id: 'target-10' }))).at(-1),
    '[pan watch:10] unchanged x1',
  )
  assert.equal(write(display.wake(second)).at(-1), '[pan watch:2] unchanged x3')
  assert.equal(display.finish(), '\n')
  assert.equal(display.finish(), '')
})

test('watch display applies configured bounds after redaction and rejects invalid widths', (t) => {
  const name = 'PANCREATOR_WATCH_TEXT_CHARS'
  const previous = process.env[name]
  t.after(() => {
    if (previous === undefined) delete process.env[name]
    else process.env[name] = previous
  })
  process.env[name] = '80'
  const { display, append } = displayFixture()
  append([
    {
      role: 'assistant',
      text: `\x1b[31mfixture-secret-value\x1b[0m fixture-secret-\x1b[31mvalue ${'x'.repeat(200)}`,
      tools: [],
    },
  ])
  const line = display.wake(baseWakeEntry())
  assert.doesNotMatch(line, /fixture-secret-value|\x1b/u)
  const chat = line.split('chat: ')[1]?.trimEnd().split('\n  ')
  assert.ok(chat?.every((part) => part.length <= 80))
  assert.equal(chat?.join(''), `[REDACTED] [REDACTED] ${'x'.repeat(200)}`)
  for (const invalid of ['', '79', '4097', '100.5', 'no']) {
    process.env[name] = invalid
    assert.throws(() => displayFixture(), /must be an integer from 80 to 4096/u)
  }
})

test('watch display bounds tools and wrapper lines and retains completion diagnostics', () => {
  const { display, append } = displayFixture()
  append([
    {
      role: 'assistant',
      text: '',
      tools: Array.from({ length: 100 }, (_, index) => ({
        name: `tool-${index}`,
        input: {},
      })),
    },
  ])
  const heartbeat = shellHeartbeatFixture({
    recent_lines: [`fixture-secret-value ${'x'.repeat(300)}`],
  })
  const line = display.wake(
    baseWakeEntry({
      observation: baseObservation({
        agent_activity: shellOpenCallActivity(heartbeat),
        output_matches_invocation: false,
      }),
      completion_hold: 'output_younger_than_cadence',
    }),
  )
  const tools = line.split('tools: ')[1]?.split('\n  wrapper')[0]?.split('\n  ')
  assert.ok(tools?.every((part) => part.length <= 240))
  assert.equal(
    tools?.join(''),
    Array.from({ length: 100 }, (_, index) => `tool-${index}`).join(', '),
  )
  assert.equal(line.match(/wrapper \+\d+B: (.*)\n/u)?.[1]?.length, 160)
  assert.doesNotMatch(line, /fixture-secret-value/u)
  assert.match(line, /output present \(other invocation\)/u)
  assert.match(
    line,
    /holding for one confirming wake \(output_younger_than_cadence\)/u,
  )
})

test('watch display reports transcript I/O failures once without changing observations', () => {
  let failure = Object.assign(new Error('private transcript path'), {
    code: 'EACCES',
  })
  const display = new WatchDisplay('', {
    context: () => ({ persona: 'coder', model: 'test-model' }),
    transcript: () => {
      throw failure
    },
    secrets: [],
  })
  const entry = baseWakeEntry()
  const before = JSON.stringify(entry)
  assert.match(display.wake(entry), /transcript unreadable \(EACCES\)/u)
  assert.equal(display.wake(entry), '\r[pan watch] unchanged x1')
  assert.equal(JSON.stringify(entry), before)
  failure = Object.assign(new Error('unexpected parser failure'), {
    code: 'UNEXPECTED',
  })
  assert.throws(() => display.wake(entry), /unexpected parser failure/u)
})

test('formatStallEvidenceLine names the open shell call and its linked heartbeat', () => {
  const evidence: WatchStallEvidence = {
    agent_id: 'agent-1',
    last_event_kind: 'call_started',
    last_event_at: '2026-09-30T18:59:50.000Z',
    last_event_age_seconds: 10,
    open_call: {
      tool: 'Shell',
      started_at: '2026-09-30T18:58:00.000Z',
      age_seconds: 120,
      shell_heartbeat: shellHeartbeatFixture(),
    },
    stall_suppressed: true,
  }

  assert.equal(
    formatStallEvidenceLine(evidence),
    'worker: open Shell since 2026-09-30T18:58:00.000Z (120s); pan-run npm ' +
      'pid=4242 record runtime/logs/shell/x/record.json, heartbeat 5s ago, ' +
      '65s elapsed; last: done',
  )
})

test('formatStallEvidenceLine names an open shell call with no linked record', () => {
  const evidence: WatchStallEvidence = {
    agent_id: 'agent-1',
    last_event_kind: 'call_started',
    last_event_at: '2026-09-30T18:59:50.000Z',
    last_event_age_seconds: 10,
    open_call: {
      tool: 'Shell',
      started_at: '2026-09-30T18:58:00.000Z',
      age_seconds: 120,
      shell_heartbeat: null,
    },
    stall_suppressed: false,
  }

  assert.equal(
    formatStallEvidenceLine(evidence),
    'worker: open Shell since 2026-09-30T18:58:00.000Z (120s); no pan-run heartbeat linked',
  )
})

test('formatStallEvidenceLine names the last event when there is no open call', () => {
  const evidence: WatchStallEvidence = {
    agent_id: 'agent-1',
    last_event_kind: 'call_finished',
    last_event_at: '2026-09-30T18:59:00.000Z',
    last_event_age_seconds: 60,
    open_call: null,
    stall_suppressed: false,
  }

  assert.equal(
    formatStallEvidenceLine(evidence),
    'worker: no open call; last event call_finished 60s ago',
  )
})

test('formatStallEvidenceLine reports an agent absent from the index', () => {
  assert.equal(
    formatStallEvidenceLine(undefined),
    'worker: not in the agent index',
  )
  assert.equal(
    formatStallEvidenceLine(stallEvidenceFrom(null, Date.now())),
    'worker: not in the agent index',
  )
})

test('stallEvidenceFrom carries the activity fields through, including the linked heartbeat', () => {
  const activity = shellOpenCallActivity(shellHeartbeatFixture({ pid: 9 }))
  const nowMs = Date.parse('2026-09-30T19:00:00.000Z')
  const evidence = stallEvidenceFrom(activity, nowMs)

  assert.equal(evidence.agent_id, 'agent-1')
  assert.equal(evidence.open_call?.tool, 'Shell')
  assert.equal(evidence.open_call?.shell_heartbeat?.pid, 9)
  assert.ok(evidence.open_call && evidence.open_call.age_seconds > 0)
})

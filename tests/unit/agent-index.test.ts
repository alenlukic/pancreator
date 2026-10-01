/**
 * Tests for the hook-fed agent activity index (AC-004, AC-009, AC-011).
 *
 * The hook payloads are synthetic. They follow the field names the Cursor
 * hook documentation gives, because no live payload has been recorded yet
 * (docs/cursor-hook-context-probe.md, pending with the operator).
 */
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  AGENTS_DIR,
  agentActivitySignature,
  agentEventFile,
  agentIndexHooksStatus,
  collectSecrets,
  extractTaskHandle,
  getAgentEntry,
  getLatestEvent,
  getOpenCall,
  getStopRecord,
  handlePostToolUse,
  handlePreToolUse,
  handleSubagentStart,
  handleSubagentStop,
  linkedShellHeartbeat,
  loadAgentEvents,
  parseRunInvocation,
  promptDigest,
  readAgentActivity,
  readAgentIndex,
  readAgentStop,
  resolveCanonicalId,
  summarizeToolInput,
} from '../../src/lib/agent-index.js'
import { CLEANUP_ARTIFACT_CLASSES } from '../../src/lib/cleanup.js'
import { createTestTempDirectory } from '../temp.js'

// ── helpers ──────────────────────────────────────────────────────────────────

function makeRoot(): string {
  const root = createTestTempDirectory('agent-index-')
  mkdirSync(path.join(root, AGENTS_DIR), { recursive: true })
  return root
}

/** A pid no process holds, found by the same probe the lock check uses. */
function deadPid(): number {
  for (let pid = 4_000_000; pid > 3_000_000; pid -= 7919) {
    try {
      process.kill(pid, 0)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        return pid
      }
    }
  }

  throw new Error('no free pid found')
}

function rawEvents(root: string, id: string): string {
  const file = agentEventFile(root, id)

  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

const PARENT = 'parent-conv-001'
const CHILD = 'child-sub-001'
const TASK_PROMPT =
  'Read runtime/logs/workflows/run-1/agent/invocations/07_implement-1_abc.md and do the work.'

/** Parent issues a Task call, as preToolUse reports it. */
function parentLaunches(root: string, toolUseId = 'tu-launch-001'): void {
  handlePreToolUse(root, {
    event: 'preToolUse',
    conversation_id: PARENT,
    tool_name: 'Task',
    tool_use_id: toolUseId,
    tool_input: {
      subagent_type: 'pan-coder',
      description: 'Implement stage',
      prompt: TASK_PROMPT,
      run_in_background: true,
    },
  })
}

/** Child registers, carrying the launch prompt as task text. */
function childStarts(root: string, extra: Record<string, string> = {}): void {
  handleSubagentStart(root, {
    event: 'subagentStart',
    subagent_id: CHILD,
    parent_conversation_id: PARENT,
    task_text: TASK_PROMPT,
    subagent_type: 'pan-coder',
    ...extra,
  })
}

// ── AC-004: index correctness ─────────────────────────────────────────────

test('AC-004: handleSubagentStart registers agent and writes index entry', () => {
  const root = makeRoot()
  handleSubagentStart(root, {
    event: 'subagentStart' as const,
    subagent_id: 'agent-test-001',
    parent_conversation_id: 'parent-001',
    tool_call_id: 'tc-001',
    task_text: 'A short task',
    subagent_type: 'generalPurpose',
    model: 'platform-default-model',
  })

  const index = readAgentIndex(root)
  assert.equal(index.agents.length, 1)
  const entry = index.agents[0]
  assert.ok(entry, 'entry present')
  assert.equal(entry.agent_id, 'agent-test-001')
  assert.equal(entry.status, 'running')
  assert.equal(entry.parent_agent_id, 'parent-001')
  assert.equal(entry.model, 'platform-default-model')
  assert.ok(entry.registered_at)
})

test('AC-004: handleSubagentStop marks agent completed and sets stop record', () => {
  const root = makeRoot()
  handleSubagentStart(root, {
    event: 'subagentStart' as const,
    subagent_id: 'agent-stop-001',
  })

  handleSubagentStop(root, {
    event: 'subagentStop' as const,
    subagent_id: 'agent-stop-001',
    status: 'completed' as const,
    tool_call_count: 5,
    modified_file_count: 2,
    duration_seconds: 30,
  })

  const stop = getStopRecord(root, 'agent-stop-001')
  assert.ok(stop, 'stop record present')
  assert.equal(stop.status, 'completed')
  assert.equal(stop.tool_call_count, 5)
  assert.equal(stop.modified_file_count, 2)
})

test('AC-004: handlePreToolUse appends call_started event', () => {
  const root = makeRoot()
  handleSubagentStart(root, {
    event: 'subagentStart' as const,
    subagent_id: 'agent-call-001',
  })

  handlePreToolUse(root, {
    event: 'preToolUse',
    conversation_id: 'agent-call-001',
    tool_name: 'Bash',
    tool_use_id: 'tu-001',
  })

  const latest = getLatestEvent(root, 'agent-call-001')
  assert.ok(latest, 'event present')
  assert.equal(latest.kind, 'call_started')
  assert.equal(latest.tool_name, 'Bash')
})

test('AC-004: handlePostToolUse closes open call and appends call_finished', () => {
  const root = makeRoot()
  handleSubagentStart(root, {
    event: 'subagentStart' as const,
    subagent_id: 'agent-finish-001',
  })
  handlePreToolUse(root, {
    event: 'preToolUse',
    conversation_id: 'agent-finish-001',
    tool_name: 'Bash',
    tool_use_id: 'tu-finish-001',
  })
  handlePostToolUse(root, {
    event: 'postToolUse',
    conversation_id: 'agent-finish-001',
    tool_name: 'Bash',
    tool_use_id: 'tu-finish-001',
  })

  const openCall = getOpenCall(root, 'agent-finish-001')
  assert.equal(openCall, null, 'no open call after postToolUse')
})

test('AC-004: resolveCanonicalId resolves agent id to itself', () => {
  const root = makeRoot()
  handleSubagentStart(root, {
    event: 'subagentStart' as const,
    subagent_id: 'canonical-001',
    tool_call_id: 'tc-alias-001',
  })

  const index = readAgentIndex(root)
  const canonical = resolveCanonicalId(index, 'canonical-001')
  assert.equal(canonical, 'canonical-001')
})

test('AC-004: agentActivitySignature changes when events are appended', () => {
  const root = makeRoot()
  handleSubagentStart(root, {
    event: 'subagentStart' as const,
    subagent_id: 'agent-sig-001',
  })

  const sig1 = agentActivitySignature(root, 'agent-sig-001')

  handlePreToolUse(root, {
    event: 'preToolUse',
    conversation_id: 'agent-sig-001',
    tool_name: 'Read',
    tool_use_id: 'tu-sig-001',
  })

  const sig2 = agentActivitySignature(root, 'agent-sig-001')
  assert.notEqual(sig1, sig2, 'signature changed after new event')
})

test('AC-004: a launch links to its child by the digest of the same prompt text', () => {
  const root = makeRoot()
  parentLaunches(root)
  childStarts(root)

  const index = readAgentIndex(root)
  const launch = index.pending_launches.find(
    (pl) => pl.tool_use_id === 'tu-launch-001',
  )

  assert.ok(launch, 'pending launch recorded')
  assert.equal(launch.prompt_digest, promptDigest(TASK_PROMPT))
  assert.equal(launch.resolved_agent_id, CHILD)
  assert.equal(resolveCanonicalId(index, 'tu-launch-001'), CHILD)

  const child = getAgentEntry(root, CHILD)
  assert.equal(child?.run_id, 'run-1')
  assert.equal(child?.invocation_id, '07_implement-1_abc')
})

test('AC-004: a child tool call with parent_tool_call_id lands on the registered child', () => {
  const root = makeRoot()
  parentLaunches(root)
  childStarts(root)

  handlePreToolUse(root, {
    event: 'preToolUse',
    conversation_id: 'child-conv-xyz',
    parent_tool_call_id: 'tu-launch-001',
    tool_name: 'Read',
    tool_use_id: 'tu-child-read',
    tool_input: { path: 'src/cli.ts' },
  })

  const index = readAgentIndex(root)
  assert.equal(resolveCanonicalId(index, 'child-conv-xyz'), CHILD)
  assert.equal(
    index.agents.some((a) => a.agent_id === 'child-conv-xyz'),
    false,
    'no orphan entry for the child conversation id',
  )
  assert.equal(getOpenCall(root, CHILD)?.tool_use_id, 'tu-child-read')
})

test('AC-004: a plain-string Task handle becomes an alias of the child', () => {
  const root = makeRoot()
  parentLaunches(root)
  childStarts(root)
  handlePostToolUse(root, {
    event: 'postToolUse',
    conversation_id: PARENT,
    tool_name: 'Task',
    tool_use_id: 'tu-launch-001',
    tool_output: 'bg-agent-handle-9',
  })

  assert.equal(getAgentEntry(root, 'bg-agent-handle-9')?.agent_id, CHILD)
  assert.equal(
    loadAgentEvents(root, PARENT).some((e) => e.kind === 'launch_returned'),
    true,
  )
})

test('AC-004: a handle returned before subagentStart links when the child registers', () => {
  const root = makeRoot()
  parentLaunches(root)
  handlePostToolUse(root, {
    event: 'postToolUse',
    conversation_id: PARENT,
    tool_name: 'Task',
    tool_use_id: 'tu-launch-001',
    tool_output: JSON.stringify({ agent_id: 'bg-early-7' }),
  })
  childStarts(root)

  assert.equal(getAgentEntry(root, 'bg-early-7')?.agent_id, CHILD)
})

test('AC-004: a Task output without a handle records no launch_returned event', () => {
  const root = makeRoot()
  parentLaunches(root)
  handlePostToolUse(root, {
    event: 'postToolUse',
    conversation_id: PARENT,
    tool_name: 'Task',
    tool_use_id: 'tu-launch-001',
    tool_output: 'The subagent finished and reported three findings.',
  })

  assert.equal(
    loadAgentEvents(root, PARENT).some((e) => e.kind === 'launch_returned'),
    false,
  )
  assert.equal(readAgentIndex(root).pending_launches[0]?.handle, null)
})

test('AC-004: extractTaskHandle reads JSON, object, plain, and mention forms', () => {
  assert.equal(extractTaskHandle('{"agentId":"a-1"}'), 'a-1')
  assert.equal(extractTaskHandle({ id: 'a-2' }), 'a-2')
  assert.equal(extractTaskHandle('  a-3  '), 'a-3')
  assert.equal(extractTaskHandle('Launched. Agent ID: a-4.'), 'a-4')
  assert.equal(extractTaskHandle('no handle in this text'), null)
  assert.equal(extractTaskHandle(42), null)
})

test('AC-004: a stop with only the transcript path stops the child, never the parent', () => {
  const root = makeRoot()
  handleSubagentStart(root, {
    event: 'subagentStart',
    subagent_id: PARENT,
  })
  parentLaunches(root)
  childStarts(root)
  const transcript = path.join(root, `${CHILD}.jsonl`)
  writeFileSync(transcript, '{"role":"assistant"}\n')

  handleSubagentStop(root, {
    event: 'subagentStop',
    conversation_id: PARENT,
    parent_conversation_id: PARENT,
    status: 'completed',
    agent_transcript_path: transcript,
  })

  assert.equal(getAgentEntry(root, CHILD)?.status, 'completed')
  assert.equal(getAgentEntry(root, PARENT)?.status, 'running')
  assert.equal(getAgentEntry(root, CHILD)?.transcript_path, transcript)
})

test('AC-004: a stop with only parent and task text stops the newest matching child', () => {
  const root = makeRoot()
  handleSubagentStart(root, { event: 'subagentStart', subagent_id: PARENT })
  childStarts(root)

  handleSubagentStop(root, {
    event: 'subagentStop',
    conversation_id: PARENT,
    parent_conversation_id: PARENT,
    status: 'error',
    task_text: TASK_PROMPT,
  })

  assert.equal(getStopRecord(root, CHILD)?.status, 'error')
  assert.equal(getAgentEntry(root, PARENT)?.status, 'running')
  assert.equal(getLatestEvent(root, CHILD)?.status, 'error')
})

test('AC-004: parseRunInvocation accepts invocation, output, and delegation paths only', () => {
  const base = 'runtime/logs/workflows/run-9/agent/invocations/'

  for (const suffix of ['.md', '.json', '.delegation.md']) {
    assert.deepEqual(
      parseRunInvocation(`Read ${base}12_verify-1_ff${suffix}`),
      {
        run_id: 'run-9',
        invocation_id: '12_verify-1_ff',
      },
    )
  }

  assert.equal(parseRunInvocation(`${base}12_verify-1_ff.txt`), null)
  assert.equal(parseRunInvocation(`${base}12_verify-1_ff.mdx`), null)
  assert.equal(parseRunInvocation('no path here'), null)
})

test('AC-004: readAgentActivity reports stop output from the transcript on disk', () => {
  const root = makeRoot()
  childStarts(root)
  handleSubagentStop(root, {
    event: 'subagentStop',
    subagent_id: CHILD,
    status: 'completed',
    agent_transcript_path: path.join(root, 'missing.jsonl'),
  })

  const withoutOutput = readAgentActivity(root, CHILD, Date.now(), 60)
  assert.equal(withoutOutput?.stop?.terminal_output_present, false)

  writeFileSync(path.join(root, 'missing.jsonl'), '{"role":"assistant"}\n')
  const withOutput = readAgentActivity(root, CHILD, Date.now(), 60)
  assert.equal(withOutput?.stop?.terminal_output_present, true)
})

test('a resumed agent that starts a call after its stop is running again', () => {
  const root = makeRoot()
  childStarts(root)
  handleSubagentStop(root, {
    event: 'subagentStop',
    subagent_id: CHILD,
    status: 'completed',
  })
  const stoppedMs = Date.parse(getStopRecord(root, CHILD)?.recorded_at ?? '')

  assert.ok(readAgentStop(root, CHILD, Date.now()), 'the stop is current')

  // Hook timestamps have millisecond resolution; the resumed call must land
  // strictly after the stop for the order to mean anything.
  while (Date.now() <= stoppedMs) {
    // spin
  }

  handlePreToolUse(root, {
    event: 'preToolUse',
    conversation_id: CHILD,
    tool_name: 'Read',
    tool_use_id: 'tu-resumed',
  })

  const activity = readAgentActivity(root, CHILD, Date.now(), 60)

  assert.equal(readAgentStop(root, CHILD, Date.now()), null)
  assert.equal(activity?.stop, null)
  assert.equal(activity?.open_call?.tool, 'Read')
})

test('a stop older than the not-before bound is not current', () => {
  const root = makeRoot()
  childStarts(root)
  handleSubagentStop(root, {
    event: 'subagentStop',
    subagent_id: CHILD,
    status: 'completed',
  })
  const stoppedMs = Date.parse(getStopRecord(root, CHILD)?.recorded_at ?? '')

  assert.equal(readAgentStop(root, CHILD, Date.now(), stoppedMs + 1), null)
  assert.equal(
    readAgentActivity(root, CHILD, Date.now(), 60, stoppedMs + 1)?.stop,
    null,
  )
  assert.equal(
    readAgentStop(root, CHILD, Date.now(), stoppedMs)?.status,
    'completed',
    'a stop at the bound itself is current',
  )
})

test('AC-004: an open shell call suppresses a stall only while its pan-run heartbeat is fresh', () => {
  const root = makeRoot()
  childStarts(root)
  handlePreToolUse(root, {
    event: 'preToolUse',
    conversation_id: CHILD,
    tool_name: 'Shell',
    tool_use_id: 'tu-shell',
    tool_input: { command: 'npm test' },
  })

  const noRecord = readAgentActivity(root, CHILD, Date.now(), 60)
  assert.equal(noRecord?.open_call?.tool, 'Shell')
  assert.equal(
    noRecord?.stall_suppressed,
    false,
    'no heartbeat, no suppression',
  )

  const startedAt = getOpenCall(root, CHILD)?.timestamp as string
  const stamp = new Date(startedAt)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
  const recordDir = path.join(
    root,
    'runtime/logs/shell',
    `${stamp}-npm-abc12345`,
  )
  mkdirSync(recordDir, { recursive: true })
  writeFileSync(
    path.join(recordDir, 'record.json'),
    JSON.stringify({ started_at: startedAt, ended_at: null }),
  )
  const heartbeat = path.join(recordDir, 'heartbeat.json')
  writeFileSync(heartbeat, '{}')

  const fresh = readAgentActivity(root, CHILD, Date.now(), 60)
  assert.equal(fresh?.stall_suppressed, true)
  assert.ok(fresh?.open_call?.shell_heartbeat)

  const old = (Date.now() - 10 * 60_000) / 1000
  utimesSync(heartbeat, old, old)
  const stale = readAgentActivity(root, CHILD, Date.now(), 60)
  assert.equal(stale?.stall_suppressed, false)
})

test('the linked shell heartbeat carries the record label, pid, and heartbeat content', () => {
  const root = makeRoot()
  childStarts(root)
  handlePreToolUse(root, {
    event: 'preToolUse',
    conversation_id: CHILD,
    tool_name: 'Shell',
    tool_use_id: 'tu-shell',
    tool_input: { command: 'npm test' },
  })

  const startedAt = getOpenCall(root, CHILD)?.timestamp as string
  const stamp = new Date(startedAt)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
  const recordDir = path.join(
    root,
    'runtime/logs/shell',
    `${stamp}-npm-abc12345`,
  )

  mkdirSync(recordDir, { recursive: true })
  writeFileSync(
    path.join(recordDir, 'record.json'),
    JSON.stringify({
      started_at: startedAt,
      ended_at: null,
      label: 'npm',
      pid: 4242,
      command: ['npm', 'test'],
    }),
  )
  writeFileSync(
    path.join(recordDir, 'heartbeat.json'),
    JSON.stringify({
      elapsed_seconds: 12,
      log_bytes: 48,
      last_output_at: '2026-09-30T19:00:00.000Z',
      recent_lines: ['compiling', 'done'],
    }),
  )

  const activity = readAgentActivity(root, CHILD, Date.now(), 60)
  const heartbeat = activity?.open_call?.shell_heartbeat

  assert.equal(heartbeat?.label, 'npm')
  assert.equal(heartbeat?.pid, 4242)
  assert.equal(heartbeat?.elapsed_seconds, 12)
  assert.equal(heartbeat?.log_bytes, 48)
  assert.equal(heartbeat?.last_output_at, '2026-09-30T19:00:00.000Z')
  assert.deepEqual(heartbeat?.recent_lines, ['compiling', 'done'])

  // An empty heartbeat.json (as a just-started record writes) degrades to
  // null/empty fields rather than throwing.
  writeFileSync(path.join(recordDir, 'heartbeat.json'), '{}')

  const empty = readAgentActivity(root, CHILD, Date.now(), 60)
  const emptyHeartbeat = empty?.open_call?.shell_heartbeat

  assert.equal(emptyHeartbeat?.elapsed_seconds, null)
  assert.equal(emptyHeartbeat?.log_bytes, null)
  assert.equal(emptyHeartbeat?.last_output_at, null)
  assert.deepEqual(emptyHeartbeat?.recent_lines, [])
  // record.json is still readable, so label/pid survive an empty heartbeat.
  assert.equal(emptyHeartbeat?.label, 'npm')
  assert.equal(emptyHeartbeat?.pid, 4242)
})

/** Directory-name timestamp for a given instant, in pan-run's format. */
function recordStamp(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

test('linkedShellHeartbeat prefers the record whose command matches the call summary', () => {
  const root = makeRoot()
  const callStartedAt = new Date().toISOString()
  // Distinct timestamps, both inside the 30-second link window, so ordering
  // comes from the parsed directory name rather than directory-listing order
  // (undefined when two record names share one timestamp).
  const earlierAt = callStartedAt
  const laterAt = new Date(Date.parse(callStartedAt) + 5_000).toISOString()
  const shellDir = path.join(root, 'runtime/logs/shell')
  const earlierDir = path.join(
    shellDir,
    `${recordStamp(earlierAt)}-sleep-11111111`,
  )
  const laterDir = path.join(shellDir, `${recordStamp(laterAt)}-npm-22222222`)

  mkdirSync(earlierDir, { recursive: true })
  writeFileSync(
    path.join(earlierDir, 'record.json'),
    JSON.stringify({
      started_at: earlierAt,
      ended_at: null,
      label: 'sleep',
      pid: 1111,
      command: ['sleep', '30'],
    }),
  )
  writeFileSync(path.join(earlierDir, 'heartbeat.json'), '{}')

  mkdirSync(laterDir, { recursive: true })
  writeFileSync(
    path.join(laterDir, 'record.json'),
    JSON.stringify({
      started_at: laterAt,
      ended_at: null,
      label: 'npm',
      pid: 2222,
      command: ['npm', 'test'],
    }),
  )
  writeFileSync(path.join(laterDir, 'heartbeat.json'), '{}')

  const withoutSummary = linkedShellHeartbeat(root, callStartedAt, Date.now())

  assert.equal(
    withoutSummary?.pid,
    1111,
    'with no summary to break the tie, the earliest candidate wins',
  )

  const withSummary = linkedShellHeartbeat(
    root,
    callStartedAt,
    Date.now(),
    'bin/pan-run -- npm test',
  )

  assert.equal(
    withSummary?.pid,
    2222,
    "a summary naming the record's own command breaks the tie",
  )
})

test('AC-004: an open non-shell call suppresses a stall', () => {
  const root = makeRoot()
  childStarts(root)
  handlePreToolUse(root, {
    event: 'preToolUse',
    conversation_id: CHILD,
    tool_name: 'Task',
    tool_use_id: 'tu-nested',
    tool_input: { subagent_type: 'explore', prompt: 'look around' },
  })

  assert.equal(
    readAgentActivity(root, CHILD, Date.now(), 60)?.stall_suppressed,
    true,
  )
})

// ── AC-009: hook safety ───────────────────────────────────────────────────

test('AC-009: getAgentEntry returns null for unknown agent (no crash)', () => {
  const root = makeRoot()
  const entry = getAgentEntry(root, 'nonexistent-agent')
  assert.equal(entry, null)
})

test('AC-009: getStopRecord returns null for unknown agent (no crash)', () => {
  const root = makeRoot()
  const stop = getStopRecord(root, 'nonexistent-agent')
  assert.equal(stop, null)
})

test('AC-009: getOpenCall returns null when no events exist', () => {
  const root = makeRoot()
  const openCall = getOpenCall(root, 'nonexistent-agent')
  assert.equal(openCall, null)
})

test('AC-009: file contents and Task prompts never reach the event file', () => {
  const root = makeRoot()
  handlePreToolUse(root, {
    event: 'preToolUse',
    conversation_id: CHILD,
    tool_name: 'Write',
    tool_use_id: 'tu-write',
    tool_input: {
      path: 'config/local.yaml',
      contents: 'password: file-body-secret-1',
    },
  })
  handlePreToolUse(root, {
    event: 'preToolUse',
    conversation_id: CHILD,
    tool_name: 'Task',
    tool_use_id: 'tu-task',
    tool_input: {
      subagent_type: 'explore',
      description: 'Scan',
      prompt: 'Use API_KEY=prompt-secret-value-2 to call the service',
    },
  })

  const events = rawEvents(root, CHILD)
  const index = readFileSync(path.join(root, AGENTS_DIR, 'index.json'), 'utf8')

  for (const text of [events, index]) {
    assert.ok(!text.includes('file-body-secret-1'), 'Write contents absent')
    assert.ok(!text.includes('prompt-secret-value-2'), 'Task prompt absent')
  }

  assert.ok(events.includes('config/local.yaml'), 'Write keeps the path')
  assert.ok(events.includes('explore: Scan'), 'Task keeps type and description')
})

test('AC-009: shell summaries redact inline secrets, secret flags, env and .env values', () => {
  const root = makeRoot()
  writeFileSync(
    path.join(root, '.env'),
    'SERVICE_TOKEN="dotenv-secret-value-3"\nPLAIN=visible-value\n',
  )
  const previous = process.env.PAN_TEST_SESSION_TOKEN
  process.env.PAN_TEST_SESSION_TOKEN = 'process-env-secret-4'

  const command =
    'API_TOKEN=inline-secret-value-5 curl --password flag-secret-6 ' +
    'dotenv-secret-value-3 process-env-secret-4 PLAIN=visible-value'
  const secrets = [
    'inline-secret-value-5',
    'flag-secret-6',
    'dotenv-secret-value-3',
    'process-env-secret-4',
  ]

  try {
    assert.ok(collectSecrets(root).includes('dotenv-secret-value-3'))
    assert.ok(collectSecrets(root).includes('process-env-secret-4'))
    assert.ok(!collectSecrets(root).includes('visible-value'))

    handlePreToolUse(root, {
      event: 'preToolUse',
      conversation_id: CHILD,
      tool_name: 'Shell',
      tool_use_id: 'tu-sh',
      tool_input: { command },
    })
    const events = rawEvents(root, CHILD)

    for (const secret of secrets) {
      assert.ok(!events.includes(secret), `${secret} redacted in event file`)
    }

    assert.ok(events.includes('PLAIN=visible-value'), 'non-secret kept')
  } finally {
    if (previous === undefined) {
      delete process.env.PAN_TEST_SESSION_TOKEN
    } else {
      process.env.PAN_TEST_SESSION_TOKEN = previous
    }
  }
})

test('AC-009: a secret inside a stop transcript path reaches no agent-index file name or content', () => {
  const root = makeRoot()
  const secret = 'transcript-secret-value-7'
  const previous = process.env.PAN_TEST_TRANSCRIPT_TOKEN
  process.env.PAN_TEST_TRANSCRIPT_TOKEN = secret

  try {
    childStarts(root)
    handleSubagentStop(root, {
      event: 'subagentStop',
      subagent_id: CHILD,
      parent_conversation_id: PARENT,
      status: 'completed',
      agent_transcript_path: path.join(root, `${secret}.jsonl`),
    })
    handleSubagentStop(root, {
      event: 'subagentStop',
      parent_conversation_id: 'unknown-parent',
      status: 'completed',
      agent_transcript_path: path.join(root, `orphan-${secret}.jsonl`),
    })

    const dir = path.join(root, AGENTS_DIR)

    for (const name of readdirSync(dir)) {
      assert.ok(!name.includes(secret), `${name} carries no secret`)
      assert.ok(
        !readFileSync(path.join(dir, name), 'utf8').includes(secret),
        `${name} content carries no secret`,
      )
    }

    assert.equal(getStopRecord(root, CHILD)?.status, 'completed')
  } finally {
    if (previous === undefined) {
      delete process.env.PAN_TEST_TRANSCRIPT_TOKEN
    } else {
      process.env.PAN_TEST_TRANSCRIPT_TOKEN = previous
    }
  }
})

test('AC-009: other tools keep no input summary', () => {
  assert.equal(
    summarizeToolInput('WebFetch', { url: 'https://x/?token=abc12345678' }, []),
    undefined,
  )
  assert.equal(summarizeToolInput('Read', 'not json', []), undefined)
})

test('AC-009: a lock left by a dead process is recovered', () => {
  const root = makeRoot()
  const dead = deadPid()
  writeFileSync(path.join(root, AGENTS_DIR, 'index.lock'), String(dead))

  childStarts(root)

  assert.equal(getAgentEntry(root, CHILD)?.status, 'running')
  assert.equal(existsSync(path.join(root, AGENTS_DIR, 'index.lock')), false)
})

test('AC-009: a live lock drops only the index update and keeps the stop line', () => {
  const root = makeRoot()
  childStarts(root)
  const lock = path.join(root, AGENTS_DIR, 'index.lock')
  const transcript = path.join(root, `${CHILD}.jsonl`)
  writeFileSync(transcript, '{"role":"assistant"}\n')
  writeFileSync(lock, String(process.pid))

  assert.doesNotThrow(() =>
    handleSubagentStop(root, {
      event: 'subagentStop',
      subagent_id: CHILD,
      status: 'completed',
      agent_transcript_path: transcript,
    }),
  )

  assert.equal(getAgentEntry(root, CHILD)?.status, 'running', 'index untouched')
  assert.ok(
    rawEvents(root, CHILD).includes('"kind":"stopped"'),
    'stop line kept',
  )
  assert.equal(existsSync(lock), true, 'a live owner keeps its lock')

  const stop = readAgentActivity(root, CHILD, Date.now(), 60)?.stop
  assert.equal(stop?.status, 'completed', 'the kept stop line is read')
  assert.equal(stop?.transcript_path, transcript)
  assert.equal(stop?.terminal_output_present, true)
})

// ── AC-011: cleanup retention ─────────────────────────────────────────────

test('AC-011: cleanup artifact classes include agent-index', () => {
  const agentIndexClass = CLEANUP_ARTIFACT_CLASSES.find(
    (c) => c.name === 'agent-index',
  )
  assert.ok(agentIndexClass, 'agent-index class present')
  assert.ok(
    agentIndexClass.paths.includes('runtime/logs/agents'),
    'paths includes runtime/logs/agents',
  )
  assert.equal(agentIndexClass.disposal, 'delete')
})

test('AC-011: an index write prunes old terminal agents and old launches', () => {
  const root = makeRoot()
  const old = new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString()
  writeFileSync(
    path.join(root, AGENTS_DIR, 'index.json'),
    JSON.stringify({
      schema_version: 1,
      updated_at: old,
      agents: [
        {
          agent_id: 'old-done',
          parent_agent_id: null,
          subagent_type: null,
          model: null,
          status: 'completed',
          registered_at: old,
          last_event_at: old,
          last_event_kind: 'stopped',
          run_id: null,
          invocation_id: null,
          aliases: ['old-alias'],
          transcript_path: null,
          stop: null,
        },
      ],
      aliases: { 'old-alias': 'old-done' },
      pending_launches: [
        {
          parent_agent_id: 'p',
          tool_use_id: 'never-started',
          prompt_digest: null,
          subagent_type: null,
          description: null,
          requested_at: old,
        },
      ],
    }),
  )

  childStarts(root)

  const index = readAgentIndex(root)
  assert.deepEqual(
    index.agents.map((a) => a.agent_id),
    [CHILD],
  )
  assert.equal(index.aliases['old-alias'], undefined)
  assert.equal(index.pending_launches.length, 0)
})

function writeHooksJson(
  filePath: string,
  events: Record<string, string[]>,
): void {
  const hooks: Record<string, Array<{ command: string }>> = {}

  for (const [event, commands] of Object.entries(events)) {
    hooks[event] = commands.map((command) => ({ command }))
  }

  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify({ version: 1, hooks }, null, 2))
}

test('agentIndexHooksStatus is null with no canonical hooks.json to compare against', () => {
  const root = createTestTempDirectory('agent-index-hooks-')

  assert.equal(agentIndexHooksStatus(root), null)
})

test('agentIndexHooksStatus reports every canonical agent-index event a stale projection lacks', () => {
  const root = createTestTempDirectory('agent-index-hooks-')

  writeHooksJson(path.join(root, 'library', 'cursor', 'hooks.json'), {
    preToolUse: [
      'bin/pan-hook-deny-await-shell',
      'bin/pan-hook-agent-index preToolUse',
    ],
    postToolUse: ['bin/pan-hook-agent-index postToolUse'],
    subagentStart: ['bin/pan-hook-agent-index subagentStart'],
  })
  // The projected file predates the agent-index hooks: it still wires the
  // deny hook, but never the agent-index one, and carries no subagentStart
  // entry at all.
  writeHooksJson(path.join(root, '.cursor', 'hooks.json'), {
    preToolUse: ['bin/pan-hook-deny-await-shell'],
    postToolUse: ['bin/pan-hook-agent-index postToolUse'],
  })

  const status = agentIndexHooksStatus(root)

  assert.equal(status?.projected, false)
  assert.deepEqual([...(status?.missing_events ?? [])].sort(), [
    'preToolUse',
    'subagentStart',
  ])
})

test('agentIndexHooksStatus reports current when the projection carries every agent-index hook', () => {
  const root = createTestTempDirectory('agent-index-hooks-')

  writeHooksJson(path.join(root, 'library', 'cursor', 'hooks.json'), {
    preToolUse: ['bin/pan-hook-agent-index preToolUse'],
    subagentStart: ['bin/pan-hook-agent-index subagentStart'],
  })
  writeHooksJson(path.join(root, '.cursor', 'hooks.json'), {
    preToolUse: ['bin/pan-hook-agent-index preToolUse'],
    subagentStart: ['bin/pan-hook-agent-index subagentStart'],
  })

  const status = agentIndexHooksStatus(root)

  assert.equal(status?.projected, true)
  assert.deepEqual(status?.missing_events, [])
})

test('agentIndexHooksStatus reports every event missing when the projected file is absent', () => {
  const root = createTestTempDirectory('agent-index-hooks-')

  writeHooksJson(path.join(root, 'library', 'cursor', 'hooks.json'), {
    subagentStart: ['bin/pan-hook-agent-index subagentStart'],
  })

  const status = agentIndexHooksStatus(root)

  assert.equal(status?.projected, false)
  assert.deepEqual(status?.missing_events, ['subagentStart'])
})

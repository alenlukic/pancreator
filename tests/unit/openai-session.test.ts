import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  OPENAI_REDACTION_MARKER,
  readOpenAiTranscript,
  redactOpenAiKey,
  runOpenAiSession,
  writeOpenAiTranscript,
  type OpenAiSessionRequest,
  type OpenAiTranscript,
} from '../../src/lib/executors/openai-session.js'
import {
  OPENAI_TOOL_NAMES,
  type OpenAiToolPolicy,
} from '../../src/lib/executors/openai-tools.js'
import { createTestTempDirectory } from '../temp.js'

const SENTINEL = 'sk-test-SENTINEL-DO-NOT-LEAK'

interface Turn {
  tool_calls?: { name: string; arguments: Record<string, unknown> }[]
  text?: string
  status?: number
  error?: string
  delay_ms?: number
  repeat?: boolean
}

interface Harness {
  request: OpenAiSessionRequest
  bodies: Record<string, unknown>[]
  evidenceDir: string
  workspaceDir: string
}

function scriptedFetch(
  turns: Turn[],
  bodies: Record<string, unknown>[],
): typeof fetch {
  let index = 0

  return (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    const turn = turns[index] ?? turns.at(-1) ?? { text: 'done' }
    const current = index

    bodies.push(body)

    if (turns[index]?.repeat !== true) {
      index += 1
    }

    if (turn.delay_ms !== undefined) {
      // Honor the client's abort signal, so the timeout bound is exercised
      // rather than waited out.
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, turn.delay_ms)

        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        })
      })
    }

    if (turn.status !== undefined) {
      return new Response(
        JSON.stringify({ error: { message: turn.error ?? 'rejected' } }),
        { status: turn.status },
      )
    }

    const output: Record<string, unknown>[] = [
      ...(turn.tool_calls ?? []).map((call, callIndex) => ({
        type: 'function_call',
        call_id: `call_${current}_${callIndex}`,
        name: call.name,
        arguments: JSON.stringify(call.arguments),
      })),
      ...(turn.text === undefined
        ? []
        : [
            {
              type: 'message',
              content: [{ type: 'output_text', text: turn.text }],
            },
          ]),
    ]

    return new Response(
      JSON.stringify({
        id: `resp_${current}`,
        model: 'gpt-6-astra',
        status: 'completed',
        output,
        usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
      }),
      { status: 200 },
    )
  }) as typeof fetch
}

function harness(turns: Turn[], overrides: Partial<OpenAiSessionRequest> = {}) {
  const base = createTestTempDirectory('openai-session-')
  const workspaceDir = path.join(base, 'workspace')
  const evidenceDir = path.join(base, 'evidence')
  const bodies: Record<string, unknown>[] = []

  mkdirSync(workspaceDir, { recursive: true })
  mkdirSync(evidenceDir, { recursive: true })
  writeFileSync(path.join(workspaceDir, 'card.md'), '# card\n')

  const toolPolicy: OpenAiToolPolicy = {
    workspaceDir,
    readRoots: [workspaceDir],
    writeRoots: [workspaceDir],
    allowedTools: [...OPENAI_TOOL_NAMES],
    maxResultBytes: 4096,
    shellTimeoutMs: 5_000,
  }
  const request: OpenAiSessionRequest = {
    apiKey: SENTINEL,
    model: 'gpt-6-astra',
    prompt: '# Canonical card\n',
    invocationId: '99_implement-1_abcdef12',
    stage: 'implement',
    sessionId: 'openai-test-session',
    maxToolRounds: 4,
    requestTimeoutMs: 5_000,
    sessionTimeoutMs: 5_000,
    transcriptPath: path.join(evidenceDir, 'transcript.json'),
    transcriptMaxBytes: 64 * 1024,
    toolPolicy,
    fetchImpl: scriptedFetch(turns, bodies),
    ...overrides,
  }

  return { request, bodies, evidenceDir, workspaceDir } satisfies Harness
}

test('tool results return to the model paired with their call ids', async () => {
  const { request, bodies, workspaceDir } = harness([
    { tool_calls: [{ name: 'read_file', arguments: { path: 'card.md' } }] },
    {
      tool_calls: [
        { name: 'write_file', arguments: { path: 'out.txt', content: 'done' } },
      ],
    },
    { text: 'stage complete' },
  ])
  const result = await runOpenAiSession(request)

  assert.equal(result.ok, true)
  assert.equal(result.rounds, 2)
  assert.equal(result.finalMessage, 'stage complete')
  assert.deepEqual(result.toolSummary, { read_file: 1, write_file: 1 })
  assert.deepEqual(result.responseIds, ['resp_0', 'resp_1', 'resp_2'])
  assert.deepEqual(result.usage, {
    input_tokens: 12,
    output_tokens: 6,
    total_tokens: 18,
  })
  assert.equal(readFileSync(path.join(workspaceDir, 'out.txt'), 'utf8'), 'done')

  // Every request after the first carries the previous call's output, paired
  // by call_id, because retention is off and the whole conversation is resent.
  const second = bodies[1]?.input as Record<string, unknown>[]

  assert.equal(second[0]?.content, '# Canonical card\n')
  assert.equal(second[1]?.type, 'function_call')
  assert.equal(second[2]?.type, 'function_call_output')
  assert.equal(second[1]?.call_id, second[2]?.call_id)
  assert.equal(second[2]?.output, '# card\n')
})

test('every request disables retention and sends no previous_response_id', async () => {
  const { request, bodies } = harness([
    { tool_calls: [{ name: 'list_directory', arguments: { path: '.' } }] },
    { text: 'done' },
  ])

  await runOpenAiSession(request)

  assert.equal(bodies.length, 2)

  for (const body of bodies) {
    assert.equal(body.store, false)
    assert.equal(body.previous_response_id, undefined)
    assert.ok(Array.isArray(body.tools), 'the tool catalog is attached')
  }
})

test('the round limit ends the session with a named failure', async () => {
  const { request } = harness([
    {
      tool_calls: [{ name: 'list_directory', arguments: { path: '.' } }],
      repeat: true,
    },
  ])
  const result = await runOpenAiSession({ ...request, maxToolRounds: 2 })

  assert.equal(result.ok, false)
  assert.equal(result.failureReason, 'round_limit')
  assert.match(result.error ?? '', /round limit of 2/u)
  assert.equal(result.rounds, 2)
})

test('a slow endpoint fails as a timeout rather than hanging', async () => {
  const { request } = harness([{ delay_ms: 2_000, text: 'too late' }])
  const result = await runOpenAiSession({
    ...request,
    requestTimeoutMs: 150,
    sessionTimeoutMs: 150,
  })

  assert.equal(result.ok, false)
  assert.equal(result.failureReason, 'timeout')
})

test('an oversized tool argument stops the session at the result cap', async () => {
  const { request } = harness([
    {
      tool_calls: [
        {
          name: 'write_file',
          arguments: { path: 'big.txt', content: 'x'.repeat(9_000) },
        },
      ],
    },
  ])
  const result = await runOpenAiSession(request)

  assert.equal(result.ok, false)
  assert.equal(result.failureReason, 'result_cap')
  assert.match(result.error ?? '', /over the 4096-byte cap/u)
})

test('the resolved key is removed from every error the session reports', async () => {
  const { request } = harness([
    {
      status: 401,
      error: `invalid credential ${SENTINEL} supplied`,
    },
  ])
  const result = await runOpenAiSession(request)

  assert.equal(result.ok, false)
  assert.equal(result.failureReason, 'request_failed')
  assert.equal((result.error ?? '').includes(SENTINEL), false)
  assert.match(result.error ?? '', /\[redacted:OPENAI_API_KEY\]/u)
  assert.equal(
    redactOpenAiKey(`a ${SENTINEL} b`, SENTINEL),
    `a ${OPENAI_REDACTION_MARKER} b`,
  )
})

test('the transcript holds conversation items under the run evidence directory', async () => {
  const { request, evidenceDir } = harness([
    { tool_calls: [{ name: 'read_file', arguments: { path: 'card.md' } }] },
    { text: 'done' },
  ])

  await runOpenAiSession(request)

  const transcript = readOpenAiTranscript(request.transcriptPath)

  assert.ok(transcript)
  assert.equal(path.dirname(request.transcriptPath), evidenceDir)
  assert.equal(transcript.session_id, 'openai-test-session')
  assert.equal(transcript.truncated, false)
  assert.deepEqual(transcript.items[0], {
    role: 'user',
    content: '# Canonical card\n',
  })
  assert.ok(
    Buffer.byteLength(readFileSync(request.transcriptPath, 'utf8'), 'utf8') <=
      request.transcriptMaxBytes,
  )

  // The transcript carries conversation items only: no credential and no
  // ambient environment value reaches it.
  const raw = readFileSync(request.transcriptPath, 'utf8')

  assert.equal(raw.includes(SENTINEL), false)
  assert.deepEqual(Object.keys(JSON.parse(raw) as object).sort(), [
    'invocation_id',
    'items',
    'recorded_at',
    'schema_version',
    'session_id',
    'stage',
    'truncated',
  ])
})

test('a transcript over its cap drops oldest items and records the drop', () => {
  const directory = createTestTempDirectory('openai-transcript-')
  const transcriptPath = path.join(directory, 'transcript.json')
  const transcript: OpenAiTranscript = {
    schema_version: 1,
    session_id: 'openai-cap',
    invocation_id: 'inv',
    stage: 'implement',
    recorded_at: '2026-09-14T00:00:00.000Z',
    truncated: false,
    items: [
      { role: 'user', content: 'card' },
      ...Array.from({ length: 40 }, (_unused, index) => ({
        role: 'assistant' as const,
        content: `filler ${index} ${'y'.repeat(200)}`,
      })),
    ],
  }
  const written = writeOpenAiTranscript(transcriptPath, transcript, 2_000)

  assert.equal(written.truncated, true)
  assert.deepEqual(written.items[0], { role: 'user', content: 'card' })
  assert.ok(written.items.length < transcript.items.length)
  assert.ok(
    Buffer.byteLength(readFileSync(transcriptPath, 'utf8'), 'utf8') <= 2_100,
  )
})

test('an unreadable transcript is reported as uncontinuable', () => {
  const directory = createTestTempDirectory('openai-transcript-bad-')
  const missing = path.join(directory, 'absent.json')
  const malformed = path.join(directory, 'malformed.json')
  const empty = path.join(directory, 'empty.json')

  writeFileSync(malformed, 'not json')
  writeFileSync(empty, JSON.stringify({ items: [] }))

  assert.equal(readOpenAiTranscript(missing), null)
  assert.equal(readOpenAiTranscript(malformed), null)
  assert.equal(readOpenAiTranscript(empty), null)
})

test('resume items are prepended so the model keeps its prior context', async () => {
  const { request, bodies } = harness([{ text: 'revised' }])
  const result = await runOpenAiSession({
    ...request,
    prompt: 'operator directive',
    resumeItems: [
      { role: 'user', content: 'the original card' },
      { role: 'assistant', content: 'round one' },
    ],
  })

  assert.equal(result.ok, true)

  const input = bodies[0]?.input as Record<string, unknown>[]

  assert.deepEqual(
    input.map((item) => item.content),
    ['the original card', 'round one', 'operator directive'],
  )
})

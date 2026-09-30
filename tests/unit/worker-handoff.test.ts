import assert from 'node:assert/strict'
import test from 'node:test'

import {
  handoffNotesFromOutput,
  priorSourceAttempt,
  readingMapFromTranscript,
} from '../../src/lib/worker-handoff.js'
import type { RunState, StageHistoryItem } from '../../src/lib/types.js'

const WORKSPACE = '/work/repo'

function turn(...tools: Array<[string, Record<string, unknown>]>): string {
  return JSON.stringify({
    role: 'assistant',
    message: {
      content: tools.map(([name, input]) => ({
        type: 'tool_use',
        name,
        input,
      })),
    },
  })
}

test('the reading map merges ranges, marks whole reads and edits, and drops harness paths', () => {
  const transcript = [
    turn([
      'Read',
      { path: `${WORKSPACE}/src/lib/engine.ts`, offset: 100, limit: 50 },
    ]),
    turn([
      'Read',
      { path: `${WORKSPACE}/src/lib/engine.ts`, offset: 140, limit: 30 },
    ]),
    turn([
      'Read',
      { path: `${WORKSPACE}/src/lib/engine.ts`, offset: 400, limit: 10 },
    ]),
    turn(['Read', { path: `${WORKSPACE}/src/lib/io.ts` }]),
    turn(['Grep', { path: `${WORKSPACE}/src/lib/io.ts`, pattern: 'readJson' }]),
    turn(['StrReplace', { path: `${WORKSPACE}/src/lib/io.ts` }]),
    turn(['Read', { path: `${WORKSPACE}/runtime/logs/workflows/run/card.md` }]),
    turn(['Read', { path: '/elsewhere/notes.md' }]),
  ].join('\n')

  const map = readingMapFromTranscript(transcript, [WORKSPACE])

  assert.deepEqual(
    map.map((entry) => entry.path),
    ['src/lib/io.ts', 'src/lib/engine.ts'],
  )
  assert.deepEqual(map[0], {
    path: 'src/lib/io.ts',
    whole: true,
    ranges: [],
    reads: 1,
    edited: true,
    patterns: ['readJson'],
  })
  assert.deepEqual(map[1]?.ranges, [
    [100, 169],
    [400, 409],
  ])
  assert.equal(map[1]?.reads, 3)
})

test('handoff notes read only the structured field and tolerate its absence', () => {
  assert.equal(handoffNotesFromOutput({ data: { implementation: {} } }), null)

  const notes = handoffNotesFromOutput({
    data: {
      implementation: {
        handoff: {
          symbols_changed: [
            { path: 'src/lib/io.ts', symbol: 'readJson', lines: '113-122' },
          ],
          decisions: ['Kept the thrown error code.'],
          untested: [7],
          start_here: [{ path: 'src/lib/io.ts', why: 'the parser' }],
        },
      },
    },
  })

  assert.deepEqual(notes?.symbols_changed[0]?.symbol, 'readJson')
  assert.deepEqual(notes?.decisions, ['Kept the thrown error code.'])
  assert.deepEqual(notes?.untested, [])
  assert.equal(notes?.start_here[0]?.why, 'the parser')
})

test('a source stage inherits from the latest earlier source attempt, and a read-only stage from none', () => {
  const item = (stage: string, id: string): StageHistoryItem =>
    ({ stage, invocation_id: id }) as StageHistoryItem
  const state = {
    stage_history: [
      item('implement', 'implement-1'),
      item('verify', 'verify-1'),
      item('remediate', 'remediate-1'),
      item('verify', 'verify-2'),
    ],
  } as unknown as RunState

  assert.equal(
    priorSourceAttempt(state, 'remediate')?.invocation_id,
    'remediate-1',
  )
  assert.equal(priorSourceAttempt(state, 'verify'), null)
  assert.equal(
    priorSourceAttempt(
      { stage_history: [] } as unknown as RunState,
      'implement',
    ),
    null,
  )
})

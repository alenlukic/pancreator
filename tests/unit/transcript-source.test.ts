import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  COPILOT_SESSIONS_ENV,
  executorTranscript,
  transcriptSteps,
} from '../../src/lib/transcripts/source.js'
import { delegationExecutionPath } from '../../src/lib/validation/artifacts.js'
import { readingMapFromTranscript } from '../../src/lib/worker-handoff.js'
import { invocationShellBrowsingCalls } from '../../src/lib/worker-profile/invocations.js'
import { assistantTurns } from '../../src/lib/worker-profile/transcript.js'
import { createTestTempDirectory } from '../temp.js'

const lines = (...records: unknown[]): string =>
  records.map((record) => JSON.stringify(record)).join('\n')

const COPILOT_TRANSCRIPT = lines(
  { type: 'session.start', data: {} },
  { type: 'user.message', data: { content: 'Implement it.' } },
  {
    type: 'assistant.message',
    data: {
      content: '',
      toolRequests: [
        {
          toolCallId: 't1',
          name: 'view',
          arguments: { path: '/work/src/a.ts', view_range: [10, 19] },
        },
        {
          toolCallId: 't2',
          name: 'edit',
          arguments: JSON.stringify({ path: '/work/src/b.ts' }),
        },
        {
          toolCallId: 't3',
          name: 'grep_search',
          arguments: { query: 'needle', filePath: '/work/src/a.ts' },
        },
        { toolCallId: 't4', name: 'bash', arguments: { command: 'cat x' } },
      ],
    },
  },
  { type: 'assistant.message', data: { content: 'Done.' } },
)

test('Cursor and Copilot transcripts read as the same steps', () => {
  const cursor = transcriptSteps(
    lines(
      { role: 'user', message: { content: [{ type: 'text', text: 'Go' }] } },
      {
        role: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Reading.' },
            { type: 'tool_use', name: 'Read', input: { path: '/a' } },
          ],
        },
      },
      'not json',
    ),
  )

  assert.deepEqual(cursor, [
    { role: 'user', text: 'Go', tools: [] },
    {
      role: 'assistant',
      text: 'Reading.',
      tools: [{ name: 'Read', input: { path: '/a' } }],
    },
  ])

  const copilot = transcriptSteps(COPILOT_TRANSCRIPT)

  assert.deepEqual(
    copilot.map((step) => step.role),
    ['user', 'assistant', 'assistant'],
  )
  assert.deepEqual(
    copilot[1]?.tools.map((tool) => tool.name),
    ['Read', 'StrReplace', 'Grep', 'Shell'],
  )
  assert.equal(copilot[1]?.tools[0]?.input.offset, 10)
  assert.equal(copilot[1]?.tools[0]?.input.limit, 10)
  assert.equal(copilot[1]?.tools[2]?.input.pattern, 'needle')
  assert.equal(assistantTurns(COPILOT_TRANSCRIPT).length, 2)
})

test('a Copilot worker transcript feeds the handoff map and shell counts', () => {
  const map = readingMapFromTranscript(COPILOT_TRANSCRIPT, ['/work'])

  assert.deepEqual(
    map.map((entry) => [entry.path, entry.edited, entry.ranges]),
    [
      ['src/b.ts', true, []],
      ['src/a.ts', false, [[10, 19]]],
    ],
  )

  const root = createTestTempDirectory('transcript-source-root-')
  const sessions = createTestTempDirectory('transcript-source-sessions-')
  const record = path.join(
    root,
    delegationExecutionPath('run-1', 'inv-1', root),
  )
  const previous = process.env[COPILOT_SESSIONS_ENV]

  writeFileSync(
    path.join(root, 'config.json'),
    JSON.stringify({ schema_version: 1, workspace_root: '.' }),
  )
  mkdirSync(path.dirname(record), { recursive: true })
  writeFileSync(
    record,
    JSON.stringify({
      schema_version: 1,
      executor: 'copilot',
      session_id: 's-1',
    }),
  )
  mkdirSync(path.join(sessions, 's-1'), { recursive: true })
  writeFileSync(path.join(sessions, 's-1', 'events.jsonl'), COPILOT_TRANSCRIPT)
  process.env[COPILOT_SESSIONS_ENV] = sessions

  try {
    assert.equal(
      executorTranscript(root, 'run-1', 'inv-1'),
      path.join(sessions, 's-1', 'events.jsonl'),
    )
    assert.equal(executorTranscript(root, 'run-1', 'inv-2'), null)
    assert.deepEqual(invocationShellBrowsingCalls(root, 'inv-1', 0, 'run-1'), {
      transcripts: 1,
      shell_browsing_calls: 1,
    })
  } finally {
    if (previous === undefined) {
      delete process.env[COPILOT_SESSIONS_ENV]
    } else {
      process.env[COPILOT_SESSIONS_ENV] = previous
    }
  }
})

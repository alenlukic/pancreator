import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { TOOL_UPDATE_REMINDER } from '../../src/lib/governance/visible-chat.js'
import { createTestTempDirectory } from '../temp.js'

const HOOK = path.join(process.cwd(), 'bin', 'pan-hook-visible-chat')

function runHook(event: string, payload: string): unknown {
  const result = spawnSync(HOOK, [event], {
    input: payload,
    encoding: 'utf8',
    timeout: 10_000,
  })

  assert.equal(result.status, 0)

  return JSON.parse(result.stdout)
}

test('bin/pan-hook-visible-chat injects the reminder after a tool-only step', () => {
  const file = path.join(
    createTestTempDirectory('visible-chat-hook-'),
    't.jsonl',
  )

  writeFileSync(
    file,
    [
      { role: 'user', message: { content: [] } },
      {
        role: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Shell' }] },
      },
    ]
      .map((record) => JSON.stringify(record))
      .join('\n') + '\n',
  )

  assert.deepEqual(
    runHook('postToolUse', JSON.stringify({ transcript_path: file })),
    { additional_context: TOOL_UPDATE_REMINDER },
  )
})

test('bin/pan-hook-visible-chat answers {} for an unknown event or bad payload', () => {
  assert.deepEqual(runHook('bogus', '{}'), {})
  assert.deepEqual(runHook('postToolUse', 'not json'), {})
})

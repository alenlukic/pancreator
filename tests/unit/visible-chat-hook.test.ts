import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  currentTurnSteps,
  resolveVisibleChatHook,
  SILENT_TURN_FOLLOWUP,
  TOOL_UPDATE_REMINDER,
  TURN_TAIL_BYTES,
} from '../../src/lib/governance/visible-chat.js'
import { createTestTempDirectory } from '../temp.js'

type Part = { type: 'text'; text: string } | { type: 'tool_use'; name: string }

const user = {
  role: 'user',
  message: { content: [{ type: 'text', text: 'go' }] },
}
const tool: Part = { type: 'tool_use', name: 'Shell' }
const say = (text: string): Part => ({ type: 'text', text })
const step = (...content: Part[]) => ({
  role: 'assistant',
  message: { content },
})

function transcript(...records: unknown[]): string {
  const file = path.join(createTestTempDirectory('visible-chat-'), 't.jsonl')

  writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n')

  return file
}

function hook(
  event: 'postToolUse' | 'stop',
  file: string,
  extra: Record<string, unknown> = {},
) {
  return resolveVisibleChatHook(
    event,
    JSON.stringify({ transcript_path: file, ...extra }),
  )
}

test('a tool-only step gets the one-line update reminder after its result', () => {
  const file = transcript(
    user,
    step(say('Now reading the rows.'), tool),
    step(tool),
  )

  assert.deepEqual(hook('postToolUse', file), {
    additional_context: TOOL_UPDATE_REMINDER,
  })
})

test('a step that names its action before the tool call gets no reminder', () => {
  const file = transcript(
    user,
    step(tool),
    step(say('Now running tests.'), tool),
  )

  assert.deepEqual(hook('postToolUse', file), {})
})

test('only the current turn counts: steps before the last user record are ignored', () => {
  const file = transcript(user, step(tool), user, step(say('Checking.'), tool))

  assert.deepEqual(currentTurnSteps(file), [{ text: true, tool: true }])
  assert.deepEqual(hook('postToolUse', file), {})
})

test('the first stop of a turn with no chat text asks for a visible report', () => {
  const file = transcript(user, step(tool), step(tool))

  assert.deepEqual(hook('stop', file, { status: 'completed', loop_count: 0 }), {
    followup_message: SILENT_TURN_FOLLOWUP,
  })
})

test('stop asks once, only for completed turns, and never when text exists', () => {
  const silent = transcript(user, step(tool))
  const spoken = transcript(user, step(tool), step(say('Done: tests pass.')))

  assert.deepEqual(
    hook('stop', silent, { status: 'completed', loop_count: 1 }),
    {},
  )
  assert.deepEqual(
    hook('stop', silent, { status: 'aborted', loop_count: 0 }),
    {},
  )
  assert.deepEqual(
    hook('stop', spoken, { status: 'completed', loop_count: 0 }),
    {},
  )
})

test('whitespace-only text does not count as a visible update', () => {
  const file = transcript(user, step(say('  \n'), tool))

  assert.deepEqual(hook('postToolUse', file), {
    additional_context: TOOL_UPDATE_REMINDER,
  })
})

test('a transcript longer than the tail bound skips the cut first line', () => {
  const padding = step(say('x'.repeat(TURN_TAIL_BYTES)))
  const file = transcript(user, padding, user, step(tool))

  assert.deepEqual(currentTurnSteps(file), [{ text: false, tool: true }])
})

test('missing, relative, or malformed input never produces a response', () => {
  const root = createTestTempDirectory('visible-chat-')

  assert.deepEqual(hook('postToolUse', path.join(root, 'absent.jsonl')), {})
  assert.deepEqual(hook('postToolUse', 'relative/t.jsonl'), {})
  assert.deepEqual(resolveVisibleChatHook('postToolUse', 'not json'), {})
  assert.deepEqual(resolveVisibleChatHook('stop', '{}'), {})
})

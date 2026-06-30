import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

import {
  createCursorSdkInvocationLogger,
  withCursorSdkInvocationLogging,
  type CursorSdkRunLike,
  type CursorSdkRunResultLike,
} from '../../src/lib/cursor-sdk-logging.js'

function assistant(text: string): unknown {
  return {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text }],
    },
  }
}

test('Cursor SDK logger renders concise narrative and grouped tool calls', () => {
  const output: string[] = []
  const logger = createCursorSdkInvocationLogger({
    task: 'investigating the automation failure',
    write: (chunk) => output.push(chunk),
    idleUpdateMs: 0,
  })

  logger.observe(
    assistant(
      'I will read the operating contract, inspect the automation evidence, and establish the failure timeline.',
    ),
  )
  logger.observe({
    type: 'tool_call',
    call_id: 'read-1',
    name: 'read_file',
    status: 'running',
    args: { path: 'AGENTS.md', start_line: '1', end_line: '85' },
  })
  logger.observe({
    type: 'tool_call',
    call_id: 'read-1',
    name: 'read_file',
    status: 'completed',
  })
  logger.observe({
    type: 'tool_call',
    call_id: 'grep-1',
    name: 'grep',
    status: 'completed',
    args: { pattern: 'automation', path: 'runtime' },
  })
  logger.progress(
    'The operating contract is loaded; I am now checking runtime evidence.',
  )
  logger.close()

  const rendered = output.join('')
  assert.match(rendered, /^I will read the operating contract/u)
  assert.match(rendered, /Explored 2 files/u)
  assert.match(rendered, /  Read AGENTS\.md L1–85/u)
  assert.match(rendered, /  Searched automation in runtime/u)
  assert.match(rendered, /The operating contract is loaded/u)
  assert.doesNotMatch(rendered, /\[pan/u)
})

test('Cursor SDK logger surfaces tool failures as significant issues', () => {
  const output: string[] = []
  const logger = createCursorSdkInvocationLogger({
    task: 'running validation',
    write: (chunk) => output.push(chunk),
    idleUpdateMs: 0,
  })

  logger.observe({
    type: 'tool_call',
    call_id: 'shell-1',
    name: 'shell',
    status: 'running',
    args: { command: 'npm test' },
  })
  logger.observe({
    type: 'tool_call',
    call_id: 'shell-1',
    name: 'shell',
    status: 'error',
    result: { stderr: 'two tests failed' },
  })
  logger.close()

  const rendered = output.join('')
  assert.match(rendered, /Ran 1 command/u)
  assert.match(rendered, /  Ran npm test/u)
  assert.match(rendered, /Issue: shell failed — two tests failed/u)
})

test('Cursor SDK logger emits an idle progress update after the configured interval', async () => {
  const output: string[] = []
  const logger = createCursorSdkInvocationLogger({
    task: 'checking the current agent task',
    write: (chunk) => output.push(chunk),
    idleUpdateMs: 20,
  })

  await delay(35)
  logger.close()

  assert.match(
    output.join(''),
    /Still working on checking the current agent task…/u,
  )
})

test('invocation wrapper streams events, records raw evidence, and returns the SDK result', async () => {
  const output: string[] = []
  const recorded: unknown[] = []
  const events = [
    assistant('I will inspect the repository and report the result.'),
  ]
  const expected = {
    status: 'finished',
    result: 'Inspection complete.',
  } satisfies CursorSdkRunResultLike

  const run: CursorSdkRunLike<typeof expected> = {
    async *stream() {
      yield* events
    },
    async wait() {
      return expected
    },
  }

  const result = await withCursorSdkInvocationLogging({
    task: 'inspecting the repository',
    invoke: async () => run,
    write: (chunk) => output.push(chunk),
    recordEvent: (event) => recorded.push(event),
    idleUpdateMs: 0,
  })

  assert.equal(result, expected)
  assert.deepEqual(recorded, events)
  assert.match(output.join(''), /I will inspect the repository/u)
  assert.doesNotMatch(output.join(''), /Inspection complete/u)
})

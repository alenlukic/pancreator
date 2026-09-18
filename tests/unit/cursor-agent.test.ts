import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CURSOR_SESSION_REQUIRED_FLAGS,
  cursorAgentSessionArguments,
} from '../../src/lib/executors/cursor-agent.js'

test('cursor stage arguments preserve the model spec and granted roots', () => {
  const model = 'claude-opus-5[context=1m,effort=high,fast=false]'

  assert.deepEqual(
    cursorAgentSessionArguments({
      model,
      workspaceRoot: '/target/worktree',
      addDirs: ['/harness/runtime'],
    }),
    [
      '-p',
      '--output-format',
      'stream-json',
      '--trust',
      '--model',
      model,
      '--workspace',
      '/target/worktree',
      '--add-dir',
      '/harness/runtime',
    ],
  )
})

test('preflight requires exactly the flags the stage vector always emits', () => {
  const request = {
    model: 'claude-opus-5[effort=high]',
    workspaceRoot: '/target/worktree',
    addDirs: ['/harness/runtime'],
  }
  const flagsOf = (argv: string[]): string[] =>
    argv.filter((item) => item.startsWith('--'))

  assert.deepEqual(
    flagsOf(cursorAgentSessionArguments(request)),
    CURSOR_SESSION_REQUIRED_FLAGS,
  )

  // `--resume` is the one conditional flag, so preflight must not require it:
  // a CLI that dropped it would otherwise pause every fresh delegation, and a
  // resume it cannot accept already falls back to a fresh delivery.
  assert.deepEqual(
    flagsOf(
      cursorAgentSessionArguments({ ...request, sessionId: 'session-123' }),
    ).filter((flag) => !CURSOR_SESSION_REQUIRED_FLAGS.includes(flag)),
    ['--resume'],
  )
})

test('cursor stage arguments append the recorded session on resume', () => {
  assert.deepEqual(
    cursorAgentSessionArguments({
      model: 'gpt-5.6-sol[reasoning=high]',
      sessionId: 'session-123',
      workspaceRoot: '/target/worktree',
      addDirs: ['/harness/runtime'],
    }),
    [
      '-p',
      '--output-format',
      'stream-json',
      '--trust',
      '--model',
      'gpt-5.6-sol[reasoning=high]',
      '--resume',
      'session-123',
      '--workspace',
      '/target/worktree',
      '--add-dir',
      '/harness/runtime',
    ],
  )
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  mergeCursorHooks,
  mergeCursorHooksText,
} from '../../src/lib/cursor-hooks-merge.js'
import { PanError } from '../../src/lib/errors.js'

const HOOKS_SOURCE =
  '{"version":1,"hooks":{"beforeSubmitPrompt":[{"command":"bin/pan-hook-governance-reminder"}]}}'

test('hook merge replaces owned entries and preserves target hook state', () => {
  const targetEntry = { command: './target-hook', timeout: 12 }
  const otherEventEntry = { command: './other-event' }
  const managedEntry = {
    command: '.pancreator/bin/pan-hook-governance-reminder',
    timeout: 5,
  }

  assert.deepEqual(
    mergeCursorHooks(
      {
        version: 7,
        targetField: 'retained',
        hooks: {
          beforeSubmitPrompt: [
            targetEntry,
            { command: './old/pan-hook-retired' },
          ],
          afterFileEdit: [otherEventEntry],
        },
      },
      {
        version: 1,
        hooks: {
          beforeSubmitPrompt: [managedEntry],
        },
      },
    ),
    {
      version: 7,
      targetField: 'retained',
      hooks: {
        beforeSubmitPrompt: [targetEntry, managedEntry],
        afterFileEdit: [otherEventEntry],
      },
    },
  )
})

test('hook serialization is stable and rejects malformed event arrays', () => {
  const source = HOOKS_SOURCE
  const first = mergeCursorHooksText(null, source)

  assert.equal(mergeCursorHooksText(first, source), first)
  assert.ok(first.endsWith('\n'))
  assert.throws(
    () => mergeCursorHooksText('{"hooks":{"beforeSubmitPrompt":{}}}', source),
    /beforeSubmitPrompt MUST contain an array/u,
  )
})

test('an empty existing hooks file merges as an absent document', () => {
  const absent = mergeCursorHooksText(null, HOOKS_SOURCE)

  assert.equal(mergeCursorHooksText('', HOOKS_SOURCE), absent)
  assert.equal(mergeCursorHooksText('  \n\t\n', HOOKS_SOURCE), absent)
})

test('invalid existing hooks JSON fails with a path-aware domain error', () => {
  assert.throws(
    () =>
      mergeCursorHooksText('{ "hooks": ', HOOKS_SOURCE, '.cursor/hooks.json'),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'INVALID_CURSOR_HOOKS' &&
      error.message.startsWith('.cursor/hooks.json is not valid JSON:'),
  )
})

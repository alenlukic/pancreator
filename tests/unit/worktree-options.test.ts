import assert from 'node:assert/strict'
import test from 'node:test'

import { assertWorktreeOptionSupported } from '../../src/cli.js'
import { PanError } from '../../src/lib/errors.js'

test('commands without a selectable workspace reject the shared option', () => {
  for (const invocation of [
    ['list'],
    ['worktree', 'list'],
    ['repository-check', 'validate'],
    ['governance', 'audit-directives'],
  ]) {
    assert.throws(
      () =>
        assertWorktreeOptionSupported(invocation[0] as string, [
          ...invocation.slice(1),
          '--worktree',
          'nope',
        ]),
      (error: unknown) =>
        error instanceof PanError &&
        error.code === 'WORKTREE_OPTION_UNSUPPORTED' &&
        /technologies detect/u.test(error.message),
      invocation.join(' '),
    )
  }

  assert.throws(
    () =>
      assertWorktreeOptionSupported('repository-check', [
        'validate',
        '--worktree',
        'nope',
      ]),
    /'pan repository-check validate'/u,
  )
})

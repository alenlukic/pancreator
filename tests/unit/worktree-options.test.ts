import assert from 'node:assert/strict'
import test from 'node:test'

import {
  WORKTREE_CAPABLE_SURFACES,
  assertWorktreeOptionSupported,
} from '../../src/cli.js'
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

/**
 * The refusal message names the accepted surfaces from a hand-written list
 * while the refusal itself is derived from the usage text. Nothing reconciled
 * the two, so `pan author apply|validate --worktree` regressed to refused with
 * an error that listed it among the commands that accept the option. Only the
 * positive direction catches that, and only across the whole list.
 */
test('every surface the refusal advertises accepts the shared option', () => {
  const placeholders: Record<string, string> = {
    '<profile>': 'fast',
  }

  for (const surface of WORKTREE_CAPABLE_SURFACES) {
    const tokens = surface
      .split(' ')
      .map((token) => placeholders[token] ?? token)
    const alternatives = (tokens[tokens.length - 1] as string).split('|')

    for (const alternative of alternatives) {
      const invocation = [...tokens.slice(0, -1), alternative]
      const [command, ...rest] = invocation as [string, ...string[]]

      assert.doesNotThrow(
        () =>
          assertWorktreeOptionSupported(command, [
            ...rest,
            '--worktree',
            'named',
          ]),
        `pan ${invocation.join(' ')} --worktree`,
      )
    }
  }
})

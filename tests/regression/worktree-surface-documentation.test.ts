import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { assertWorktreeOptionSupported } from '../../src/cli.js'

const GUIDE = path.join(process.cwd(), 'docs', 'operator-guide.md')

/** The surfaces the refusal itself names, as the operator reads them. */
function refusedSurfaceList(): string[] {
  let message = ''

  try {
    assertWorktreeOptionSupported('list', ['--worktree', 'alpha'])
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }

  const listed = /option: (.*)\.$/u.exec(message)?.[1]

  assert.ok(listed, `the refusal names no surface list: ${message}`)

  return listed.split(', ').flatMap((surface) => {
    const [command, subcommands] = surface.split(' ')

    return subcommands?.includes('|')
      ? subcommands.split('|').map((sub) => `${command} ${sub}`)
      : [surface]
  })
}

// Widening the gate without widening the guide is how the list went stale:
// the refusal tells an operator to consult a document that disagreed with it.
test('the operator guide names every worktree-capable surface', () => {
  const guide = readFileSync(GUIDE, 'utf8')

  for (const surface of refusedSurfaceList()) {
    // The guide may spell an argument the refusal leaves out, as it does
    // for `governance card --mode <mode>`, so match the command prefix.
    const named = new RegExp(
      '`' +
        surface.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`) +
        '[^`]*`',
      'u',
    )

    assert.match(
      guide,
      named,
      `docs/operator-guide.md does not name the worktree surface '${surface}'`,
    )
  }
})

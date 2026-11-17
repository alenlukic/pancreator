import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

test('pan-release command names an existing worktree and does not create one', () => {
  const text = readFileSync(
    path.join(process.cwd(), 'library', 'cursor', 'commands', 'pan-release.md'),
    'utf8',
  )

  assert.match(text, /already exist/u)
  assert.doesNotMatch(text, /create or resolve/u)
})

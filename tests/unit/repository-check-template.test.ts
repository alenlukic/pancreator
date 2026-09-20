import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

test('the shipped self-development profiles declare no concurrent commands', () => {
  // A fresh clone or a CI checkout with no runtime/repository-checks.json
  // falls back to this template and adopts whatever it says without an
  // operator deciding anything. `concurrent` is safe only for commands that
  // share no mutable state, and the full profile's do: `./bin/install --smoke`
  // copies the live dist/ tree without taking the bin/run-built lock that
  // `npm run check` holds while bin/build swaps that same tree. Turning the
  // flag on for an installation stays an operator action against the
  // untracked runtime file.
  const template = JSON.parse(
    readFileSync(
      path.join(
        process.cwd(),
        'library',
        'templates',
        'repository-checks.self-development.json',
      ),
      'utf8',
    ),
  ) as {
    profiles: Record<string, { commands: string[]; concurrent?: unknown }>
  }

  for (const [name, profile] of Object.entries(template.profiles)) {
    assert.equal(
      profile.concurrent,
      undefined,
      `profiles.${name} declares concurrent commands. Prove the commands ` +
        `share no mutable state before shipping that default, or leave the ` +
        `flag to the operator's own runtime/repository-checks.json.`,
    )
  }
})

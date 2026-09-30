/**
 * `bin/check-shell` is the static profile's Bash check: it parses every Bash
 * script under `bin/` and `.githooks/` with the system Bash (3.2 on macOS)
 * and lints them with shellcheck when that tool is installed. `bin/lint`
 * delegates to it, so `npm run lint` and `npm run check` keep one copy of the
 * coverage.
 */
import assert from 'node:assert/strict'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'

const ROOT = process.cwd()
const CHECK_SHELL = path.join(ROOT, 'bin', 'check-shell')

function runCheckShell(
  args: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): SpawnSyncReturns<string> {
  return spawnSync(CHECK_SHELL, args, {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: 60_000,
  })
}

function trackedBashScripts(): string[] {
  return ['bin', '.githooks'].flatMap((directory) =>
    readdirSync(path.join(ROOT, directory))
      .map((name) => path.join(ROOT, directory, name))
      .filter((file) => {
        const first = readFileSync(file, 'utf8').split('\n', 1)[0] ?? ''

        return first.startsWith('#!') && first.includes('bash')
      }),
  )
}

test('bin/check-shell passes every tracked Bash script found by shebang', () => {
  const result = runCheckShell()

  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(result.stderr, /does not parse/u)
  assert.match(
    result.stdout,
    new RegExp(
      `^check-shell: ${trackedBashScripts().length} Bash script\\(s\\) parse under bash `,
      'mu',
    ),
  )
})

test('bin/check-shell fails on a script with a syntax error and names it', () => {
  const directory = createTestTempDirectory('check-shell-')
  const broken = path.join(directory, 'broken')

  writeFileSync(broken, '#!/usr/bin/env bash\nif true; then\n  echo open\n')

  const result = runCheckShell([broken])

  assert.equal(result.status, 1)
  assert.match(result.stderr, /broken does not parse under /u)
  assert.match(result.stderr, /syntax error/u)
  assert.match(result.stderr, /^check-shell: FAILED: 1 problem\(s\)/mu)
  assert.equal(result.stdout, '')
})

test('bin/check-shell notes a missing shellcheck once and still parses', (t) => {
  if (existsSync('/usr/bin/shellcheck') || existsSync('/bin/shellcheck')) {
    t.skip('shellcheck is installed on the reduced PATH')
    return
  }

  const result = runCheckShell([], { ...process.env, PATH: '/usr/bin:/bin' })
  const notes = result.stderr.match(/shellcheck is not on PATH/gu) ?? []

  assert.equal(result.status, 0, result.stderr)
  assert.equal(notes.length, 1)
  assert.match(result.stdout, /\(shellcheck skipped\)$/mu)
})

test('bin/lint delegates its Bash check to bin/check-shell', () => {
  const lint = readFileSync(path.join(ROOT, 'bin', 'lint'), 'utf8')

  assert.match(lint, /"\$ROOT\/bin\/check-shell"/u)
  assert.doesNotMatch(lint, /bash -n/u)
})

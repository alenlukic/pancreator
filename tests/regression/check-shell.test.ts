/**
 * `bin/check-shell` is the static profile's Bash check: it parses every Bash
 * script under `bin/` and `.githooks/` with the system Bash (3.2 on macOS)
 * and lints them with shellcheck when that tool is installed. `bin/lint`
 * delegates to it, so `npm run lint` and `npm run check` keep one copy of the
 * coverage.
 */
import assert from 'node:assert/strict'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'

const ROOT = process.cwd()
const CHECK_SHELL = path.join(ROOT, 'bin', 'check-shell')

function runCheckShell(
  args: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
  script = CHECK_SHELL,
): SpawnSyncReturns<string> {
  return spawnSync(script, args, {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: 60_000,
  })
}

/**
 * Two valid Bash scripts in a temporary directory. The static gate already
 * sweeps every tracked script through `npm run lint`, so these tests run on
 * this fixture and stay independent of the repository's script count.
 */
function validScripts(directory: string): string[] {
  const scripts = [
    path.join(directory, 'first'),
    path.join(directory, 'second'),
  ]

  for (const script of scripts) {
    writeFileSync(script, '#!/usr/bin/env bash\nset -euo pipefail\necho ok\n')
  }

  return scripts
}

test('bin/check-shell finds Bash scripts under bin/ and .githooks/ by shebang', () => {
  // The script finds its root from its own location, so a copy in a fixture
  // tree sweeps only that tree: itself, one bin/ script, and one hook.
  const root = createTestTempDirectory('check-shell-root-')
  const copy = path.join(root, 'bin', 'check-shell')

  mkdirSync(path.join(root, 'bin'))
  mkdirSync(path.join(root, '.githooks'))
  copyFileSync(CHECK_SHELL, copy)
  chmodSync(copy, 0o755)
  writeFileSync(
    path.join(root, 'bin', 'tool'),
    '#!/usr/bin/env bash\necho ok\n',
  )
  writeFileSync(path.join(root, '.githooks', 'pre-commit'), '#!/bin/bash\n:\n')
  writeFileSync(path.join(root, 'bin', 'note'), 'not a script\n')
  writeFileSync(path.join(root, 'bin', 'posix'), '#!/bin/sh\nif then\n')

  const result = runCheckShell([], process.env, copy)

  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(result.stderr, /does not parse/u)
  assert.match(
    result.stdout,
    /^check-shell: 3 Bash script\(s\) parse under bash /mu,
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

  const scripts = validScripts(createTestTempDirectory('check-shell-'))
  const result = runCheckShell(scripts, {
    ...process.env,
    PATH: '/usr/bin:/bin',
  })
  const notes = result.stderr.match(/shellcheck is not on PATH/gu) ?? []

  assert.equal(result.status, 0, result.stderr)
  assert.equal(notes.length, 1)
  assert.match(
    result.stdout,
    /^check-shell: 2 Bash script\(s\) parse under bash .*\(shellcheck skipped\)$/mu,
  )
})

test('bin/lint delegates its Bash check to bin/check-shell', () => {
  const lint = readFileSync(path.join(ROOT, 'bin', 'lint'), 'utf8')

  assert.match(lint, /"\$ROOT\/bin\/check-shell"/u)
  assert.doesNotMatch(lint, /bash -n/u)
})

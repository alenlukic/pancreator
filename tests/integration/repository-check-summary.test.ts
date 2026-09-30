/**
 * A bare `pan repository-check <profile>` prints a pass line or the failing
 * command with its failing tests and the log path, and never the suite's own
 * output; `--verbose` streams it again, and `--json` keeps the structured
 * result with the log path and the parsed failing tests added.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { CHECK_LOG_DIRECTORY } from '../../src/lib/check-output.js'
import { createFixture, writeJson } from '../helpers.js'

import { CLI } from './worktree-helpers.js'

// The printed markers are concatenated at run time, so only the command's
// output can carry them; the start line echoes the command text itself.
const FAILING_SUITE =
  `node -e "console.log('noise' + ' line');` +
  ` console.log('not ok - adds numbers (tests/unit/math.test.ts:12)');` +
  ` console.log('    AssertionError: 1 !== 2'); process.exit(1)"`

function fixtureWithProfiles(): string {
  const root = createFixture()

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      fast: {
        probes: [],
        commands: [`node -e "console.log('passing' + ' chatter')"`],
      },
      failing: {
        probes: [],
        commands: [FAILING_SUITE],
      },
    },
  })

  return root
}

function check(root: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const { PAN_VERBOSE: _verbose, ...inherited } = process.env

  return spawnSync(process.execPath, [CLI, 'repository-check', ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...inherited, ...env },
  })
}

function loggedPath(root: string, text: string): string {
  const match = new RegExp(`(${CHECK_LOG_DIRECTORY}/\\S+\\.log)`, 'u').exec(
    text,
  )

  assert.ok(match, `no log path in: ${text}`)
  assert.equal(existsSync(path.join(root, match[1] as string)), true)

  return match[1] as string
}

test('a passing bare check prints one pass line and logs the output', () => {
  const root = fixtureWithProfiles()
  const result = check(root, ['fast'])

  assert.equal(result.status, 0, result.stderr)
  assert.match(
    result.stdout,
    /^\[repository-check:fast\] passed: 1 command in \d+\.\ds \(log: \S+\)\n$/u,
  )
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /passing chatter/u)
  assert.match(result.stderr, /^\[repository-check:fast\] command: node -e/mu)

  const log = readFileSync(
    path.join(root, loggedPath(root, result.stdout)),
    'utf8',
  )

  assert.match(log, /passing chatter/u)
})

test('a failing bare check prints the failing test and the log, and exits 1', () => {
  const root = fixtureWithProfiles()
  const result = check(root, ['failing'])

  assert.equal(result.status, 1)
  assert.doesNotMatch(result.stdout, /noise line/u)
  assert.match(
    result.stdout,
    /^\[repository-check:failing\] FAILED: 1 of 1 command failed in /mu,
  )
  assert.match(result.stdout, /^failed command: node -e .* \(exit 1\)$/mu)
  assert.match(
    result.stdout,
    /^ {4}adds numbers \(tests\/unit\/math\.test\.ts:12\)$/mu,
  )
  assert.match(
    readFileSync(path.join(root, loggedPath(root, result.stdout)), 'utf8'),
    /noise line/u,
  )
})

test('--verbose and PAN_VERBOSE stream command output again', () => {
  const root = fixtureWithProfiles()

  for (const [args, env] of [
    [['fast', '--verbose'], {}],
    [['fast'], { PAN_VERBOSE: '1' }],
  ] as const) {
    const result = check(root, [...args], env)

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stderr, /passing chatter/u)
    assert.match(result.stdout, /^\[repository-check:fast\] passed: /u)
  }
})

test('--json keeps the structured result and adds the log path and failing tests', () => {
  const root = fixtureWithProfiles()
  const result = check(root, ['failing', '--json'])
  const parsed = JSON.parse(result.stdout) as {
    status: string
    results: Array<{ stdout: string }>
    log_path: string
    failing_tests: Array<{
      kind: string
      failing_tests: Array<{ name: string; location: string | null }>
    }>
  }

  assert.equal(result.status, 1)
  assert.equal(parsed.status, 'failed')
  assert.match(parsed.results[0]?.stdout ?? '', /noise line/u)
  assert.equal(loggedPath(root, parsed.log_path), parsed.log_path)
  assert.deepEqual(parsed.failing_tests, [
    {
      kind: 'command',
      command: FAILING_SUITE,
      failing_tests: [
        { name: 'adds numbers', location: 'tests/unit/math.test.ts:12' },
      ],
    },
  ])
})

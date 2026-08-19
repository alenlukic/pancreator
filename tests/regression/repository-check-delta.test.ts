import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  compareRepositoryCheckToBaseline,
  type RepositoryCheckResult,
} from '../../src/lib/repository-checks.js'

// Bounded excerpt of the preserved `be-test-unit` output from audited run
// 63327_Aug-13-0394_5de7203f: pytest-xdist session header, bare node-id
// progress echoes, plain and parametrized PASSED lines (including bracketed
// parameters that contain spaces and one line with interleaved ANSI log
// output), application log noise, the warnings summary, and the final summary.
// Target-identifying names and absolute paths are substituted; line shapes,
// which are what the delta filter is judged on, are unchanged.
const FIXTURE = readFileSync(
  path.join(
    process.cwd(),
    'tests',
    'fixtures',
    'harness-repair',
    'be-test-unit-stdout.txt',
  ),
  'utf8',
)

const WORKSPACE_ROOT =
  '/workspace/.pancreator/runtime/worktrees/operator/my-task'

function checkResult(
  stdout: string,
  status: 'passed' | 'failed',
): RepositoryCheckResult {
  return {
    profile: 'fast',
    status,
    config_path: 'runtime/repository-checks.json',
    workspace_root: WORKSPACE_ROOT,
    timeout_ms: 300_000,
    results: [
      {
        kind: 'command',
        command: 'just exec --customer acme -- just be-test-unit',
        exit_code: status === 'passed' ? 0 : 1,
        signal: null,
        stdout,
        stderr: '',
        passed: status === 'passed',
        timed_out: false,
        duration_ms: 1,
      },
    ],
    total_duration_ms: 1,
    advisories: [],
  }
}

test('preserved xdist output yields an empty delta across two orders', () => {
  const lines = FIXTURE.split('\n')
  const reordered = [...lines].reverse().join('\n')
  const comparison = compareRepositoryCheckToBaseline(
    checkResult(FIXTURE, 'failed'),
    checkResult(reordered, 'failed'),
  )

  assert.equal(comparison.passed, true)
  assert.equal(comparison.delta.new.length, 0)
  assert.equal(comparison.delta.fixed.length, 0)
})

test('preserved pass, progress, and session lines form no identity', () => {
  const comparison = compareRepositoryCheckToBaseline(
    checkResult('', 'passed'),
    checkResult(FIXTURE, 'failed'),
  )
  const diagnostics = (comparison.delta.full?.new ?? comparison.delta.new).map(
    (entry) => entry.diagnostic,
  )

  // The failed command contributes only its synthetic status identity because
  // this preserved transcript contains no genuine pytest failure.
  assert.equal(comparison.passed, false)
  assert.deepEqual(diagnostics, [
    '<status> exit_code=1 signal=null timed_out=false',
  ])

  for (const line of diagnostics) {
    assert.doesNotMatch(line, /^(?:PASSED|XPASS)\b/u, line)
    assert.doesNotMatch(line, /^\S+::.* (?:PASSED|XPASS)\b/u, line)
    assert.doesNotMatch(line, /^[\w./-]+(?:::[\w.-]+)+(?:\[.*\])?$/u, line)
    assert.doesNotMatch(
      line,
      /^(?:platform|plugins:|rootdir:|configfile:|cachedir:|created:|scheduling tests)/u,
      line,
    )
    assert.doesNotMatch(line, /^=+(?: .* =+)?$/u, line)
    assert.doesNotMatch(line, /^-- Docs:/u, line)
  }
})

test('preserved-output gate explanation quotes no pass or formatting line', () => {
  const comparison = compareRepositoryCheckToBaseline(
    checkResult('', 'passed'),
    checkResult(FIXTURE, 'failed'),
  )

  assert.doesNotMatch(comparison.explanation, /PASSED/u)
  assert.doesNotMatch(comparison.explanation, /-- Docs:/u)
  assert.doesNotMatch(comparison.explanation, /test session starts/u)
})

test('pytest diagnostics keep genuine failures and drop application logs', () => {
  const failure =
    'FAILED tests/unit/test_example.py::test_value - AssertionError: mismatch'
  const comparison = compareRepositoryCheckToBaseline(
    checkResult('', 'passed'),
    checkResult(`${FIXTURE}\n${failure}\n`, 'failed'),
  )
  const diagnostics = (comparison.delta.full?.new ?? comparison.delta.new).map(
    (entry) => entry.diagnostic,
  )

  assert.ok(diagnostics.includes(failure))
  assert.ok(diagnostics.some((line) => line.startsWith('<status>')))
  assert.ok(diagnostics.every((line) => !line.includes('Statsig')))
  assert.match(comparison.explanation, /AssertionError: mismatch/u)
})

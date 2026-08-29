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

const WORKSPACE_ROOT = '/workspace/.pancreator/worktrees/operator/my-task'

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

function newDiagnostics(
  comparison: ReturnType<typeof compareRepositoryCheckToBaseline>,
): string[] {
  return (comparison.delta.full?.new ?? comparison.delta.new).map(
    (entry) => entry.diagnostic,
  )
}

test('preserved xdist output yields an empty delta across two orders', () => {
  const lines = FIXTURE.split('\n')
  const reordered = [...lines].reverse().join('\n')
  const reorderedComparison = compareRepositoryCheckToBaseline(
    checkResult(FIXTURE, 'failed'),
    checkResult(reordered, 'failed'),
  )

  assert.equal(reorderedComparison.passed, true)
  assert.equal(reorderedComparison.delta.new.length, 0)
  assert.equal(reorderedComparison.delta.fixed.length, 0)

  // This transcript holds no genuine failure, so the synthetic status line is
  // the only new identity.
  const comparison = compareRepositoryCheckToBaseline(
    checkResult('', 'passed'),
    checkResult(FIXTURE, 'failed'),
  )
  const diagnostics = newDiagnostics(comparison)

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

  assert.doesNotMatch(comparison.explanation, /PASSED/u)
  assert.doesNotMatch(comparison.explanation, /-- Docs:/u)
  assert.doesNotMatch(comparison.explanation, /test session starts/u)

  const failure =
    'FAILED tests/unit/test_example.py::test_value - AssertionError: mismatch'
  const withFailure = compareRepositoryCheckToBaseline(
    checkResult('', 'passed'),
    checkResult(`${FIXTURE}\n${failure}\n`, 'failed'),
  )
  const failureDiagnostics = newDiagnostics(withFailure)

  assert.ok(failureDiagnostics.includes(failure))
  assert.ok(failureDiagnostics.some((line) => line.startsWith('<status>')))
  assert.ok(failureDiagnostics.every((line) => !line.includes('Statsig')))
  assert.match(withFailure.explanation, /AssertionError: mismatch/u)
})

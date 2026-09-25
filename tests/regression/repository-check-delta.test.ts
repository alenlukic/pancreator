import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  compareRepositoryCheckToBaseline,
  type RepositoryCheckResult,
} from '../../src/lib/repository-checks.js'
import { testScratchRoot } from '../../src/lib/test-scratch.js'
import { createTestTempDirectory } from '../temp.js'

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

// Run 63286_Sep-23-0956 watch-repair: the pre-implementation fast baseline
// carried 139 environment failures whose diagnostic lines embed the per-run
// scratch path (`runtime/tmp/tests.noindex/run-<id>/<fixture>-<id>`) and
// per-session run ids. Unnormalized, every rerun reported each carried
// failure as new, and the baseline comparison could never pass.
test('scratch paths and session ids do not manufacture new diagnostics', () => {
  const before =
    '\nnot ok - a citation resolves through pan status (<workspace>/dist/tests/integration/artifact-finalization.test.js:<line>)\n' +
    "    PanError: Executor preflight failed for 'openai': No .env file exists at " +
    '<workspace>/runtime/tmp/tests.noindex/run-Gl4itHlU/v2-tDTgdX/.env. No OPENAI_API_KEY is available.\n' +
    '    PanError: Best-of-N initialization failed for session 63286_Sep-23-0955_build-depend: Executor preflight failed.\n'
  const after =
    '\nnot ok - a citation resolves through pan status (<workspace>/dist/tests/integration/artifact-finalization.test.js:<line>)\n' +
    "    PanError: Executor preflight failed for 'openai': No .env file exists at " +
    '<workspace>/runtime/tmp/tests.noindex/run-9xQ2mABc/v2-ZzYwVu/.env. No OPENAI_API_KEY is available.\n' +
    '    PanError: Best-of-N initialization failed for session 63286_Sep-23-0855_build-depend: Executor preflight failed.\n'

  const comparison = compareRepositoryCheckToBaseline(
    checkResult(before, 'failed'),
    checkResult(after, 'failed'),
  )

  assert.equal(comparison.passed, true)
  assert.deepEqual(newDiagnostics(comparison), [])

  // A genuinely new failure line still surfaces through the same transcript.
  const genuine = compareRepositoryCheckToBaseline(
    checkResult(before, 'failed'),
    checkResult(
      `${after}\nnot ok - a brand-new regression (dist/tests/integration/x.test.js:1)\n`,
      'failed',
    ),
  )

  assert.equal(genuine.passed, false)
  assert.ok(
    newDiagnostics(genuine).some((line) =>
      line.includes('a brand-new regression'),
    ),
  )
})

// config.json test_scratch.root moves fixtures outside the workspace, into a
// per-checkout child whose path differs for every worktree. A baseline taken
// under the default location must still match a rerun under the moved one.
test('a configured external scratch root folds to the default scratch identity', () => {
  const baselineWorkspace = createTestTempDirectory('pancreator-delta-base-')
  const movedWorkspace = createTestTempDirectory('pancreator-delta-moved-')
  const base = createTestTempDirectory('pancreator-delta-scratch-')

  writeFileSync(
    path.join(movedWorkspace, 'config.json'),
    JSON.stringify({ schema_version: 1, test_scratch: { root: base } }),
  )

  const failure = (scratch: string, run: string): string =>
    `not ok - preflight reads ${scratch}/${run}/v2-fixture/.env\n`
  const baseline = {
    ...checkResult(
      failure(
        path.join(baselineWorkspace, 'runtime', 'tmp', 'tests.noindex'),
        'run-Gl4itHlU',
      ),
      'failed',
    ),
    workspace_root: baselineWorkspace,
  }
  const moved = {
    ...checkResult(
      failure(testScratchRoot(movedWorkspace), 'run-9xQ2mABc'),
      'failed',
    ),
    workspace_root: movedWorkspace,
  }

  const comparison = compareRepositoryCheckToBaseline(baseline, moved)

  assert.equal(comparison.passed, true, comparison.explanation)
  assert.deepEqual(newDiagnostics(comparison), [])
})

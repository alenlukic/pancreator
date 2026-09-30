import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  adoptedBaselineWorkspaceDivergence,
  compareRepositoryCheckToBaseline,
  SUMMARY_STREAM_HEAD_BYTES,
  SUMMARY_STREAM_TAIL_BYTES,
} from '../../src/lib/repository-checks.js'
import type { RepositoryCheckResult } from '../../src/lib/repository-checks.js'
import { loadRepositoryCheckBaseline } from '../../src/lib/validation.js'
import type {
  RepositoryCheckBaselinePointer,
  RunState,
} from '../../src/lib/types.js'
import { createTestTempDirectory } from '../helpers.js'

test('an elided baseline loads its full result before comparison', () => {
  const root = createTestTempDirectory('elided-check-')
  const artifactDirectory = 'runtime/logs/workflows/run-1/agent/artifacts/json'
  const summaryPath = `${artifactDirectory}/baseline-static.json`
  const fullPath = `${artifactDirectory}/baseline-static.full.json`

  const count = Math.ceil(
    (SUMMARY_STREAM_HEAD_BYTES + SUMMARY_STREAM_TAIL_BYTES) / 24,
  )
  const diagnostics = Array.from(
    { length: count },
    (_, index) => `stable diagnostic ${index}`,
  )

  const check = (stderr: string): RepositoryCheckResult => ({
    profile: 'static',
    status: 'failed',
    config_path: 'runtime/repository-checks.json',
    workspace_root: '.',
    timeout_ms: 60_000,
    results: [
      {
        kind: 'command',
        command: 'node -e "..."',
        exit_code: 1,
        signal: null,
        stdout: '',
        stderr,
        passed: false,
        timed_out: false,
        duration_ms: 1,
      },
    ],
    total_duration_ms: 1,
    advisories: [],
  })
  const artifact = (result: RepositoryCheckResult, full?: string) => ({
    schema_version: 1,
    run_id: 'run-1',
    stage: 'implement',
    profile: 'static',
    workspace_fingerprint: 'fixture',
    recorded_at: '2026-08-24T00:00:00.000Z',
    result,
    ...(full ? { full_result_path: full } : {}),
  })

  mkdirSync(path.join(root, artifactDirectory), { recursive: true })
  writeFileSync(
    path.join(root, summaryPath),
    `${JSON.stringify(
      artifact(
        check('…[bytes elided; see the full result artifact]…\n'),
        fullPath,
      ),
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    path.join(root, fullPath),
    `${JSON.stringify(artifact(check(`${diagnostics.join('\n')}\n`)), null, 2)}\n`,
  )

  const state = {
    repository_check_baselines: {
      static: {
        profile: 'static',
        status: 'failed',
        artifact_path: summaryPath,
        workspace_fingerprint: 'fixture',
        recorded_at: '2026-08-24T00:00:00.000Z',
      },
    },
  } as unknown as RunState
  const baseline = loadRepositoryCheckBaseline(root, state, 'static')

  assert.ok(baseline.result)
  assert.equal(baseline.artifact_path, fullPath)

  const compared = compareRepositoryCheckToBaseline(
    baseline.result,
    check(`stable diagnostic ${Math.floor(count / 2)}\n`),
  )

  assert.equal(compared.passed, true)
  assert.equal(compared.delta.new.length, 0)
  assert.equal(compared.delta.carried.length, 1)
})

function failedCheck(
  stderr: string,
  workspaceRoot = '/workspace',
  overrides: Partial<RepositoryCheckResult['results'][number]> = {},
): RepositoryCheckResult {
  return {
    profile: 'static',
    status: 'failed',
    config_path: '/harness/runtime/repository-checks.json',
    workspace_root: workspaceRoot,
    timeout_ms: 60_000,
    results: [
      {
        kind: 'command',
        command: 'npm run lint',
        exit_code: 1,
        signal: null,
        stdout: '',
        stderr,
        passed: false,
        timed_out: false,
        duration_ms: 1,
        ...overrides,
      },
    ],
    total_duration_ms: 1,
    advisories: [],
  }
}

function passedCheck(): RepositoryCheckResult {
  return {
    profile: 'static',
    status: 'passed',
    config_path: '/harness/runtime/repository-checks.json',
    workspace_root: '/workspace',
    timeout_ms: 60_000,
    results: [
      {
        kind: 'command',
        command: 'npm run lint',
        exit_code: 0,
        signal: null,
        stdout: '',
        stderr: '',
        passed: true,
        timed_out: false,
        duration_ms: 1,
      },
    ],
    total_duration_ms: 1,
    advisories: [],
  }
}

test('baseline delta ignores xdist scheduling and passing test output', () => {
  const baseline = failedCheck(
    '[gw0] [ 50%] PASSED tests/example_test.py::test_ok\n' +
      '/workspace/src/a.ts:10:2 error Unexpected value no-example\n',
  )
  const current = failedCheck(
    '[gw3] [ 75%] PASSED tests/example_test.py::test_ok\n' +
      '/workspace/src/a.ts:40:9 error Unexpected value no-example\n',
  )

  const comparison = compareRepositoryCheckToBaseline(baseline, current)

  assert.equal(comparison.passed, true)
  assert.equal(comparison.delta.new.length, 0)
})

test('gate explanations do not quote passing-output churn', () => {
  const comparison = compareRepositoryCheckToBaseline(
    passedCheck(),
    failedCheck('tests/example_test.py::test_ok PASSED\n'),
  )

  assert.match(comparison.explanation, /no genuine failure identity/u)
  assert.doesNotMatch(comparison.explanation, /PASSED/u)
})

// A cohort shares one baseline across chunk runs that each own a different
// worktree, so a host failure of the capturing tree used to read as a
// regression the adopting chunk had introduced, and the chunk spent its next
// stage hunting a change that never happened.
test('a baseline from another workspace diagnoses a new failure instead of attributing it', () => {
  const newFailure = '/workspace/src/b.ts:3:1 error New failure no-new\n'
  // Only an adopted baseline spans two trees, and only the pointer knows it
  // was adopted, so the caller resolves the divergence and hands it in.
  const pointer: RepositoryCheckBaselinePointer = {
    profile: 'static',
    status: 'passed',
    artifact_path: 'runtime/logs/cohorts/c/baselines/pre-implementation.json',
    workspace_fingerprint: 'f',
    recorded_at: '2026-09-13T00:00:00.000Z',
    shared_from_cohort: 'cohort-fixture',
    capture_workspace_path: 'worktrees/operator/chunk-a',
  }
  const divergence = adoptedBaselineWorkspaceDivergence(
    pointer,
    'worktrees/operator/chunk-b',
  )

  assert.deepEqual(divergence, {
    baseline_workspace: 'worktrees/operator/chunk-a',
    current_workspace: 'worktrees/operator/chunk-b',
  })
  // The same chunk path, a baseline this run captured itself, and a pointer
  // written before the capture path existed each report no divergence, so
  // every run outside a shared adoption is graded exactly as it was.
  assert.equal(
    adoptedBaselineWorkspaceDivergence(pointer, 'worktrees/operator/chunk-a'),
    null,
  )
  assert.equal(
    adoptedBaselineWorkspaceDivergence(
      { ...pointer, shared_from_cohort: undefined },
      'worktrees/operator/chunk-b',
    ),
    null,
  )
  assert.equal(
    adoptedBaselineWorkspaceDivergence(
      { ...pointer, capture_workspace_path: undefined },
      'worktrees/operator/chunk-b',
    ),
    null,
  )
  assert.equal(adoptedBaselineWorkspaceDivergence(undefined, '.'), null)

  // The gate reads the baseline through the loader, so the loader is where
  // the pointer's capture path has to reach the comparison.
  const root = createTestTempDirectory('adopted-baseline-')
  const artifactPath =
    'runtime/logs/cohorts/c/baselines/pre-implementation-static.json'

  mkdirSync(path.dirname(path.join(root, artifactPath)), { recursive: true })
  writeFileSync(
    path.join(root, artifactPath),
    `${JSON.stringify({
      schema_version: 1,
      run_id: 'chunk-a-run',
      stage: 'implement',
      profile: 'static',
      workspace_fingerprint: 'f',
      recorded_at: pointer.recorded_at,
      capture_workspace_path: 'worktrees/operator/chunk-a',
      result: passedCheck(),
    })}\n`,
  )

  const adoptingRun = {
    workspace_root: 'worktrees/operator/chunk-b',
    repository_check_baselines: {
      static: { ...pointer, artifact_path: artifactPath },
    },
  } as unknown as RunState

  assert.deepEqual(
    loadRepositoryCheckBaseline(root, adoptingRun, 'static')
      .workspace_divergence,
    divergence,
  )

  const divergent = compareRepositoryCheckToBaseline(
    passedCheck(),
    failedCheck(newFailure),
    divergence,
  )

  assert.deepEqual(divergent.delta.baseline_workspace_divergence, divergence)
  // The explanation names the two trees and sends the reader to the one that
  // can settle the question, instead of attributing the failure to a change
  // this run may not have made.
  assert.doesNotMatch(divergent.explanation, /introduced a new failure/u)
  assert.match(divergent.explanation, /may belong to the capturing workspace/u)
  assert.match(
    divergent.explanation,
    /captured in 'worktrees\/operator\/chunk-a'/u,
  )
  assert.match(
    divergent.explanation,
    /executed in 'worktrees\/operator\/chunk-b'/u,
  )
  // The diagnostic is still unexplained, so the gate still fails; only the
  // attribution changes.
  assert.equal(divergent.passed, false)
  assert.equal(
    divergent.delta.new.some((item) => item.diagnostic.includes('no-new')),
    true,
  )

  // One workspace on both sides attributes the failure as it always did.
  const sameWorkspace = compareRepositoryCheckToBaseline(
    passedCheck(),
    failedCheck(newFailure),
  )

  assert.equal(sameWorkspace.delta.baseline_workspace_divergence, undefined)
  assert.match(sameWorkspace.explanation, /introduced a new failure/u)

  // Divergence alone decides nothing: a run that adds no diagnostic still
  // passes, and the marker only records where the two sides ran.
  const clean = compareRepositoryCheckToBaseline(
    passedCheck(),
    passedCheck(),
    divergence,
  )

  assert.equal(clean.passed, true)
  assert.deepEqual(clean.delta.baseline_workspace_divergence, divergence)
})

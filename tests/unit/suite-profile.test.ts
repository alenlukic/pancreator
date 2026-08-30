import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import type { SpawnSyncReturns } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  buildSuiteProfileSummary,
  loadSuiteProfile,
  renderSuiteProfileSection,
  renderSuiteProfileStatusLine,
  TEST_PROFILE_ENV,
} from '../../src/lib/suite-profile.js'
import { renderStatus } from '../../src/lib/render.js'
import type { RunState, SuiteProfileSummary } from '../../src/lib/types.js'

const REPORTER = path.resolve(
  process.cwd(),
  'dist/tests/reporters/failures-only.js',
)

function tinyLane(): { cwd: string; file: string } {
  const cwd = mkdtempSync(path.join(tmpdir(), 'pancreator-suite-profile-'))
  const laneDir = path.join(cwd, 'tests', 'unit')

  mkdirSync(laneDir, { recursive: true })

  const file = path.join(laneDir, 'tiny.test.js')

  writeFileSync(
    file,
    [
      "const test = require('node:test');",
      "test('alpha', () => {});",
      "test('beta', () => {});",
      '',
    ].join('\n'),
  )

  return { cwd, file }
}

/** The parent runs under node --test; the child must not inherit that context. */
function childEnv(env: Record<string, string>): NodeJS.ProcessEnv {
  const { NODE_TEST_CONTEXT: _context, ...rest } = process.env

  return { ...rest, ...env }
}

function runReporter(
  cwd: string,
  file: string,
  env: Record<string, string>,
): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    [
      '--test',
      `--test-reporter=${REPORTER}`,
      '--test-reporter-destination=stdout',
      file,
    ],
    { cwd, encoding: 'utf8', env: childEnv(env) },
  )
}

test('the reporter writes a suite profile only when PAN_TEST_PROFILE is set', () => {
  const { cwd, file } = tinyLane()
  const target = path.join(cwd, 'out', 'profile.json')

  const unset = runReporter(cwd, file, { [TEST_PROFILE_ENV]: '' })

  assert.equal(unset.status, 0, unset.stderr)
  assert.match(unset.stdout, /^# pass 2$/mu)
  assert.equal(existsSync(target), false)
  assert.equal(existsSync(path.join(cwd, 'out')), false)

  const set = runReporter(cwd, file, { [TEST_PROFILE_ENV]: target })

  assert.equal(set.status, 0, set.stderr)
  // The printed output is unchanged apart from the measured duration.
  const withoutDuration = (text: string): string =>
    text.replace(/^# duration_ms .*$/mu, '')

  assert.equal(withoutDuration(set.stdout), withoutDuration(unset.stdout))

  const profile = loadSuiteProfile(cwd, 'out/profile.json')

  assert.ok(profile)
  assert.equal(profile.lane, 'unit')
  assert.equal(profile.test_count, 2)
  assert.equal(profile.pass_count, 2)
  assert.equal(profile.fail_count, 0)
  assert.ok(profile.wall_clock_ms > 0)
  assert.equal(profile.files.length, 1)
  assert.equal(profile.files[0].file, 'tests/unit/tiny.test.js')
  assert.equal(profile.files[0].test_count, 2)
  assert.deepEqual(profile.slowest_tests.map((entry) => entry.name).sort(), [
    'alpha',
    'beta',
  ])
})

function runState(
  runId: string,
  profilePath: string | null,
  status: RunState['status'] = 'running',
): RunState {
  return {
    schema_version: 1,
    run_id: runId,
    workflow_slug: 'delivery',
    workflow_snapshot: { path: 'workflow.json', sha256: 'abc' },
    workspace_root: '.',
    title: 'Run',
    status,
    current_stage: 'ship',
    pending_action: { type: 'none' },
    current_invocation: null,
    request: { source_path: 'request.md', stored_path: 'r.md', sha256: 'a' },
    revision: 1,
    transition_count: 1,
    consecutive_failures: 0,
    attempts: {},
    stage_history: [
      {
        stage: 'verify',
        attempt: 1,
        invocation_id: `verify-1-${runId}`,
        output_path: `runtime/logs/workflows/${runId}/outputs/verify-1.json`,
        outcome: 'success',
        submitted_at: '2026-08-29T00:00:00.000Z',
        workspace_fingerprint: 'fp',
        validation_errors: [],
        deterministic: [
          {
            id: 'verify.full_suite',
            type: 'shell',
            hard: true,
            passed: true,
            command: 'pan repository-check full',
            workspace_fingerprint: 'fp',
            ...(profilePath ? { suite_profile_path: profilePath } : {}),
          },
        ],
      },
    ],
    created_at: '2026-08-29T00:00:00.000Z',
    updated_at: `2026-08-29T00:00:0${runId.length % 10}.000Z`,
    limits: {
      max_total_transitions: 18,
      max_stage_attempts: 3,
      max_consecutive_failures: 3,
    },
  } as unknown as RunState
}

function writeProfile(
  root: string,
  relative: string,
  testCount: number,
  wallClockMs: number,
): void {
  const absolute = path.join(root, relative)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(
    absolute,
    JSON.stringify({
      schema_version: 1,
      lane: 'unit+integration',
      recorded_at: '2026-08-29T00:00:00.000Z',
      test_count: testCount,
      pass_count: testCount,
      fail_count: 0,
      wall_clock_ms: wallClockMs,
      files: [
        {
          file: 'tests/unit/slow.test.ts',
          duration_ms: 900,
          test_count: 3,
          pass_count: 3,
          fail_count: 0,
        },
        {
          file: 'tests/unit/fast.test.ts',
          duration_ms: 100,
          test_count: 1,
          pass_count: 1,
          fail_count: 0,
        },
      ],
      slowest_tests: [
        { file: 'tests/unit/slow.test.ts', name: 'slowest', duration_ms: 700 },
      ],
    }),
  )
}

function writeRunState(root: string, state: RunState): void {
  const target = path.join(
    root,
    'runtime/logs/workflows',
    state.run_id,
    'agent',
    'state.json',
  )

  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(state))
}

test('the ship card section renders the profile with and without a prior succeeded run', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pancreator-suite-summary-'))
  const currentPath =
    'runtime/logs/workflows/run-b/agent/evidence/verify-1-run-b-suite-profile.json'

  writeProfile(root, currentPath, 12, 4200)

  const current = runState('run-b', currentPath)

  // No artifact recorded: no section.
  assert.equal(buildSuiteProfileSummary(root, runState('run-c', null)), null)

  const alone = buildSuiteProfileSummary(root, current)

  assert.ok(alone)
  assert.equal(alone.previous, undefined)
  assert.equal(alone.test_count, 12)
  assert.equal(alone.slowest_files[0]?.file, 'tests/unit/slow.test.ts')

  const aloneSection = renderSuiteProfileSection(alone).join('\n')

  assert.match(aloneSection, /## 📈 Suite profile/u)
  assert.match(aloneSection, /Tests: 12 \(12 passed, 0 failed\)/u)
  assert.match(aloneSection, /Wall clock: 4\.2s/u)
  assert.match(aloneSection, /Delta: none\./u)
  assert.match(
    aloneSection,
    /slowest \(`tests\/unit\/slow\.test\.ts`\) — 0\.7s/u,
  )

  // A prior succeeded run in the same workspace supplies the delta. A failed
  // run and a run in another workspace do not.
  const priorPath =
    'runtime/logs/workflows/run-a/agent/evidence/verify-1-run-a-suite-profile.json'
  writeProfile(root, priorPath, 10, 3000)
  writeRunState(root, runState('run-a', priorPath, 'succeeded'))

  const failedPath =
    'runtime/logs/workflows/run-f/agent/evidence/verify-1-run-f-suite-profile.json'
  writeProfile(root, failedPath, 99, 99_000)
  writeRunState(root, runState('run-f', failedPath, 'failed'))

  const elsewherePath =
    'runtime/logs/workflows/run-w/agent/evidence/verify-1-run-w-suite-profile.json'
  writeProfile(root, elsewherePath, 1, 1)
  writeRunState(root, {
    ...runState('run-w', elsewherePath, 'succeeded'),
    workspace_root: 'worktrees/other',
  })

  const compared = buildSuiteProfileSummary(root, current)

  assert.ok(compared?.previous)
  assert.equal(compared.previous.run_id, 'run-a')
  assert.equal(compared.previous.test_count_delta, 2)
  assert.equal(compared.previous.wall_clock_ms_delta, 1200)

  const section = renderSuiteProfileSection(compared).join('\n')

  assert.match(
    section,
    /Delta against run `run-a`.*\+2 tests, \+1\.2s wall clock/u,
  )

  const line = renderSuiteProfileStatusLine(compared)

  assert.match(
    line,
    /^Suite profile: 12 tests in 4\.2s at verify gate verify\.full_suite \(\+2 tests, \+1\.2s vs run run-a\)$/u,
  )

  const status = renderStatus(current, null, compared)

  assert.ok(status.includes(line))
  assert.ok(!renderStatus(current, null, null).includes('Suite profile:'))
})

test('a cached gate summary names the cached pass', () => {
  const summary: SuiteProfileSummary = {
    profile_path: 'runtime/logs/workflows/run-x/agent/evidence/p.json',
    gate_id: 'verify.full_suite',
    stage: 'verify',
    cached: true,
    lane: 'unit',
    test_count: 1,
    pass_count: 1,
    fail_count: 0,
    wall_clock_ms: 500,
    slowest_files: [],
    slowest_tests: [],
  }

  const section = renderSuiteProfileSection(summary).join('\n')

  assert.match(section, /cached pass; profile of the original execution/u)
  assert.match(section, /The profile lists no files\./u)
  assert.match(renderSuiteProfileStatusLine(summary), /, cached \(no previous/u)
})

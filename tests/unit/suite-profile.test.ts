import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  SUITE_PROFILE_INDEX_PATH,
  buildSuiteProfileSummary,
  lookupPreviousSucceededRunProfile,
  previousSucceededRunProfileByScan,
  recordSuiteProfileIndexEntry,
  renderSuiteProfileSection,
  renderSuiteProfileStatusLine,
} from '../../src/lib/suite-profile.js'
import { renderStatus } from '../../src/lib/render.js'
import type { RunState, SuiteProfileSummary } from '../../src/lib/types.js'
import {
  fixtureSidecarDirectory,
  TEST_SCRATCH_ENV,
} from '../../src/lib/suite-profile-env.js'
import { readFixtureCost } from '../reporters/failures-only.js'
import { fixtureSidecarPath } from '../reporters/fixture-profile.js'
import { createTestTempDirectory } from '../temp.js'

test('the reporter consumes process-specific fixture sidecars once', () => {
  const cwd = createTestTempDirectory('pancreator-fixture-cost-')
  const target = path.join(cwd, 'out', 'profile.json')
  const first = fixtureSidecarPath(target, 101)
  const second = fixtureSidecarPath(target, 202)

  assert.notEqual(first, second)

  mkdirSync(path.dirname(first), { recursive: true })
  writeFileSync(
    first,
    JSON.stringify({
      events: [
        {
          kind: 'template_build',
          duration_ms: 4,
          template_bytes: 1024,
          template_files: 12,
        },
        { kind: 'template_clone', duration_ms: 2 },
        { kind: 'run_prepare', duration_ms: 7 },
      ],
    }),
  )
  writeFileSync(
    second,
    JSON.stringify({
      events: [
        {
          kind: 'template_build',
          duration_ms: 6,
          template_bytes: 1024,
          template_files: 12,
        },
        { kind: 'template_clone', duration_ms: 3 },
        { kind: 'run_prepare', duration_ms: 11 },
      ],
    }),
  )

  assert.deepEqual(readFixtureCost(target), {
    template_ms: 10,
    clone_ms: 5,
    prepare_ms: 18,
    template_bytes: 1024,
    template_files: 12,
  })
  assert.equal(existsSync(first), false)
  assert.equal(existsSync(second), false)

  const next = fixtureSidecarPath(target, 303)
  writeFileSync(
    next,
    JSON.stringify({
      events: [
        {
          kind: 'template_build',
          duration_ms: 1,
          template_bytes: 2048,
          template_files: 20,
        },
        { kind: 'template_clone', duration_ms: 1 },
        { kind: 'run_prepare', duration_ms: 2 },
      ],
    }),
  )

  assert.deepEqual(readFixtureCost(target), {
    template_ms: 1,
    clone_ms: 1,
    prepare_ms: 2,
    template_bytes: 2048,
    template_files: 20,
  })
  assert.equal(existsSync(next), false)
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
  recordedAt = '2026-08-29T00:00:00.000Z',
): void {
  const absolute = path.join(root, relative)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(
    absolute,
    JSON.stringify({
      schema_version: 1,
      lane: 'unit+integration',
      recorded_at: recordedAt,
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
  const root = createTestTempDirectory('pancreator-suite-summary-')
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

function evidenceProfilePath(runId: string): string {
  return `runtime/logs/workflows/${runId}/agent/evidence/verify-1-${runId}-suite-profile.json`
}

function succeededRun(
  root: string,
  runId: string,
  updatedAt: string,
  testCount = 10,
  wallClockMs = 3000,
  profileRecordedAt = '2026-08-29T00:00:00.000Z',
): RunState {
  const profilePath = evidenceProfilePath(runId)

  writeProfile(root, profilePath, testCount, wallClockMs, profileRecordedAt)

  const state = {
    ...runState(runId, profilePath, 'succeeded'),
    updated_at: updatedAt,
  }

  writeRunState(root, state)

  return state
}

test('the ship-card profile lookup costs the same however many runs are retained', () => {
  const root = createTestTempDirectory('pancreator-suite-index-')
  const currentPath = evidenceProfilePath('run-now')

  writeProfile(root, currentPath, 12, 4200)

  const current = {
    ...runState('run-now', currentPath),
    updated_at: '2026-08-30T00:00:00.000Z',
  }

  recordSuiteProfileIndexEntry(
    root,
    succeededRun(root, 'run-prior', '2026-08-29T00:00:00.000Z'),
  )

  const small = lookupPreviousSucceededRunProfile(root, current)

  assert.equal(small.source, 'index')
  assert.equal(small.file_reads, 2)
  assert.equal(small.value?.run_id, 'run-prior')

  for (let index = 0; index < 20; index += 1) {
    succeededRun(
      root,
      `run-old-${index}`,
      `2026-08-28T00:00:${String(index).padStart(2, '0')}.000Z`,
      5,
      1000,
    )
  }

  const large = lookupPreviousSucceededRunProfile(root, current)

  assert.equal(large.source, 'index')
  assert.equal(large.file_reads, small.file_reads)
  assert.equal(large.value?.run_id, 'run-prior')

  // The bound is worth having only because the scan it replaces is not
  // bounded: the same lookup by scan pays for every retained run.
  assert.ok(
    previousSucceededRunProfileByScan(root, current).file_reads >
      large.file_reads,
  )

  // The card the operator reads must not depend on which path answered.
  const indexed = buildSuiteProfileSummary(root, current)

  rmSync(path.join(root, SUITE_PROFILE_INDEX_PATH))

  const scanned = buildSuiteProfileSummary(root, current)

  assert.ok(indexed)
  assert.ok(scanned)
  assert.deepEqual(indexed.previous, scanned.previous)
  assert.equal(
    renderSuiteProfileSection(indexed).join('\n'),
    renderSuiteProfileSection(scanned).join('\n'),
  )
})

test('a missing suite-profile index falls back to the scan and rebuilds itself', () => {
  const root = createTestTempDirectory('pancreator-suite-index-rebuild-')
  const currentPath = evidenceProfilePath('run-now')

  writeProfile(root, currentPath, 12, 4200)

  const current = {
    ...runState('run-now', currentPath),
    updated_at: '2026-08-30T00:00:00.000Z',
  }

  succeededRun(root, 'run-prior', '2026-08-29T00:00:00.000Z')

  const indexPath = path.join(root, SUITE_PROFILE_INDEX_PATH)

  assert.equal(existsSync(indexPath), false)

  const first = lookupPreviousSucceededRunProfile(root, current)

  assert.equal(first.source, 'scan')
  assert.equal(first.value?.run_id, 'run-prior')
  assert.equal(existsSync(indexPath), true)

  const second = lookupPreviousSucceededRunProfile(root, current)

  assert.equal(second.source, 'index')
  assert.deepEqual(second.value, first.value)
})

test('success and scan writers index the profile artifact timestamp', () => {
  const root = createTestTempDirectory('pancreator-suite-index-time-')
  const profileRecordedAt = '2026-08-29T01:02:03.000Z'
  const prior = succeededRun(
    root,
    'run-prior',
    '2026-08-29T05:00:00.000Z',
    10,
    3000,
    profileRecordedAt,
  )

  // The scan still selects by succeeded-state recency, not profile time.
  succeededRun(
    root,
    'run-older-state',
    '2026-08-29T03:00:00.000Z',
    10,
    3000,
    '2026-08-29T10:00:00.000Z',
  )

  const direct = recordSuiteProfileIndexEntry(root, prior)

  assert.ok(direct)
  assert.equal(direct.recorded_at, profileRecordedAt)

  rmSync(path.join(root, SUITE_PROFILE_INDEX_PATH))

  const currentPath = evidenceProfilePath('run-now')
  const current = {
    ...runState('run-now', currentPath),
    updated_at: '2026-08-30T00:00:00.000Z',
  }

  writeProfile(root, currentPath, 12, 4200)

  const lookup = lookupPreviousSucceededRunProfile(root, current)
  const rebuilt = JSON.parse(
    readFileSync(path.join(root, SUITE_PROFILE_INDEX_PATH), 'utf8'),
  ) as {
    workspaces: Record<
      string,
      { run_id: string; profile_path: string; recorded_at: string }
    >
  }

  assert.equal(lookup.value?.run_id, prior.run_id)
  assert.equal(lookup.value?.recorded_at, profileRecordedAt)
  assert.deepEqual(rebuilt.workspaces['.'], direct)
})

test('a usable current-run index entry stays byte-for-byte unchanged', () => {
  const root = createTestTempDirectory('pancreator-suite-current-index-')
  const currentPath = evidenceProfilePath('run-now')
  const current = {
    ...runState('run-now', currentPath, 'succeeded'),
    updated_at: '2026-08-30T00:00:00.000Z',
  }

  writeProfile(root, currentPath, 12, 4200)
  succeededRun(root, 'run-prior', '2026-08-29T03:04:05.000Z')

  const written = recordSuiteProfileIndexEntry(root, current)
  const indexPath = path.join(root, SUITE_PROFILE_INDEX_PATH)
  const before = readFileSync(indexPath)
  const lookup = lookupPreviousSucceededRunProfile(root, current)
  const after = readFileSync(indexPath)

  assert.equal(written?.recorded_at, '2026-08-29T00:00:00.000Z')
  assert.equal(lookup.source, 'scan')
  assert.equal(lookup.value?.run_id, 'run-prior')
  assert.deepEqual(after, before)
})

test('missing and unreadable indexed profiles rebuild with artifact time', () => {
  for (const failure of ['missing', 'unreadable'] as const) {
    const root = createTestTempDirectory(
      `pancreator-suite-indexed-profile-${failure}-`,
    )
    const currentPath = evidenceProfilePath('run-now')
    const indexed = succeededRun(
      root,
      'run-indexed',
      '2026-08-29T05:00:00.000Z',
    )
    const priorUpdatedAt = '2026-08-29T03:04:05.000Z'
    const priorProfileRecordedAt = '2026-08-29T02:03:04.000Z'

    writeProfile(root, currentPath, 12, 4200)
    recordSuiteProfileIndexEntry(root, indexed)
    succeededRun(
      root,
      'run-prior',
      priorUpdatedAt,
      10,
      3000,
      priorProfileRecordedAt,
    )

    const indexedProfile = path.join(
      root,
      indexed.stage_history[0]?.deterministic[0]?.suite_profile_path ?? '',
    )

    if (failure === 'missing') {
      rmSync(indexedProfile)
    } else {
      writeFileSync(indexedProfile, '{not json', 'utf8')
    }

    const current = {
      ...runState('run-now', currentPath),
      updated_at: '2026-08-30T00:00:00.000Z',
    }
    const lookup = lookupPreviousSucceededRunProfile(root, current)
    const rebuilt = JSON.parse(
      readFileSync(path.join(root, SUITE_PROFILE_INDEX_PATH), 'utf8'),
    ) as {
      workspaces: Record<
        string,
        { run_id: string; profile_path: string; recorded_at: string }
      >
    }

    assert.equal(lookup.source, 'scan')
    assert.equal(lookup.value?.run_id, 'run-prior')
    assert.equal(rebuilt.workspaces['.']?.run_id, 'run-prior')
    assert.equal(rebuilt.workspaces['.']?.recorded_at, priorProfileRecordedAt)
  }
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

test('the verify card shows fast-wall measurements around implementation', () => {
  const section = renderSuiteProfileSection(null, {
    series_path: 'runtime/fast-wall-series.jsonl',
    before: {
      recorded_at: '2026-09-15T01:00:00.000Z',
      wall_clock_ms: 119_000,
      test_count: 1300,
      worker_count: 13,
      phase: 'baseline',
      marginal_wall_ms_per_test: 100,
    },
    after: {
      recorded_at: '2026-09-15T02:00:00.000Z',
      wall_clock_ms: 118_000,
      test_count: 1305,
      worker_count: 13,
      phase: 'implement.unit_tests',
      marginal_wall_ms_per_test: 90.143,
    },
  }).join('\n')

  assert.match(section, /Implement-stage fast wall/u)
  assert.match(
    section,
    /Before implement: 1300 tests in 119\.0s .*100\.000ms marginal per test.*\(phase `baseline`\)/u,
  )
  assert.match(
    section,
    /After implement: 1305 tests in 118\.0s .*90\.143ms marginal per test.*\(phase `implement\.unit_tests`\)/u,
  )
  assert.match(section, /with 13 workers/u)

  // A legacy row carries no summed file time, so its point has no marginal
  // cost and the card says so rather than printing a fabricated zero.
  const withoutMarginal = renderSuiteProfileSection(null, {
    series_path: 'runtime/fast-wall-series.jsonl',
    before: null,
    after: {
      recorded_at: '2026-09-15T02:00:00.000Z',
      wall_clock_ms: 118_000,
      test_count: 1305,
      worker_count: 13,
      phase: 'implement.unit_tests',
      marginal_wall_ms_per_test: null,
    },
  }).join('\n')

  assert.match(withoutMarginal, /Before implement: no fast-lane record\./u)
  assert.match(withoutMarginal, /marginal cost unavailable/u)
})

test('fixture sidecars live in the runner scratch tree, not the profile target', () => {
  const scratch = createTestTempDirectory('pancreator-sidecar-scratch-')
  const target = path.join(
    scratch,
    'runtime',
    'logs',
    'workflows',
    'run-one',
    'agent',
    'evidence',
    'suite-profile.json',
  )
  const sidecar = fixtureSidecarPath(target, 4242, {
    [TEST_SCRATCH_ENV]: scratch,
  })

  // A gate sets the profile target inside a run's evidence directory. The
  // transient sidecars must not land there beside the durable records.
  assert.equal(path.dirname(sidecar), path.join(scratch, 'fixture-profile'))
  assert.ok(!sidecar.startsWith(path.dirname(target)))
  assert.equal(path.basename(sidecar).endsWith('.4242.json'), true)

  // Two targets never share a sidecar, and one target is stable across calls.
  const other = fixtureSidecarPath(path.join(scratch, 'other.json'), 4242, {
    [TEST_SCRATCH_ENV]: scratch,
  })

  assert.notEqual(sidecar, other)
  assert.equal(
    sidecar,
    fixtureSidecarPath(target, 4242, { [TEST_SCRATCH_ENV]: scratch }),
  )

  // Without the runner's scratch variable the sidecars stay under the
  // repository scratch tree rather than falling back to the target.
  assert.equal(
    fixtureSidecarDirectory({}),
    path.join(
      process.cwd(),
      'runtime',
      'tmp',
      'tests.noindex',
      'fixture-profile',
    ),
  )
})

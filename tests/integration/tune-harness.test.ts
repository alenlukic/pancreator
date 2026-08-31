import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { validateTuneRecordShape } from '../../src/lib/validators/tune-record.js'
import {
  finalizePreparedTuneSession,
  finalizeTuneSession,
  prepareTuneSession,
  TUNE_LATEST_PATH,
  TUNE_FAST_PROFILE_FILE,
  TUNE_JUDGMENT_PROVENANCE_FILE,
  TUNE_PASSES_FILE,
  TUNE_VERDICTS_FILE,
  validateAudit,
  type TestIdentity,
} from '../../src/lib/test-tuning.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import { archiveWorkflowDirectories } from '../../src/lib/workflow-artifacts.js'
import { createFixture, createRun } from '../helpers.js'

function identity(file: string, name: string): TestIdentity {
  return { file, name, lane: 'unit' }
}

function directoryChecksum(directory: string): string {
  const digest = createHash('sha256')

  function visit(current: string): void {
    const entries = readdirSync(current, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    )

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name)
      const relative = path.relative(directory, entryPath)
      digest.update(`${entry.isDirectory() ? 'd' : 'f'}:${relative}\0`)

      if (entry.isDirectory()) {
        visit(entryPath)
      } else {
        digest.update(readFileSync(entryPath))
      }
    }
  }

  visit(directory)

  return digest.digest('hex')
}

function prepareWithoutTestContext(
  root: string,
): ReturnType<typeof prepareTuneSession> {
  const testContext = process.env.NODE_TEST_CONTEXT
  delete process.env.NODE_TEST_CONTEXT

  try {
    return prepareTuneSession(root)
  } finally {
    if (testContext !== undefined) {
      process.env.NODE_TEST_CONTEXT = testContext
    }
  }
}

test('finalizeTuneSession writes record, report, and latest atomically', () => {
  const root = createFixture()
  const before = gitWorkspaceSnapshot(root)
  const now = new Date().toISOString()
  const current = [identity('tests/unit/a.test.ts', 'alpha')]
  const passes = {
    benchmark: { started_at: now, ended_at: now },
    comparison: { started_at: now, ended_at: now },
    judgment: { started_at: now, ended_at: now },
  }
  const benchmark = {
    fast_lane_wall_ms: 10,
    secondary_lane_wall_ms: 0,
    fixture_template_ms: 0,
    fixture_clone_ms: 0,
    files: [],
    tests: [],
    slowest_tests: [],
  }
  const verdicts = [
    {
      identity: current[0],
      verdict: 'KEEP' as const,
      principle: 'TP-01',
      rationale: 'Unique contract with acceptable cost.',
    },
  ]

  const result = finalizeTuneSession(root, {
    session_id: 'tune-test',
    passes,
    verdicts,
    benchmark,
    current_inventory: current,
    retained_set: current,
    baseline_source: { kind: 'none' },
    prior_record: null,
    judgment_provenance: {
      handbook_path: 'governance/handbooks/eng/testing.md',
      handbook_revision: 'HEAD',
      inventory_only: true,
      inventory_path:
        'runtime/tune-harness/work/tune-test/current-inventory.json',
    },
  })

  assert.ok(
    readFileSync(path.join(root, result.record_path), 'utf8').includes(
      'tune-test',
    ),
  )
  assert.ok(
    readFileSync(path.join(root, result.report_path), 'utf8').includes(
      'Tune harness report',
    ),
  )
  assert.ok(
    readFileSync(path.join(root, TUNE_LATEST_PATH), 'utf8').includes(
      'tune-test',
    ),
  )
  assert.equal(gitWorkspaceSnapshot(root).fingerprint, before.fingerprint)
})

test('validateTuneRecordShape rejects invalid verdict references and branches', () => {
  const identityRow = identity('tests/unit/a.test.ts', 'alpha')
  const complete = {
    schema_version: 1,
    session_id: 's',
    harness_version: '0',
    git_commit: 'abc',
    workspace_fingerprint: 'fp',
    workspace_dirty: false,
    recorded_at: new Date().toISOString(),
    baseline_source: { kind: 'none' },
    passes: {
      benchmark: {
        started_at: '2026-01-01T10:00:00.000Z',
        ended_at: '2026-01-01T10:01:00.000Z',
      },
      comparison: {
        started_at: '2026-01-01T10:00:00.000Z',
        ended_at: '2026-01-01T10:01:00.000Z',
      },
      judgment: {
        started_at: '2026-01-01T10:00:00.000Z',
        ended_at: '2026-01-01T10:01:00.000Z',
      },
    },
    retained_set: [identityRow],
    current_inventory: [identityRow],
    comparison: {
      retained_and_present: [identityRow],
      added_since_retained: [],
      retained_but_removed: [],
    },
    benchmark: {
      fast_lane_wall_ms: 1,
      secondary_lane_wall_ms: 0,
      fixture_template_ms: 0,
      fixture_clone_ms: 0,
      files: [],
      tests: [],
      slowest_tests: [],
    },
    verdicts: [
      {
        identity: identityRow,
        verdict: 'KEEP',
        principle: 'TP-01',
        rationale: 'Unique contract.',
      },
    ],
    judgment_provenance: {
      handbook_path: 'governance/handbooks/eng/testing.md',
      handbook_revision: 'HEAD',
      inventory_only: true,
      inventory_path: 'runtime/tune-harness/work/s/current-inventory.json',
    },
  }

  assert.deepEqual(validateTuneRecordShape(complete, process.cwd()), [])

  const missing = validateTuneRecordShape(
    {
      ...complete,
      verdicts: [],
    },
    process.cwd(),
  )

  assert.ok(missing.some((item) => item.includes('missing verdict')))

  const badMerge = validateTuneRecordShape(
    {
      ...complete,
      verdicts: [
        {
          ...complete.verdicts[0],
          verdict: 'MERGE',
          survivor: identity('tests/unit/missing.test.ts', 'missing'),
        },
      ],
    },
    process.cwd(),
  )
  const badDelete = validateTuneRecordShape(
    {
      ...complete,
      verdicts: [
        {
          ...complete.verdicts[0],
          verdict: 'DELETE',
          delete_reason: 'too_slow',
        },
      ],
    },
    process.cwd(),
  )
  const badDemote = validateTuneRecordShape(
    {
      ...complete,
      verdicts: [
        {
          ...complete.verdicts[0],
          verdict: 'DEMOTE',
          demote_destination: 'somewhere',
        },
      ],
    },
    process.cwd(),
  )
  const badProvenance = validateTuneRecordShape(
    {
      ...complete,
      judgment_provenance: {
        ...complete.judgment_provenance,
        similarity_index_path: 'runtime/tune-harness/work/s/fast-profile.json',
      },
    },
    process.cwd(),
  )

  assert.ok(badMerge.some((item) => item.includes('current survivor')))
  assert.ok(badDelete.some((item) => item.includes('permitted reason')))
  assert.ok(badDemote.some((item) => item.includes('actionable destination')))
  assert.ok(
    badProvenance.some((item) => item.includes('unpermitted similarity input')),
  )
})

test('archiveWorkflowDirectories leaves tune records byte-identical', () => {
  const root = createFixture()
  const runId = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  }).run_id
  const recordDir = path.join(root, 'runtime/tune-harness/records')
  mkdirSync(recordDir, { recursive: true })
  const recordPath = path.join(recordDir, 'archive-fixture.json')
  const activeRun = path.join(root, 'runtime/logs/workflows', runId)
  const archivedRun = path.join(root, 'runtime/logs/workflows/archive', runId)

  writeFileSync(recordPath, '{"schema_version":1,"session_id":"x"}\n')
  const before = readFileSync(recordPath)
  assert.equal(existsSync(activeRun), true)

  archiveWorkflowDirectories(root, {
    retentionDays: 7,
    now: new Date('2030-07-01T22:00:00.000Z'),
  })

  assert.equal(existsSync(activeRun), false)
  assert.equal(existsSync(path.join(archivedRun, 'agent/state.json')), true)
  assert.ok(readFileSync(recordPath).equals(before))
})

test('validateAudit rejects target installations before baseline execution', () => {
  const root = createFixture()
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  config.installation_mode = 'embedded'
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

  assert.throws(
    () =>
      validateAudit(root, {
        recordPath: 'docs/test-audit-2026-08-29.md',
        baselineRef: 'HEAD',
        targetRef: 'HEAD',
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('available only in self-development'),
  )
})

test('finalizeTuneSession rejects incomplete records before latest changes', () => {
  const root = createFixture()
  const current = [identity('tests/unit/a.test.ts', 'alpha')]
  const now = '2026-01-01T10:00:00.000Z'

  assert.throws(
    () =>
      finalizeTuneSession(root, {
        session_id: 'incomplete',
        passes: {
          benchmark: { started_at: now, ended_at: now },
          comparison: { started_at: now, ended_at: now },
          judgment: { started_at: now, ended_at: now },
        },
        verdicts: [],
        benchmark: {
          fast_lane_wall_ms: 1,
          secondary_lane_wall_ms: 0,
          fixture_template_ms: 0,
          fixture_clone_ms: 0,
          files: [],
          tests: [],
          slowest_tests: [],
        },
        current_inventory: current,
        retained_set: current,
        baseline_source: { kind: 'none' },
        prior_record: null,
        judgment_provenance: {
          handbook_path: 'governance/handbooks/eng/testing.md',
          handbook_revision: 'HEAD',
          inventory_only: true,
          inventory_path:
            'runtime/tune-harness/work/incomplete/current-inventory.json',
        },
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('missing verdict for tests/unit/a.test.ts'),
  )
  assert.throws(() => readFileSync(path.join(root, TUNE_LATEST_PATH)))
})

function writePreparedSession(
  root: string,
  sessionId: string,
  current: TestIdentity[],
  retained: TestIdentity[],
  wallMs: number,
): void {
  const workDir = path.join(root, 'runtime/tune-harness/work', sessionId)
  const now = '2026-01-01T10:00:00.000Z'

  mkdirSync(workDir, { recursive: true })
  writeFileSync(
    path.join(workDir, 'current-inventory.json'),
    `${JSON.stringify({ identities: current })}\n`,
  )
  writeFileSync(
    path.join(workDir, 'retained-set.json'),
    `${JSON.stringify({ identities: retained })}\n`,
  )
  writeFileSync(
    path.join(workDir, 'session-meta.json'),
    `${JSON.stringify({
      baseline_source:
        sessionId === 'session-two'
          ? { kind: 'prior_record', prior_session_id: 'session-one' }
          : { kind: 'none' },
    })}\n`,
  )
  writeFileSync(
    path.join(workDir, TUNE_PASSES_FILE),
    `${JSON.stringify({
      benchmark: { started_at: now, ended_at: now },
      comparison: { started_at: now, ended_at: now },
      judgment: { started_at: now, ended_at: now },
    })}\n`,
  )
  writeFileSync(
    path.join(workDir, TUNE_VERDICTS_FILE),
    `${JSON.stringify(
      current.map((item) => ({
        identity: item,
        verdict: 'KEEP',
        principle: 'TP-01',
        rationale: `The ${item.name} test protects one named contract.`,
      })),
    )}\n`,
  )
  writeFileSync(
    path.join(workDir, TUNE_JUDGMENT_PROVENANCE_FILE),
    `${JSON.stringify({
      handbook_path: 'governance/handbooks/eng/testing.md',
      handbook_revision: 'HEAD',
      inventory_only: true,
      inventory_path: `runtime/tune-harness/work/${sessionId}/current-inventory.json`,
    })}\n`,
  )
  writeFileSync(
    path.join(workDir, TUNE_FAST_PROFILE_FILE),
    `${JSON.stringify({
      schema_version: 1,
      lane: 'unit',
      recorded_at: now,
      test_count: current.length,
      pass_count: current.length,
      fail_count: 0,
      wall_clock_ms: wallMs,
      files: [
        {
          file: 'tests/unit/a.test.ts',
          duration_ms: wallMs - 1,
          test_count: current.length,
          pass_count: current.length,
          fail_count: 0,
        },
      ],
      slowest_tests: current.map((item, index) => ({
        file: item.file,
        name: item.name,
        duration_ms: wallMs - index - 2,
      })),
      all_tests: current.map((item, index) => ({
        file: item.file,
        name: item.name,
        duration_ms: wallMs - index - 2,
      })),
      fixture_cost: { template_ms: 4, clone_ms: 2 },
    })}\n`,
  )
}

test('prepare and finalize preserve the test source tree', () => {
  const root = createFixture()
  const testsDir = path.join(root, 'tests')
  const sourceDir = path.join(testsDir, 'unit')
  mkdirSync(sourceDir, { recursive: true })
  writeFileSync(
    path.join(sourceDir, 'sentinel.test.ts'),
    "test('sentinel', () => {})\n",
  )

  const compiledDir = path.join(root, 'dist/tests/unit')
  mkdirSync(compiledDir, { recursive: true })
  writeFileSync(
    path.join(compiledDir, 'sentinel.test.js'),
    ["import test from 'node:test'", "test('sentinel', () => {})", ''].join(
      '\n',
    ),
  )

  const reporterDir = path.join(root, 'dist/tests/reporters')
  mkdirSync(reporterDir, { recursive: true })
  copyFileSync(
    path.join(process.cwd(), 'dist/tests/reporters/inventory.js'),
    path.join(reporterDir, 'inventory.js'),
  )

  const before = directoryChecksum(testsDir)
  const prepared = prepareWithoutTestContext(root)
  writePreparedSession(
    root,
    prepared.session_id,
    prepared.current_inventory,
    prepared.retained_set,
    10,
  )
  finalizePreparedTuneSession(root, prepared.session_id)

  assert.equal(directoryChecksum(testsDir), before)
})

test('finalizePreparedTuneSession uses the prior record for second-run deltas', () => {
  const root = createFixture()
  const alpha = identity('tests/unit/a.test.ts', 'alpha')
  const beta = identity('tests/unit/b.test.ts', 'beta')

  writePreparedSession(root, 'session-one', [alpha], [alpha], 10)
  const first = finalizePreparedTuneSession(root, 'session-one')
  const firstRecord = JSON.parse(
    readFileSync(path.join(root, first.record_path), 'utf8'),
  ) as { benchmark: { fast_lane_wall_ms: number } }

  assert.equal(firstRecord.benchmark.fast_lane_wall_ms, 10)

  writePreparedSession(root, 'session-two', [alpha, beta], [alpha], 16)
  const second = finalizePreparedTuneSession(root, 'session-two')
  const secondRecord = JSON.parse(
    readFileSync(path.join(root, second.record_path), 'utf8'),
  ) as {
    prior_record_id: string
    benchmark: { prior_deltas: { fast_lane_wall_ms: number } }
    comparison: { added_since_retained: TestIdentity[] }
  }

  assert.equal(secondRecord.prior_record_id, 'session-one')
  assert.equal(secondRecord.benchmark.prior_deltas.fast_lane_wall_ms, 6)
  assert.deepEqual(secondRecord.comparison.added_since_retained, [beta])
})

test('the inventory reporter keeps duplicate top-level names', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pan-tune-inventory-'))
  const testFile = path.join(root, 'duplicate.test.cjs')
  const inventoryPath = path.join(root, 'inventory.json')
  const reporter = path.join(process.cwd(), 'dist/tests/reporters/inventory.js')

  writeFileSync(
    testFile,
    [
      "const test = require('node:test')",
      "test('same name', () => {})",
      "test('same name', () => {})",
      '',
    ].join('\n'),
  )

  const result = spawnSync(
    process.execPath,
    [
      '--test',
      `--test-reporter=${reporter}`,
      '--test-reporter-destination=stdout',
      '--test-name-pattern=^$',
      testFile,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) => key !== 'NODE_TEST_CONTEXT',
          ),
        ),
        PAN_TEST_INVENTORY: inventoryPath,
      },
    },
  )

  assert.equal(result.status, 0, result.stderr)

  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as {
    identities: TestIdentity[]
  }

  assert.equal(inventory.identities.length, 2)
  assert.deepEqual(
    inventory.identities.map((item) => item.occurrence),
    [undefined, 2],
  )
})

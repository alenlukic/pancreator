import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  listObservations,
  observationResolutionsPath,
  observationWindowMs,
  resolveObservation,
} from '../../src/lib/observations.js'
import { planCleanup } from '../../src/lib/cleanup.js'
import { validateReleaseOutput } from '../../src/lib/validators/stage-validators.js'
import { archiveWorkflowDirectories } from '../../src/lib/workflow-artifacts.js'
import { createFixture } from '../fixture-template.js'
import { createTestTempDirectory } from '../temp.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')
const CONTRACT = 'library/schemas/stage-output-requirements.json'

const OBSERVATION = {
  criterion: 'AC-002',
  signal: 'No suite_cost_advisory names an implement worker',
  source: 'events.jsonl advisories',
  window: '7d',
  check: 'rg suite_cost_advisory runtime/logs/workflows/*/agent/events.jsonl',
}

function writeJsonFile(root: string, relative: string, value: unknown): void {
  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  writeFileSync(path.join(root, relative), `${JSON.stringify(value)}\n`)
}

function historyEntry(stage: string, outputPath: string, submittedAt: string) {
  return {
    stage,
    attempt: 1,
    invocation_id: `${stage}-1`,
    output_path: outputPath,
    outcome: 'success',
    submitted_at: submittedAt,
    workspace_fingerprint: 'fingerprint',
    validation_errors: [],
    deterministic: [],
  }
}

/**
 * A minimal recorded run: a verify output, an optional ship output, and the
 * state whose stage history points at both.
 */
function writeRun(
  root: string,
  runId: string,
  options: {
    observeIds?: string[]
    observations?: unknown[]
    shippedAt?: string
  } = {},
): Record<string, unknown> {
  const agent = `runtime/logs/workflows/${runId}/agent`
  const verifyPath = `${agent}/outputs/verify-1.json`
  const shipPath = `${agent}/outputs/ship-1.json`

  writeJsonFile(root, verifyPath, {
    data: {
      verify: {
        acceptance_results: [
          { id: 'AC-001', result: 'pass' },
          ...(options.observeIds ?? []).map((id) => ({
            id,
            result: 'observe',
          })),
        ],
      },
    },
  })

  const history = [historyEntry('verify', verifyPath, '2026-09-20T10:00:00Z')]

  if (options.observations) {
    writeJsonFile(root, shipPath, {
      data: { release: { observations: options.observations } },
    })
    history.push(
      historyEntry(
        'ship',
        shipPath,
        options.shippedAt ?? '2026-09-20T12:00:00.000Z',
      ),
    )
  }

  const state = {
    schema_version: 2,
    run_id: runId,
    workflow_slug: 'delivery',
    title: runId,
    status: 'succeeded',
    created_at: '2026-06-22T01:58:00.000Z',
    pending_action: {},
    stage_history: history,
    attempts: {},
  }

  writeJsonFile(root, `${agent}/state.json`, state)

  return state
}

function validateShip(
  root: string,
  release: Record<string, unknown>,
  runState: Record<string, unknown>,
) {
  writeJsonFile(root, 'ship-output.json', { data: { release } })

  return validateReleaseOutput({
    root,
    targetPath: 'ship-output.json',
    requirement: {
      policy_id: 'SHIP-001',
      requirement_id: 'release-validate',
      registry_id: 'RELEASE-VALIDATE-001',
      arguments: {},
    },
    runState,
  })
}

function validatorRoot(): string {
  const root = createTestTempDirectory('pan-ship-observations-')

  mkdirSync(path.join(root, 'library/schemas'), { recursive: true })
  writeFileSync(
    path.join(root, CONTRACT),
    readFileSync(path.join(process.cwd(), CONTRACT)),
  )

  return root
}

function observationCodes(result: { issues: Array<{ code: string }> }) {
  return result.issues
    .map((item) => item.code)
    .filter((code) => code.startsWith('release.observation'))
}

test('ship validator requires an observation for each verify observe result', () => {
  const root = validatorRoot()
  const state = writeRun(root, 'run-a', { observeIds: ['AC-002'] })

  assert.deepEqual(observationCodes(validateShip(root, {}, state)), [
    'release.observation_missing',
  ])
  assert.deepEqual(
    observationCodes(
      validateShip(
        root,
        { observations: [{ ...OBSERVATION, check: ' ' }] },
        state,
      ),
    ),
    ['release.observation_shape', 'release.observation_missing'],
  )
  assert.deepEqual(
    observationCodes(
      validateShip(root, { observations: [OBSERVATION] }, state),
    ),
    [],
  )
})

test('ship validator refuses an observation window pan observations cannot date', () => {
  const root = validatorRoot()
  const state = writeRun(root, 'run-w', { observeIds: ['AC-002'] })

  for (const window of ['one week', '7d post-deploy', 'P7D', '0d']) {
    const result = validateShip(
      root,
      { observations: [{ ...OBSERVATION, window }] },
      state,
    )

    assert.deepEqual(observationCodes(result), ['release.observation_window'])
    assert.match(
      result.issues.find((item) => item.code === 'release.observation_window')
        ?.message ?? '',
      /<n>h, <n>d, or <n>w/u,
    )
  }
})

test('ship validator requires no observation when verify deferred none', () => {
  const root = validatorRoot()
  const state = writeRun(root, 'run-b')

  assert.deepEqual(observationCodes(validateShip(root, {}, state)), [])
  // A run state with no verify output, as an older run carries, defers none.
  assert.deepEqual(
    observationCodes(validateShip(root, {}, { stage_history: [] })),
    [],
  )
})

test('observation windows parse hours, days, and weeks', () => {
  assert.equal(observationWindowMs('36h'), 36 * 3_600_000)
  assert.equal(observationWindowMs('7d'), 7 * 86_400_000)
  assert.equal(observationWindowMs('2 weeks'), 14 * 86_400_000)
  assert.equal(observationWindowMs('until the next release'), null)
  assert.equal(observationWindowMs('0d'), null)
})

test('observations list open and due items and resolve them once', () => {
  const root = createFixture()

  writeRun(root, 'run-due', {
    observeIds: ['AC-002'],
    observations: [OBSERVATION],
    shippedAt: '2026-09-01T00:00:00.000Z',
  })
  writeRun(root, 'run-open', {
    observations: [{ ...OBSERVATION, criterion: 'AC-005', window: '30d' }],
    shippedAt: '2026-09-25T00:00:00.000Z',
  })
  writeRun(root, 'run-unshipped', { observeIds: ['AC-009'] })

  const now = new Date('2026-09-30T00:00:00.000Z')
  const open = listObservations(root, { now })

  assert.deepEqual(
    open.map((item) => [item.run_id, item.criterion, item.status, item.due_at]),
    [
      ['run-open', 'AC-005', 'open', '2026-10-25T00:00:00.000Z'],
      ['run-due', 'AC-002', 'due', '2026-09-08T00:00:00.000Z'],
    ],
  )
  assert.equal(open[1]?.check, OBSERVATION.check)
  assert.equal(open[1]?.shipped_at, '2026-09-01T00:00:00.000Z')

  assert.throws(
    () =>
      resolveObservation(root, {
        runId: 'run-due',
        criterion: 'AC-002',
        status: 'refuted',
        note: 'Advisories still name implement workers.',
      }),
    { code: 'OBSERVATION_INTAKE_REQUIRED' },
  )
  assert.throws(
    () =>
      resolveObservation(root, {
        runId: 'run-due',
        criterion: 'AC-404',
        status: 'confirmed',
        note: 'n/a',
      }),
    { code: 'OBSERVATION_NOT_FOUND' },
  )
  assert.throws(
    () =>
      resolveObservation(root, {
        runId: 'run-missing',
        criterion: 'AC-002',
        status: 'confirmed',
        note: 'n/a',
      }),
    { code: 'RUN_NOT_FOUND' },
  )
  assert.throws(
    () =>
      resolveObservation(root, {
        runId: 'run-due',
        criterion: 'AC-002',
        status: 'refuted',
        note: 'Advisories still name implement workers.',
        intake: 'runtime/inbox/queue/missing.md',
      }),
    { code: 'OBSERVATION_INTAKE_NOT_FOUND' },
  )
  // REPAIR-001 forbids confirming an item whose window still runs.
  assert.throws(
    () =>
      resolveObservation(root, {
        runId: 'run-open',
        criterion: 'AC-005',
        status: 'confirmed',
        note: 'Too early to tell.',
        now,
      }),
    { code: 'OBSERVATION_NOT_DUE' },
  )
  assert.equal(existsSync(observationResolutionsPath(root)), false)

  const intake = 'runtime/inbox/queue/harness-repair-20260930T000000Z-x.md'

  mkdirSync(path.dirname(path.join(root, intake)), { recursive: true })
  writeFileSync(path.join(root, intake), '# Harness repair intake\n')

  const resolution = resolveObservation(root, {
    runId: 'run-due',
    criterion: 'AC-002',
    status: 'refuted',
    note: 'Advisories still name implement workers.',
    intake,
    now,
  })

  assert.equal(resolution.intake, intake)
  assert.throws(
    () =>
      resolveObservation(root, {
        runId: 'run-due',
        criterion: 'AC-002',
        status: 'confirmed',
        note: 'again',
      }),
    { code: 'OBSERVATION_ALREADY_RESOLVED' },
  )

  assert.deepEqual(
    listObservations(root, { now }).map((item) => item.criterion),
    ['AC-005'],
  )

  const all = listObservations(root, { all: true, now })
  const refuted = all.find((item) => item.criterion === 'AC-002')

  assert.equal(refuted?.status, 'refuted')
  assert.equal(refuted?.resolution?.note, resolution.note)
  assert.equal(
    readFileSync(observationResolutionsPath(root), 'utf8').trim().split('\n')
      .length,
    1,
  )
})

test('pan observations lists and resolves through the CLI', () => {
  const root = createFixture()

  writeRun(root, 'run-cli', {
    observations: [OBSERVATION],
    shippedAt: '2026-09-01T00:00:00.000Z',
  })

  const run = (args: string[]) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8' })

  const listed = run(['observations', '--json'])

  assert.equal(listed.status, 0, listed.stderr)
  assert.deepEqual(
    (
      JSON.parse(listed.stdout) as Array<{ criterion: string; status: string }>
    ).map((item) => [item.criterion, item.status]),
    [['AC-002', 'due']],
  )

  const resolved = run([
    'observations',
    'resolve',
    'run-cli',
    'AC-002',
    '--status',
    'confirmed',
    '--note',
    'No advisory in seven days of events.',
  ])

  assert.equal(resolved.status, 0, resolved.stderr)
  assert.equal(
    (JSON.parse(resolved.stdout) as { status: string }).status,
    'resolved',
  )

  const empty = run(['observations'])

  assert.equal(empty.status, 0, empty.stderr)
  assert.match(empty.stdout, /No open post-ship observations/u)

  const all = run(['observations', '--all', '--json'])

  assert.equal(
    (JSON.parse(all.stdout) as Array<{ status: string }>)[0]?.status,
    'confirmed',
  )
})

test('an open observation can be refuted before its window ends', () => {
  const root = createFixture()
  const intake = 'runtime/inbox/queue/harness-repair-20260930T000000Z-y.md'

  writeRun(root, 'run-open', {
    observations: [{ ...OBSERVATION, window: '30d' }],
    shippedAt: '2026-09-25T00:00:00.000Z',
  })
  mkdirSync(path.dirname(path.join(root, intake)), { recursive: true })
  writeFileSync(path.join(root, intake), '# Harness repair intake\n')

  assert.equal(
    resolveObservation(root, {
      runId: 'run-open',
      criterion: 'AC-002',
      status: 'refuted',
      note: 'The advisory already fired on the first run.',
      intake,
      now: new Date('2026-09-30T00:00:00.000Z'),
    }).status,
    'refuted',
  )
})

test('retention keeps a run live while it owes an unresolved observation', () => {
  const root = createFixture()
  const held = '63379_Jun-22-0158_5f354f23'
  const free = '63379_Jun-22-0158_5f354f24'
  const now = new Date('2026-09-30T00:00:00.000Z')

  writeRun(root, held, {
    observations: [OBSERVATION],
    shippedAt: '2026-06-23T00:00:00.000Z',
  })
  writeRun(root, free, {
    observations: [OBSERVATION],
    shippedAt: '2026-06-23T00:00:00.000Z',
  })
  resolveObservation(root, {
    runId: free,
    criterion: OBSERVATION.criterion,
    status: 'confirmed',
    note: 'No advisory in seven days of events.',
    now,
  })

  const cleanup = planCleanup(root, {
    days: 7,
    classes: ['workflow-runs'],
    now,
  })

  assert.ok(
    cleanup.skipped.some(
      (item) =>
        item.path === `runtime/logs/workflows/${held}` &&
        /unresolved post-ship observation/u.test(item.reason),
    ),
  )
  assert.ok(
    !cleanup.actions.some(
      (item) => item.path === `runtime/logs/workflows/${held}`,
    ),
  )

  const archive = archiveWorkflowDirectories(root, { retentionDays: 7, now })

  assert.deepEqual(archive.run_ids, [free])
  assert.deepEqual(archive.observation_held_run_ids, [held])
  assert.deepEqual(
    listObservations(root, { now }).map((item) => item.run_id),
    [held],
  )
})

test('pan observations reads and resolves another installation root with --root', () => {
  const source = createFixture()
  const installation = createFixture()
  const intake = 'runtime/inbox/queue/harness-repair-20260930T000000Z-z.md'

  writeRun(installation, 'run-target', {
    observations: [{ ...OBSERVATION, source: 'Sentry issues' }],
    shippedAt: '2026-09-01T00:00:00.000Z',
  })
  // The sweep files its intake in the source checkout it runs from.
  mkdirSync(path.dirname(path.join(source, intake)), { recursive: true })
  writeFileSync(path.join(source, intake), '# Harness repair intake\n')

  const run = (args: string[]) =>
    spawnSync(process.execPath, [CLI, ...args], {
      cwd: source,
      encoding: 'utf8',
    })

  assert.deepEqual(JSON.parse(run(['observations', '--json']).stdout), [])

  const listed = run(['observations', '--root', installation, '--json'])

  assert.equal(listed.status, 0, listed.stderr)
  assert.deepEqual(
    (JSON.parse(listed.stdout) as Array<{ run_id: string }>).map(
      (item) => item.run_id,
    ),
    ['run-target'],
  )

  const resolved = run([
    'observations',
    'resolve',
    'run-target',
    'AC-002',
    '--status',
    'refuted',
    '--note',
    'Sentry shows the regression.',
    '--intake',
    intake,
    '--root',
    installation,
  ])

  assert.equal(resolved.status, 0, resolved.stderr)
  assert.equal(existsSync(observationResolutionsPath(installation)), true)
  assert.equal(existsSync(observationResolutionsPath(source)), false)

  const refused = run(['observations', '--root', path.join(source, 'nowhere')])

  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /INVALID_ARGUMENT|installation root/u)
})

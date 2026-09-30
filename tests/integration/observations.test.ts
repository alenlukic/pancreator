import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  listObservations,
  observationResolutionsPath,
  observationWindowMs,
  resolveObservation,
} from '../../src/lib/observations.js'
import { validateReleaseOutput } from '../../src/lib/validators/stage-validators.js'
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

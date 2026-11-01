import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  classifyIntake,
  routeFor,
  SELF_DEVELOPMENT_LAYERS,
  SIZE_RUBRIC,
  sizeClassFor,
  type SizeClass,
} from '../../src/lib/intake/classification.js'
import {
  readIntakeRecord,
  recordIntakeClassification,
} from '../../src/lib/intake/record.js'
import { createTestTempDirectory } from '../temp.js'

const REQUEST = 'runtime/inbox/queue/1_request.md'

function fixture(installedWorkflows: string[] = []): string {
  const root = createTestTempDirectory('intake-classification-')

  writeFileSync(
    path.join(root, 'config.json'),
    JSON.stringify({
      schema_version: 1,
      installation_mode: 'self_development',
      state_root: 'runtime',
      workspace_root: '.',
    }),
  )
  mkdirSync(path.join(root, 'runtime', 'inbox', 'queue'), { recursive: true })
  writeFileSync(path.join(root, REQUEST), '# Request\n')

  for (const workflow of installedWorkflows) {
    mkdirSync(path.join(root, 'library', 'workflows', workflow), {
      recursive: true,
    })
    writeFileSync(
      path.join(root, 'library', 'workflows', workflow, 'workflow.json'),
      '{}\n',
    )
  }

  return root
}

function estimate(sloc: number, layers = ['cli-engine'], newPoint = false) {
  return { sloc, tssrfs: 4, modules: 3, layers, newIntegrationPoints: newPoint }
}

test('size class takes the smallest target met within its hard max', () => {
  const cases: Array<[number, number, number, SizeClass]> = [
    [25, 9, 9, 'XS'],
    [45, 1, 1, 'XS'],
    [60, 1, 1, 'S'],
    [400, 2, 2, 'M'],
    [1100, 3, 3, 'L'],
    [2100, 1, 1, 'XL'],
    [1300, 17, 3, 'XL'],
  ]

  for (const [sloc, tssrfs, modules, expected] of cases) {
    assert.equal(
      sizeClassFor({ sloc, tssrfs, modules }),
      expected,
      `${sloc} SLOC, ${tssrfs} TSSRFs, ${modules} modules`,
    )
  }
})

test('route follows size and new integration points', () => {
  assert.deepEqual(routeFor('S', true), ['one-shot'])
  assert.deepEqual(routeFor('M', false), ['standard'])
  assert.deepEqual(routeFor('M', true), ['prototype-trace', 'standard'])
  assert.deepEqual(routeFor('XL', false), ['decompose'])
  assert.deepEqual(routeFor('L', true), ['prototype-trace', 'decompose'])
})

test('classification refuses estimates the rubric cannot place', () => {
  assert.throws(
    () =>
      classifyIntake(
        estimate(10, ['cli-engine'], true),
        SELF_DEVELOPMENT_LAYERS,
      ),
    { code: 'INVALID_INTAKE_ESTIMATE' },
  )
  assert.throws(
    () => classifyIntake(estimate(10, ['frontend']), SELF_DEVELOPMENT_LAYERS),
    { code: 'INVALID_INTAKE_LAYER' },
  )
  assert.throws(() => classifyIntake(estimate(-1), SELF_DEVELOPMENT_LAYERS), {
    code: 'INVALID_INTAKE_ESTIMATE',
  })
})

test('reclassification needs a reason and keeps every earlier entry', () => {
  const root = fixture()
  const base = { root, request: REQUEST, rationale: 'One CLI command.' }

  recordIntakeClassification({ ...base, estimate: estimate(120) })

  assert.throws(
    () => recordIntakeClassification({ ...base, estimate: estimate(700) }),
    { code: 'RECLASSIFY_REASON_REQUIRED' },
  )

  const record = recordIntakeClassification({
    ...base,
    estimate: estimate(700),
    reason: 'Implement found a second engine module.',
  })

  assert.deepEqual(
    record.history.map((entry) => entry.size_class),
    ['S', 'M'],
  )
  assert.equal(
    record.current.reclassification_reason,
    'Implement found a second engine module.',
  )
  assert.deepEqual(readIntakeRecord(root, REQUEST), record)
})

test('start resolves the route against installed workflows and the operator', () => {
  const root = fixture(['standard', 'delivery'])
  const record = (sloc: number, operatorWorkflow?: string) =>
    recordIntakeClassification({
      root,
      request: REQUEST,
      estimate: estimate(sloc, ['cli-engine', 'library'], false),
      rationale: 'Engine and persona change.',
      operatorWorkflow,
      reason: 'Re-estimate.',
    }).current.start

  assert.deepEqual(record(500), {
    kind: 'workflow',
    workflow: 'standard',
    source: 'route',
    reason: null,
  })
  assert.deepEqual(record(100), {
    kind: 'workflow',
    workflow: 'planning',
    source: 'fallback',
    reason: 'The one-shot workflow is not installed yet.',
  })
  assert.deepEqual(record(1500), {
    kind: 'decompose',
    command: '/pan-decompose',
  })
  assert.deepEqual(record(1500, 'delivery'), {
    kind: 'workflow',
    workflow: 'delivery',
    source: 'operator',
    reason: null,
  })
  assert.throws(() => record(100, 'missing'), { code: 'UNKNOWN_WORKFLOW' })
})

test('an installed one-shot route starts, then escalates to standard', () => {
  const root = fixture(['one-shot', 'standard'])
  const base = { root, request: REQUEST, rationale: 'One CLI command.' }

  assert.deepEqual(
    recordIntakeClassification({ ...base, estimate: estimate(25) }).current
      .start,
    { kind: 'workflow', workflow: 'one-shot', source: 'route', reason: null },
  )

  const record = recordIntakeClassification({
    ...base,
    estimate: estimate(400),
    reason: 'Implement exceeded the S SLOC hard max.',
  })

  assert.equal(record.history[0]?.start.kind, 'workflow')
  assert.equal(
    record.history[0]?.start.kind === 'workflow'
      ? record.history[0].start.workflow
      : null,
    'one-shot',
  )
  assert.deepEqual(record.current.start, {
    kind: 'workflow',
    workflow: 'standard',
    source: 'route',
    reason: null,
  })
  assert.equal(
    record.current.reclassification_reason,
    'Implement exceeded the S SLOC hard max.',
  )
  assert.deepEqual(
    record.history.map((entry) => entry.size_class),
    ['XS', 'M'],
  )
})

test('sizing handbook states the thresholds the classifier applies', () => {
  const handbook = readFileSync(
    path.join(process.cwd(), 'governance', 'handbooks', 'eng', 'sizing.md'),
    'utf8',
  )
  const rows = handbook
    .split('\n')
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter(
      (cells) => /^(XS|S|M|L)$/u.test(cells[1] ?? '') && cells.length === 7,
    )
    .map(([, sizeClass, sloc, tssrf, modules, hardMax]) => ({
      sizeClass,
      slocTarget: Number(sloc),
      tssrfTarget: Number(tssrf),
      moduleTarget: Number(modules),
      slocHardMax: Number(hardMax),
    }))

  assert.deepEqual(rows, SIZE_RUBRIC)
})

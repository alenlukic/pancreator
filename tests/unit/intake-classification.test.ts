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
import { intakeNextCommand } from '../../src/cli/intake.js'

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
  const root = fixture(['one-shot', 'standard'])
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
  const root = fixture(['standard', 'delivery', 'planning'])
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
  assert.throws(() => record(100), { code: 'UNKNOWN_WORKFLOW' })
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

test('an installed prototype-trace route starts for M with new integration points', () => {
  const root = fixture(['prototype-trace', 'standard'])

  assert.deepEqual(
    recordIntakeClassification({
      root,
      request: REQUEST,
      estimate: estimate(400, ['cli-engine', 'library'], true),
      rationale: 'New adapter boundary.',
    }).current.start,
    {
      kind: 'workflow',
      workflow: 'prototype-trace',
      source: 'route',
      reason: null,
    },
  )
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

test('classified routes start without a planning fallback', () => {
  const grammar = readFileSync(
    path.join(process.cwd(), 'src', 'lib', 'pan-command-grammar.ts'),
    'utf8',
  )
  assert.match(
    grammar,
    /--workflow one-shot\|standard\|prototype-trace\|planning/,
  )
  assert.match(grammar, /Size-routed work starts from pan intake classify/)

  const route = JSON.parse(
    readFileSync(
      path.join(process.cwd(), 'governance', 'policies', 'ROUTE-001.json'),
      'utf8',
    ),
  ) as { instructions: string[] }
  const missing = route.instructions.find((line) =>
    line.includes('not installed'),
  )
  assert.match(missing ?? '', /UNKNOWN_WORKFLOW/)
  assert.equal(missing?.includes('falls back'), false)

  const start = readFileSync(
    path.join(process.cwd(), 'library', 'cursor', 'commands', 'pan-start.md'),
    'utf8',
  )
  assert.match(start, /including its `--workflow`/)
  assert.equal(start.includes('Do not pass `--workflow`'), false)

  const orchestrator = readFileSync(
    path.join(process.cwd(), 'library', 'personas', 'orchestrator.md'),
    'utf8',
  )
  assert.match(orchestrator, /A missing route workflow is refused/)
  assert.equal(orchestrator.includes('falls back to `planning`'), false)
})

test('named pipeline configs map test-author beside coder', () => {
  const config = JSON.parse(
    readFileSync(path.join(process.cwd(), 'config.json'), 'utf8'),
  ) as {
    active_config: string
    defaults: Record<string, string>
    configs: Record<string, Record<string, string>>
  }
  assert.equal(config.active_config, 'default')
  assert.equal(config.defaults['test-author'], config.defaults.coder)
  for (const name of ['balanced', 'advanced', 'ultra'] as const) {
    assert.equal(
      config.configs[name]?.['test-author'],
      config.configs[name]?.coder,
    )
  }
})

test('a trace route refuses a missing continuation workflow before recording intake', () => {
  const root = fixture(['prototype-trace'])
  for (const sloc of [400, 1500]) {
    assert.throws(
      () =>
        recordIntakeClassification({
          root,
          request: REQUEST,
          estimate: estimate(sloc, ['cli-engine', 'library'], true),
          rationale: 'New interface.',
        }),
      { code: 'UNKNOWN_WORKFLOW' },
    )
    assert.equal(readIntakeRecord(root, REQUEST), null)
  }
})

test('decomposition starts with the original classified request, not augmented.md', () => {
  const root = fixture(['planning'])
  const augmented = 'runtime/intake/1_request/augmented.md'
  mkdirSync(path.dirname(path.join(root, augmented)), { recursive: true })
  writeFileSync(path.join(root, augmented), 'Augmented requirements.')
  const record = recordIntakeClassification({
    root,
    request: REQUEST,
    augmented,
    estimate: estimate(1500),
    rationale: 'Wide change.',
  })
  assert.equal(
    intakeNextCommand(record, './bin/pan'),
    `/pan-decompose ${REQUEST}`,
  )
  assert.equal(readIntakeRecord(root, augmented), null)
})

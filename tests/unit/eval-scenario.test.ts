import assert from 'node:assert/strict'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  listEvalScenarioNames,
  loadEvalScenario,
  validateEvalScenarioDocument,
  validateEvalScenarios,
} from '../../src/lib/evals/index.js'

const REPO_ROOT = process.cwd()

function validScenario(): Record<string, unknown> {
  return {
    schema_version: 1,
    name: 'sample',
    description: 'A sample scenario.',
    policy_instructions: [
      { policy_id: 'DEV-001', instruction: 3, summary: 'Baseline once.' },
    ],
    fixture: 'toy-node',
    request: '# Request\n',
    workflow: 'delivery',
    verification: 'light',
    operator_decisions: [{ stage: 'plan', decision: 'approve' }],
    expected: {
      status: 'succeeded',
      stage_sequence: ['plan', { stage: 'implement', outcome: 'success' }],
      output_assertions: [
        { stage: 'implement', path: 'implementation.notes', equals: [] },
      ],
    },
    graders: [
      { id: 'profile-executions', policy: 'DEV-001#7', config: { limits: [] } },
      { id: 'stage-order-and-terminal-state' },
    ],
  }
}

test('the scenario loader returns every shipped scenario and grader set', () => {
  const names = listEvalScenarioNames(REPO_ROOT)

  assert.deepEqual(names, [
    'delivery-background-delegation',
    'delivery-basic-test-discipline',
    'prototype-environment-blocked',
  ])

  for (const name of names) {
    assert.ok(loadEvalScenario(REPO_ROOT, name).scenario.graders.length > 0)
  }
})

test('a scenario that names a pipeline configuration loads', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pan-eval-scenario-'))

  try {
    mkdirSync(path.join(root, 'evals', 'scenarios'), { recursive: true })
    mkdirSync(path.join(root, 'evals', 'fixtures', 'toy-node'), {
      recursive: true,
    })
    mkdirSync(path.join(root, 'library', 'schemas'), { recursive: true })
    copyFileSync(
      path.join(REPO_ROOT, 'library', 'schemas', 'eval-scenario.schema.json'),
      path.join(root, 'library', 'schemas', 'eval-scenario.schema.json'),
    )
    writeFileSync(
      path.join(root, 'evals', 'scenarios', 'pinned.json'),
      JSON.stringify({
        ...validScenario(),
        name: 'pinned',
        pipeline_config: 'eval-claude-code',
      }),
    )

    const scenario = loadEvalScenario(root, 'pinned')

    assert.equal(scenario.scenario.pipeline_config, 'eval-claude-code')
    assert.deepEqual(validateEvalScenarios(root), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('validateEvalScenarioDocument reports each structural defect', () => {
  const broken = {
    ...validScenario(),
    name: 'Sample Name',
    schema_version: 2,
    workflow: 'release',
    policy_instructions: [{ policy_id: 'dev1', instruction: 0, summary: '' }],
    graders: [{ id: 'unknown-grader', policy: 'bad' }],
    expected: { status: 'done', stage_sequence: [{ outcome: 'success' }] },
    surprise: true,
  }
  const errors = validateEvalScenarioDocument(broken, 'sample')
  const joined = errors.join('\n')

  assert.match(joined, /schema_version MUST be 1/u)
  assert.match(joined, /name MUST be a lowercase kebab-case identifier/u)
  assert.match(joined, /workflow MUST be one of/u)
  assert.match(joined, /policy_id MUST look like/u)
  assert.match(joined, /instruction MUST be a positive integer/u)
  assert.match(joined, /summary MUST be a non-empty string/u)
  assert.match(joined, /graders\[0\]\.id MUST be one of/u)
  assert.match(joined, /graders\[0\]\.policy MUST look like/u)
  assert.match(joined, /expected\.status MUST be a run status/u)
  assert.match(joined, /stage_sequence\[0\] MUST be a stage slug/u)
  assert.match(joined, /unknown top-level field 'surprise'/u)
})

test('validateEvalScenarioDocument rejects a name that differs from the file', () => {
  const errors = validateEvalScenarioDocument(validScenario(), 'other')

  assert.deepEqual(errors, ["name 'sample' MUST equal the file name 'other'"])
})

test('validateEvalScenarios is silent without an evals directory and strict with one', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pancreator-eval-scenarios-'))

  try {
    assert.deepEqual(validateEvalScenarios(root), [])

    mkdirSync(path.join(root, 'evals', 'scenarios'), { recursive: true })
    writeFileSync(
      path.join(root, 'evals', 'scenarios', 'sample.json'),
      JSON.stringify(validScenario()),
    )
    writeFileSync(path.join(root, 'evals', 'scenarios', 'torn.json'), '{')

    const errors = validateEvalScenarios(root)

    assert.ok(
      errors.some((message) =>
        message.includes(
          'missing required file: library/schemas/eval-scenario.schema.json',
        ),
      ),
      errors.join('\n'),
    )
    assert.ok(
      errors.some((message) =>
        message.includes("fixture 'toy-node' is missing"),
      ),
      errors.join('\n'),
    )
    assert.ok(
      errors.some((message) =>
        message.startsWith('evals/scenarios/torn.json:'),
      ),
      errors.join('\n'),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('loadEvalScenario fails closed on an unknown or invalid name', () => {
  assert.throws(
    () => loadEvalScenario(REPO_ROOT, 'does-not-exist'),
    /Unknown eval scenario/u,
  )
  assert.throws(
    () => loadEvalScenario(REPO_ROOT, '../escape'),
    /Invalid eval scenario name/u,
  )
})

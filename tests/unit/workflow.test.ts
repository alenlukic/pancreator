import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createFixture } from '../helpers.js'
import {
  listWorkflowSlugs,
  loadWorkflow,
  stageBySlug,
  validateWorkflow,
} from '../../src/lib/workflow.js'

test('development workflow is connected and stages are addressable', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  assert.equal(workflow.start_stage, 'intake')
  assert.equal(stageBySlug(workflow, 'ship').gate, 'operator')
})

test('loader assembles ordered stage files from the workflow index', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  assert.deepEqual(
    workflow.stages.map((stage) => stage.slug),
    ['intake', 'plan', 'implement', 'review', 'test', 'ship'],
  )
  assert.ok(workflow.stages.every((stage) => typeof stage.persona === 'string'))
})

test('listWorkflowSlugs finds every defined workflow', () => {
  const root = createFixture()
  assert.deepEqual(listWorkflowSlugs(root), ['design', 'dev', 'preflight'])
})

test('loader fails when an indexed stage file is missing', () => {
  const root = createFixture()
  rmSync(path.join(root, 'library', 'workflows', 'dev', 'stages', 'ship.json'))
  assert.throws(
    () => loadWorkflow(root, 'dev'),
    /missing stage file stages\/ship\.json/,
  )
})

test('live stage files require an explicit context projection', () => {
  const root = createFixture()
  const stagePath = path.join(
    root,
    'library',
    'workflows',
    'dev',
    'stages',
    'ship.json',
  )
  const stage = JSON.parse(readFileSync(stagePath, 'utf8')) as Record<
    string,
    unknown
  >

  delete stage.context
  writeFileSync(stagePath, `${JSON.stringify(stage)}\n`)

  assert.throws(() => loadWorkflow(root, 'dev'), /context MUST be defined/)
})

test('workflow validation rejects unknown transition targets', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  workflow.stages[0].transitions.success = 'missing'
  assert.throws(
    () => validateWorkflow(root, workflow, 'fixture'),
    /unknown 'missing'/,
  )
})

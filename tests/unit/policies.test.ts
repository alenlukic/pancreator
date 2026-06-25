import test from 'node:test'
import assert from 'node:assert/strict'
import { createFixture } from '../helpers.js'
import { loadPolicyCatalog, resolvePolicies } from '../../src/lib/policies.js'

test('policy resolution unions global and stage-specific policies', () => {
  const root = createFixture()
  const catalog = loadPolicyCatalog(root)
  assert.ok(catalog.size >= 8)
  const ids = resolvePolicies(root, {
    persona: 'coder',
    workflow: 'dev',
    stage: 'implement',
  }).map((policy) => policy.id)
  assert.deepEqual(ids, [
    'ACTION-001',
    'AUTO-001',
    'CONTRACT-001',
    'DEV-001',
    'ENG-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'TS-001',
    'VALID-001',
  ])
})

test('engineering handbook policy loads for reviewer and qa personas', () => {
  const root = createFixture()

  const reviewIds = resolvePolicies(root, {
    persona: 'reviewer',
    workflow: 'dev',
    stage: 'review',
  }).map((policy) => policy.id)

  assert.deepEqual(reviewIds, [
    'ACTION-001',
    'AUTO-001',
    'CONTRACT-001',
    'ENG-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'REVIEW-001',
    'TS-001',
    'VALID-001',
  ])

  const testIds = resolvePolicies(root, {
    persona: 'qa-tester',
    workflow: 'dev',
    stage: 'test',
  }).map((policy) => policy.id)

  assert.deepEqual(testIds, [
    'ACTION-001',
    'AUTO-001',
    'ENG-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'TEST-001',
    'TS-001',
    'VALID-001',
  ])
})

test('policy registry content remains canonical for inlining', () => {
  const root = createFixture()
  const catalog = loadPolicyCatalog(root)
  const action = catalog.get('ACTION-001')

  assert.ok(action)
  assert.equal(action.title, 'Safe source-control actions')
  assert.match(
    action.summary,
    /MUST NOT perform irreversible source-control actions/,
  )
  assert.equal(action.instructions.length, 2)
})

test('orchestration and release guidance resolve with required policy dependencies', () => {
  const root = createFixture()
  const orchestratorIds = resolvePolicies(root, {
    persona: 'orchestrator',
    workflow: 'dev',
    stage: 'intake',
  }).map((policy) => policy.id)
  const releaseIds = resolvePolicies(root, {
    persona: 'release-steward',
    workflow: 'dev',
    stage: 'ship',
  }).map((policy) => policy.id)

  assert.deepEqual(orchestratorIds, [
    'ACTION-001',
    'AUTO-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'INTAKE-001',
    'INVOCATION-001',
    'ORCH-001',
    'PAUSE-001',
    'VALID-001',
    'WAIVER-001',
    'WORK-001',
  ])
  assert.deepEqual(releaseIds, [
    'ACTION-001',
    'AUTO-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'SHIP-001',
    'VALID-001',
    'WAIVER-001',
    'WORK-001',
  ])
})

test('standalone remediation personas load their work-mode policies', () => {
  const root = createFixture()

  const investigatorIds = resolvePolicies(root, {
    persona: 'investigator',
    workflow: 'standalone',
    stage: 'debug',
  }).map((policy) => policy.id)
  assert.deepEqual(investigatorIds, [
    'ACTION-001',
    'AUTO-001',
    'DIAG-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'VALID-001',
    'WORK-001',
  ])

  const spotfixerIds = resolvePolicies(root, {
    persona: 'spotfixer',
    workflow: 'standalone',
    stage: 'spotfix',
  }).map((policy) => policy.id)
  assert.deepEqual(spotfixerIds, [
    'ACTION-001',
    'AUTO-001',
    'CONTRACT-001',
    'ENG-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'SPOT-001',
    'TS-001',
    'VALID-001',
    'WORK-001',
  ])
})

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
    'DEV-001',
    'ENG-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'TS-001',
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
    'ENG-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'REVIEW-001',
    'TS-001',
  ])

  const testIds = resolvePolicies(root, {
    persona: 'qa-tester',
    workflow: 'dev',
    stage: 'test',
  }).map((policy) => policy.id)

  assert.deepEqual(testIds, [
    'ACTION-001',
    'ENG-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'TEST-001',
    'TS-001',
  ])
})

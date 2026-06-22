import test from 'node:test'
import assert from 'node:assert/strict'
import { createFixture } from '../helpers.js'
import { loadPolicyCatalog, resolvePolicies } from '../../src/lib/policies.js'

test('policy resolution unions global and stage-specific policies', () => {
  const root = createFixture()
  const catalog = loadPolicyCatalog(root)
  assert.ok(catalog.size >= 7)
  const ids = resolvePolicies(root, {
    persona: 'coder',
    workflow: 'dev',
    stage: 'implement',
  }).map((policy) => policy.id)
  assert.deepEqual(ids, [
    'ACTION-001',
    'DEV-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'TS-001',
  ])
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { loadPolicyCatalog } from '../../src/lib/policies.js'
import {
  measurePoliciesContext,
  measurePolicyContext,
} from '../../src/lib/policy-context-measure.js'

const REPO_ROOT = process.cwd()

test('BROWSER-001 reports zero eager bytes and nonzero deferred bytes', () => {
  const policy = loadPolicyCatalog(REPO_ROOT).get('BROWSER-001')

  assert.ok(policy)

  const measured = measurePolicyContext(policy)

  assert.equal(measured.eagerBytes, 0)
  assert.ok(measured.deferredBytes > 0)
  assert.deepEqual([...measured.deferredTriggers].sort(), [
    'tool:browser',
    'tool:delegation',
    'tool:shell',
  ])
})

test('eager-only policies report no deferred bytes and totals add up', () => {
  const catalog = loadPolicyCatalog(REPO_ROOT)
  const comms = catalog.get('COMMS-001')
  const browser = catalog.get('BROWSER-001')

  assert.ok(comms)
  assert.ok(browser)

  const measured = measurePolicyContext(comms)

  assert.ok(measured.eagerBytes > 0)
  assert.equal(measured.deferredBytes, 0)

  const totals = measurePoliciesContext([comms, browser])

  assert.equal(
    totals.eagerBytes,
    measured.eagerBytes + measurePolicyContext(browser).eagerBytes,
  )
  assert.equal(
    totals.deferredBytes,
    measurePolicyContext(browser).deferredBytes,
  )
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { loadPolicyCatalog } from '../../src/lib/policies.js'
import { resolveDeferredClause } from '../../src/lib/policy-clause.js'
import { deferredClauseGroups } from '../../src/lib/policy-deferred.js'
import {
  policyInstructionLoad,
  policyInstructionText,
} from '../../src/lib/policy-instructions.js'

const REPO_ROOT = process.cwd()

function browserPolicy() {
  const policy = loadPolicyCatalog(REPO_ROOT).get('BROWSER-001')

  assert.ok(policy)

  return policy
}

test('BROWSER-001 defers its procedure behind browser, shell, and delegation triggers', () => {
  const groups = deferredClauseGroups(browserPolicy(), 'agent')

  assert.deepEqual(groups.map((group) => group.trigger).sort(), [
    'tool:browser',
    'tool:delegation',
    'tool:shell',
  ])

  const browser = groups.find((group) => group.trigger === 'tool:browser')

  assert.ok(browser)
  assert.ok(browser.texts.some((text) => text.includes('isolatedContext')))
})

test('a non-browser card keeps the summary and no BROWSER-001 procedure', () => {
  const policy = browserPolicy()
  const eager = policy.instructions
    .filter(
      (instruction) => policyInstructionLoad(instruction) === 'invocation',
    )
    .map((instruction) => policyInstructionText(instruction))

  assert.deepEqual(eager, [])
  assert.ok(policy.summary.includes('shared headless Chrome for Testing'))
})

test('the pull route resolves the real BROWSER-001 browser clause', () => {
  const resolved = resolveDeferredClause(REPO_ROOT, {
    policyId: 'BROWSER-001',
    trigger: 'tool:browser',
  })
  const rendered = JSON.stringify(resolved)

  assert.ok(rendered.includes('isolatedContext'))
  assert.ok(rendered.includes('new_page'))
})

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { sha256 } from '../../src/lib/io.js'
import { resolveRequirements } from '../../src/lib/requirements/resolve.js'
import { createFixture } from '../helpers.js'

test('requirement resolution is deterministic', () => {
  const root = createFixture()
  const context = {
    persona: 'coder',
    workflow: 'dev',
    stage: 'implement',
    invocation: { output_path: 'runtime/logs/workflows/x/outputs/y.json' },
  }

  const first = resolveRequirements(root, context)
  const second = resolveRequirements(root, context)

  assert.equal(first.manifest_hash, second.manifest_hash)
  assert.equal(sha256(first), sha256(second))
})

test('requirement resolution fails on unknown registry id', () => {
  const root = createFixture()
  const policyPath = path.join(root, 'governance', 'policies', 'DEV-001.json')
  const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as {
    requirements: Array<{ registry_id: string }>
  }

  policy.requirements[0].registry_id = 'UNKNOWN-VALIDATE-999'
  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`)

  assert.throws(
    () =>
      resolveRequirements(root, {
        persona: 'coder',
        workflow: 'dev',
        stage: 'implement',
      }),
    /unknown registry id/u,
  )
})

test('workflow invocations omit assessment and spotfix scaffolds', () => {
  const root = createFixture()
  const manifest = resolveRequirements(root, {
    persona: 'reviewer',
    workflow: 'dev',
    stage: 'review',
    invocation: {
      output_path: 'runtime/logs/workflows/x/outputs/review.json',
    },
  })
  const registryIds = [
    ...manifest.automation_requirements,
    ...manifest.validation_requirements,
  ].map((item) => item.registry_id)

  assert.ok(!registryIds.includes('ASSESSMENT-SCAFFOLD-001'))
  assert.ok(!registryIds.includes('SPOTFIX-ESCALATION-SCAFFOLD-001'))
  assert.ok(!registryIds.includes('SPOTFIX-VALIDATE-001'))
})

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
    workflow: 'delivery',
    stage: 'implement',
    invocation: { output_path: 'runtime/logs/workflows/x/outputs/y.json' },
  }

  const first = resolveRequirements(root, context)
  const second = resolveRequirements(root, context)

  assert.equal(first.manifest_hash, second.manifest_hash)
  assert.equal(sha256(first), sha256(second))

  const verify = resolveRequirements(root, {
    persona: 'verifier',
    workflow: 'delivery',
    stage: 'verify',
    invocation: {
      output_path: 'runtime/logs/workflows/x/outputs/verify.json',
    },
  })
  const registryIds = [
    ...verify.automation_requirements,
    ...verify.validation_requirements,
  ].map((item) => item.registry_id)

  assert.ok(!registryIds.includes('ASSESSMENT-SCAFFOLD-001'))
  assert.ok(!registryIds.includes('SPOTFIX-ESCALATION-SCAFFOLD-001'))
  assert.ok(!registryIds.includes('SPOTFIX-VALIDATE-001'))

  for (const binding of [
    {
      persona: 'decomposer',
      stage: 'decompose',
      invocation_kind: 'decomposition' as const,
      target: 'runtime/inbox/decomposition.md',
      registry_id: 'DECOMPOSITION-VALIDATE-001',
    },
    {
      persona: 'librarian',
      stage: 'build-docs',
      invocation_kind: 'documentation' as const,
      target: 'docs/target-repo-primer.md',
      registry_id: 'TARGET-REPO-PRIMER-VALIDATE-001',
    },
  ]) {
    const manifest = resolveRequirements(root, {
      persona: binding.persona,
      workflow: 'standalone',
      stage: binding.stage,
      invocation_kind: binding.invocation_kind,
      invocation: { artifact_paths: [binding.target] },
    })
    const requirement = manifest.validation_requirements.find(
      (item) => item.registry_id === binding.registry_id,
    )

    assert.ok(requirement, `${binding.stage} must bind ${binding.registry_id}`)
    assert.equal(requirement.resolved_target, binding.target)
  }
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
        workflow: 'delivery',
        stage: 'implement',
      }),
    /unknown registry id/u,
  )
})

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { sha256 } from '../../src/lib/io.js'
import { resolveRequirements } from '../../src/lib/requirements/resolve.js'
import { createFixture } from '../fixture-template.js'

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
    {
      persona: 'harness-technician',
      stage: 'repair',
      invocation_kind: 'repair' as const,
      target: 'runtime/inbox/harness-repair.md',
      registry_id: 'HARNESS-REPAIR-VALIDATE-001',
    },
    {
      persona: 'librarian',
      stage: 'conform',
      invocation_kind: 'standalone' as const,
      target: 'CHANGELOG.md',
      registry_id: 'SIMPLIFIED-ENGLISH-VALIDATE-001',
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

  for (const operatorArtifacts of ['requested', 'suppressed'] as const) {
    for (const [workflow, stage] of [
      ['delivery', 'ship'],
      ['metacritic', 'ship'],
      ['standalone', 'release'],
    ]) {
      const release = resolveRequirements(root, {
        persona: 'release-steward',
        workflow,
        stage,
        invocation_kind: workflow === 'standalone' ? 'standalone' : 'workflow',
        invocation: {
          output_path: 'runtime/release/output.json',
          artifact_paths:
            operatorArtifacts === 'requested'
              ? ['runtime/release/brief.html']
              : [],
        },
        operator_artifacts: operatorArtifacts,
      })

      assert.equal(
        release.validation_requirements.some(
          (requirement) =>
            requirement.registry_id === 'PR-DESCRIPTION-VALIDATE-001' ||
            requirement.target === 'artifact:pr_description' ||
            requirement.requirement_id.includes('-pr-'),
        ),
        false,
        `${workflow}/${stage}`,
      )
    }
  }

  const prPath = 'runtime/pr-descriptions/branch.md'

  const standalone = resolveRequirements(root, {
    persona: 'release-steward',
    workflow: 'standalone',
    stage: 'write-pr',
    invocation_kind: 'standalone',
    invocation: { output_path: prPath },
    operator_artifacts: 'suppressed',
  })

  for (const registryId of [
    'PR-DESCRIPTION-VALIDATE-001',
    'SIMPLIFIED-ENGLISH-VALIDATE-001',
  ]) {
    assert.ok(
      standalone.validation_requirements.some(
        (requirement) =>
          requirement.registry_id === registryId &&
          requirement.resolved_target === prPath,
      ),
    )
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

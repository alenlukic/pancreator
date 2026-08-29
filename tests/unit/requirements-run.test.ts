import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  runRequirement,
  isPassingResult,
} from '../../src/lib/requirements/run.js'
import { resolveRequirements } from '../../src/lib/requirements/resolve.js'
import { createFixture } from '../helpers.js'

test('artifact validators resolve only when workflow artifacts are requested', () => {
  const root = createFixture()
  const base = {
    persona: 'coder',
    workflow: 'delivery',
    stage: 'implement',
    invocation: {
      output_path: 'runtime/logs/workflows/x/outputs/y.json',
      artifact_paths: ['runtime/logs/workflows/x/operator/y.html'],
    },
  }
  const requested = resolveRequirements(root, {
    ...base,
    operator_artifacts: 'requested',
  })
  const suppressed = resolveRequirements(root, {
    ...base,
    operator_artifacts: 'suppressed',
  })
  const artifactValidators = new Set([
    'OPERATOR-ARTIFACT-VALIDATE-001',
    'SIMPLIFIED-ENGLISH-VALIDATE-001',
  ])

  assert.equal(
    requested.validation_requirements.filter((requirement) =>
      artifactValidators.has(requirement.registry_id),
    ).length,
    2,
  )
  assert.equal(
    suppressed.validation_requirements.some((requirement) =>
      artifactValidators.has(requirement.registry_id),
    ),
    false,
  )
  assert.ok(
    suppressed.validation_requirements.some(
      (requirement) => requirement.registry_id === 'STAGE-OUTPUT-VALIDATE-002',
    ),
  )
})

test('PR validators bind workflow artifact 1 and standalone output', () => {
  const root = createFixture()
  const workflow = resolveRequirements(root, {
    persona: 'release-steward',
    workflow: 'delivery',
    stage: 'ship',
    invocation_kind: 'workflow',
    operator_artifacts: 'requested',
    invocation: {
      output_path: 'runtime/logs/workflows/x/outputs/ship.json',
      artifact_paths: [
        'runtime/logs/workflows/x/operator/ship.html',
        'runtime/logs/workflows/x/operator/pr-description.md',
      ],
    },
  })
  const workflowRequirement = workflow.validation_requirements.find(
    (item) => item.registry_id === 'PR-DESCRIPTION-VALIDATE-001',
  )

  assert.equal(
    workflowRequirement?.resolved_target,
    'runtime/logs/workflows/x/operator/pr-description.md',
  )

  const standalone = resolveRequirements(root, {
    persona: 'release-steward',
    workflow: 'standalone',
    stage: 'write-pr',
    invocation_kind: 'standalone',
    invocation: {
      output_path: 'runtime/pr-descriptions/branch.md',
      artifact_paths: ['runtime/pr-descriptions/branch.md'],
    },
  })
  const standaloneRequirement = standalone.validation_requirements.find(
    (item) => item.registry_id === 'PR-DESCRIPTION-VALIDATE-001',
  )

  assert.equal(
    standaloneRequirement?.resolved_target,
    'runtime/pr-descriptions/branch.md',
  )
})

test('runRequirement fails closed on missing target', () => {
  const root = createFixture()
  const manifest = resolveRequirements(root, {
    persona: 'coder',
    workflow: 'delivery',
    stage: 'implement',
    invocation: { output_path: 'missing/output.json' },
  })
  const requirement = manifest.validation_requirements.find(
    (item) => item.registry_id === 'STAGE-OUTPUT-VALIDATE-002',
  )

  assert.ok(requirement)

  const result = runRequirement({
    root,
    requirement,
    targetPath: 'missing/output.json',
    executor: 'agent',
    persist: false,
  })

  assert.equal(result.status, 'failed')
  assert.equal(isPassingResult(result), false)

  // Once the target exists, the run records its checksum and executor.
  mkdirSync(path.dirname(path.join(root, 'missing/output.json')), {
    recursive: true,
  })
  writeFileSync(
    path.join(root, 'missing/output.json'),
    JSON.stringify({ schema_version: 1, result: 'success', criteria: [] }),
  )

  const present = runRequirement({
    root,
    requirement,
    targetPath: 'missing/output.json',
    executor: 'agent',
    persist: false,
  })

  assert.ok(present.target_checksum)
  assert.equal(present.executor, 'agent')
})

test('runRequirement validates a repository target without reading it as a file', () => {
  const root = createFixture()
  const manifest = resolveRequirements(root, {
    persona: 'coder',
    workflow: 'delivery',
    stage: 'implement',
    invocation_kind: 'workflow',
  })
  const requirement = manifest.validation_requirements.find(
    (item) => item.registry_id === 'QUESTION-TOOL-VALIDATE-001',
  )

  assert.ok(requirement)

  const result = runRequirement({
    root,
    requirement,
    targetPath: '.',
    executor: 'agent',
    persist: false,
  })

  assert.equal(result.status, 'passed')
  assert.equal(result.target_checksum, undefined)
})

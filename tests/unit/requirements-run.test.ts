import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  runRequirement,
  inferTargetKind,
  isPassingResult,
  isStaleTarget,
} from '../../src/lib/requirements/run.js'
import { resolveRequirements } from '../../src/lib/requirements/resolve.js'
import { isValidHandlerStatus } from '../../src/lib/requirements/types.js'
import { createFixture } from '../helpers.js'

test('runRequirement fails closed on missing target', () => {
  const root = createFixture()
  const manifest = resolveRequirements(root, {
    persona: 'coder',
    workflow: 'dev',
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
})

test('runRequirement records target checksum when target exists', () => {
  const root = createFixture()
  const outputPath = 'runtime/logs/workflows/x/outputs/y.json'

  mkdirSync(path.dirname(path.join(root, outputPath)), { recursive: true })
  writeFileSync(
    path.join(root, outputPath),
    JSON.stringify({ schema_version: 1, result: 'success', criteria: [] }),
  )

  const manifest = resolveRequirements(root, {
    persona: 'coder',
    workflow: 'dev',
    stage: 'implement',
    invocation: { output_path: outputPath },
  })
  const requirement = manifest.validation_requirements.find(
    (item) => item.registry_id === 'STAGE-OUTPUT-VALIDATE-002',
  )

  assert.ok(requirement)

  const result = runRequirement({
    root,
    requirement,
    targetPath: outputPath,
    executor: 'agent',
    persist: false,
  })

  assert.ok(result.target_checksum)
  assert.equal(result.executor, 'agent')
})

test('isStaleTarget detects checksum drift', () => {
  assert.equal(isStaleTarget('abc', 'abc'), false)
  assert.equal(isStaleTarget('abc', 'def'), true)
  assert.equal(isStaleTarget(undefined, 'def'), false)
})

test('isValidHandlerStatus rejects malformed handler statuses', () => {
  assert.equal(isValidHandlerStatus('passed'), true)
  assert.equal(isValidHandlerStatus('bogus'), false)
})

test('inferTargetKind recognizes HTML operator artifacts', () => {
  assert.equal(inferTargetKind('runtime/brief.html'), 'html-artifact')
})

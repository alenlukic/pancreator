import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  clearRegistryCache,
  loadRegistry,
} from '../../src/lib/requirements/registry.js'
import { registryAppliesToStage } from '../../src/lib/requirements/run.js'
import type { RequirementResultStatus } from '../../src/lib/types.js'
import { createTestTempDirectory } from '../temp.js'

test('validation result schema includes every supported status', () => {
  const schema = JSON.parse(
    readFileSync(
      path.join(process.cwd(), 'library/schemas/validation-result.schema.json'),
      'utf8',
    ),
  ) as { properties: { status: { enum: string[] } } }
  const supported: RequirementResultStatus[] = [
    'passed',
    'failed',
    'blocked',
    'invalid',
    'not_applicable',
  ]

  assert.deepEqual(schema.properties.status.enum, supported)
})

test('implementation claims registry applies to implement and remediate stages', () => {
  assert.equal(
    registryAppliesToStage('IMPLEMENTATION-CLAIMS-VALIDATE-001', 'implement'),
    true,
  )
  assert.equal(
    registryAppliesToStage('IMPLEMENTATION-CLAIMS-VALIDATE-001', 'remediate'),
    true,
  )
  assert.equal(
    registryAppliesToStage('IMPLEMENTATION-CLAIMS-VALIDATE-001', 'verify'),
    false,
  )
})

test('registry rejects duplicate ids', () => {
  // The loader reads only governance/registries/validation_registry.json, so a
  // bare temporary root is enough.
  const root = createTestTempDirectory('pan-registry-')
  const registryPath = path.join(
    root,
    'governance',
    'registries',
    'validation_registry.json',
  )
  const entry = {
    id: 'REQ-RESOLVE-001',
    kind: 'automation',
    version: '1',
    handler: 'req-resolve',
    input_contract: 'policy-context',
    result_schema: 'validation-result-v1',
    target_types: ['policy-context'],
    default_timeout_ms: 30000,
    deterministic: true,
    side_effect_free: true,
  }

  mkdirSync(path.dirname(registryPath), { recursive: true })
  writeFileSync(
    registryPath,
    `${JSON.stringify({ schema_version: 1, entries: [entry, { ...entry }] }, null, 2)}\n`,
  )

  assert.throws(() => loadRegistry(root), /Duplicate registry id/u)
  clearRegistryCache()
})

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  clearRegistryCache,
  loadRegistry,
} from '../../src/lib/requirements/registry.js'
import { createTestTempDirectory } from '../temp.js'

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

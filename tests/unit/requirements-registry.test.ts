import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { HANDLER_IDS } from '../../src/lib/requirements/handlers.js'
import {
  clearRegistryCache,
  loadRegistry,
  validateRegistry,
} from '../../src/lib/requirements/registry.js'
import { createFixture } from '../helpers.js'

test('registry loads and validates known handlers', () => {
  const root = createFixture()
  const catalog = loadRegistry(root)

  assert.ok(catalog.entries.size > 0)
  assert.equal(validateRegistry(catalog, HANDLER_IDS).length, 0)
})

test('registry rejects duplicate ids', () => {
  const root = createFixture()
  const registryPath = path.join(root, 'governance', 'validation_registry.json')
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
    entries: Array<{ id: string }>
  }

  registry.entries.push({ ...registry.entries[0], id: registry.entries[0].id })
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`)

  assert.throws(() => loadRegistry(root), /Duplicate registry id/u)
  clearRegistryCache()
})

test('registry cache returns the same catalog within one operation', () => {
  const root = createFixture()
  clearRegistryCache()

  const first = loadRegistry(root)
  const second = loadRegistry(root)

  assert.equal(first, second)
  clearRegistryCache()
})

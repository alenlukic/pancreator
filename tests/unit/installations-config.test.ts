import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { PanError } from '../../src/lib/errors.js'
import { readProjectConfig } from '../../src/lib/project-config.js'
import { createTestTempDirectory } from '../temp.js'

// `library/schemas/config.schema.json` publishes the installations contract and
// `assertInstallationsBlock` re-states it as hand-written invariants. Repository
// validation checks the tracked `config.json` instance against the schema, so
// nothing compares the published rules with the loader that enforces them at
// runtime. The cases below read every rule out of the schema and require the
// loader to reach the same verdict, which keeps one contract (TP-01) without
// re-encoding the schema's wording as a shape pin (TP-05, TP-06).

type InstallationsSchema = {
  type: string
  items: {
    required: string[]
    additionalProperties: boolean
    properties: {
      id: { pattern: string }
      path: { minLength: number; pattern: string }
    }
  }
}

function installationsSchema(): InstallationsSchema {
  const schema = JSON.parse(
    readFileSync(
      path.join(process.cwd(), 'library/schemas/config.schema.json'),
      'utf8',
    ),
  ) as { properties: { installations: InstallationsSchema } }

  return schema.properties.installations
}

function loaderAccepts(installations: unknown): boolean {
  const root = createTestTempDirectory('installations-config-')

  writeFileSync(
    path.join(root, 'config.json'),
    `${JSON.stringify({ schema_version: 1, installations }, null, 2)}\n`,
  )

  try {
    readProjectConfig(root)
    return true
  } catch (error) {
    assert.ok(error instanceof PanError)
    assert.equal(error.code, 'INVALID_PROJECT_CONFIG')
    return false
  }
}

const COMPLETE_ENTRY = { id: 'primary', path: '/srv/pancreator' }

test('the config schema installations rules decide the same entries as the loader', () => {
  const installations = installationsSchema()
  const idPattern = new RegExp(installations.items.properties.id.pattern, 'u')
  const pathRule = installations.items.properties.path
  const pathPattern = new RegExp(pathRule.pattern, 'u')

  assert.equal(installations.type, 'array')
  assert.equal(loaderAccepts({ primary: COMPLETE_ENTRY.path }), false)
  assert.equal(loaderAccepts([COMPLETE_ENTRY]), true)

  for (const key of installations.items.required) {
    const partial: Record<string, unknown> = { ...COMPLETE_ENTRY }
    delete partial[key]

    assert.equal(loaderAccepts([partial]), false, `entry without '${key}'`)
  }

  for (const id of [
    'primary',
    '0-second-root',
    'Primary',
    '-leading',
    'a_b',
    '',
  ]) {
    assert.equal(
      loaderAccepts([{ ...COMPLETE_ENTRY, id }]),
      idPattern.test(id),
      `id '${id}'`,
    )
  }

  // `pattern: ^/` already forces a non-empty string, so minLength decides no
  // path the pattern has not already decided. It still has to agree: a
  // minLength above 1 would make the schema reject a short absolute path the
  // loader accepts, so the bound is asserted rather than folded into the loop.
  assert.ok(pathRule.minLength <= 1)

  for (const target of [
    '/srv/pancreator',
    '/a',
    'srv/pancreator',
    './pancreator',
    '',
  ]) {
    assert.equal(
      loaderAccepts([{ ...COMPLETE_ENTRY, path: target }]),
      pathPattern.test(target),
      `path '${target}'`,
    )
  }
})

test('the config schema alone closes the installation entry object', () => {
  // The loader reads `id` and `path` and ignores every other key, so a typo in
  // `config.json` reaches an operator only through the schema's closed object.
  // The loader's tolerance is deliberately left unasserted: tightening it
  // later would be an improvement, and a test that pinned it would read as a
  // regression.
  const installations = installationsSchema()

  assert.equal(installations.items.additionalProperties, false)
})

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import type { HandlerInput } from '../../src/lib/requirements/types.js'
import { validateInterfaceSchema } from '../../src/lib/validators/interface-schema.js'
import { createTestTempDirectory } from '../fixture-template.js'

const SCHEMA_PATH = 'docs/interface-schema.json'
const SIGNATURE = '(provider: string) => Adapter'

function scratchRoot(): string {
  return createTestTempDirectory('interface-schema-')
}

function writeJson(root: string, relative: string, value: unknown): void {
  const absolute = path.join(root, relative)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`)
}

function input(
  root: string,
  targetPath: string,
  workflow = 'prototype-trace',
  stage = 'trace',
): HandlerInput {
  return {
    root,
    targetPath,
    requirement: {
      policy_id: 'TRACE-001',
      requirement_id: 'interface-schema-validate',
      registry_id: 'INTERFACE-SCHEMA-VALIDATE-001',
      arguments: {},
    },
    stage: { slug: stage },
    invocation: {
      workflow: { slug: workflow },
      stage: { slug: stage },
    },
  }
}

function matchingData(): Record<string, unknown> {
  return {
    skeletons: [
      {
        name: 'createAdapter',
        signature: SIGNATURE,
        path: 'src/adapter.ts',
        expected_input: 'provider id',
        expected_output: 'Adapter',
        stub: 'not implemented',
      },
    ],
    trace_tests: [
      {
        id: 'TT-e2e',
        path: 'tests/integration/adapter-trace.test.ts',
        kind: 'e2e',
      },
    ],
    interface_schema: {
      path: SCHEMA_PATH,
      idiom: 'exported-types',
      notes: 'Fixture adapter contract.',
    },
  }
}

function writeMatchingSchema(root: string): void {
  mkdirSync(path.join(root, 'src'), { recursive: true })
  mkdirSync(path.join(root, 'tests/integration'), { recursive: true })
  writeFileSync(
    path.join(root, 'src/adapter.ts'),
    'export function createAdapter(provider: string) { return { provider } }\n',
  )
  writeFileSync(
    path.join(root, 'tests/integration/adapter-trace.test.ts'),
    'import test from "node:test"\ntest("fixture", () => {})\n',
  )
  writeJson(root, SCHEMA_PATH, {
    interfaces: [{ name: 'createAdapter', signature: SIGNATURE }],
    notes: 'Fixture adapter contract.',
  })
}

test('validateInterfaceSchema passes a matching schema file', () => {
  const root = scratchRoot()
  const targetPath = 'runtime/logs/workflows/run-1/agent/trace.json'

  writeMatchingSchema(root)
  writeJson(root, targetPath, { schema_version: 1, data: matchingData() })

  const result = validateInterfaceSchema(input(root, targetPath))

  assert.equal(result.status, 'passed')
  assert.deepEqual(result.issues, [])
})

test('validateInterfaceSchema reports each missing metadata field with its canonical code', () => {
  const root = scratchRoot()
  const targetPath = 'runtime/logs/workflows/run-1/agent/trace.json'
  const data = matchingData()

  data.interface_schema = {}
  writeMatchingSchema(root)
  writeJson(root, targetPath, { schema_version: 1, data })

  const result = validateInterfaceSchema(input(root, targetPath))

  assert.equal(result.status, 'failed')
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ['schema.meta_path', 'schema.meta_idiom', 'schema.meta_notes'],
  )
})

test('validateInterfaceSchema reports drift when claimed signatures diverge', () => {
  const root = scratchRoot()
  const targetPath = 'runtime/logs/workflows/run-1/agent/trace.json'
  const data = matchingData()
  const skeletons = data.skeletons as Array<Record<string, unknown>>

  skeletons[0]!.signature = '() => Adapter'
  writeMatchingSchema(root)
  writeJson(root, targetPath, { schema_version: 1, data })

  const result = validateInterfaceSchema(input(root, targetPath))

  assert.equal(result.status, 'failed')
  assert.ok(result.issues.some((issue) => issue.code === 'schema.drift'))
})

test('validateInterfaceSchema refuses a missing end-to-end path', () => {
  const root = scratchRoot()
  const targetPath = 'runtime/logs/workflows/run-1/agent/trace.json'
  const data = matchingData()
  const tests = data.trace_tests as Array<Record<string, unknown>>

  tests[0]!.kind = 'unit'
  writeMatchingSchema(root)
  writeJson(root, targetPath, { schema_version: 1, data })

  const result = validateInterfaceSchema(input(root, targetPath))

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some((issue) => issue.code === 'schema.trace_test_e2e'),
  )
})

test('validateInterfaceSchema skips other workflows', () => {
  const root = scratchRoot()
  const result = validateInterfaceSchema(
    input(root, 'missing.json', 'prototype', 'evaluate'),
  )

  assert.equal(result.status, 'passed')
  assert.deepEqual(result.issues, [])
})

test('trace schema resolves in the run workspace, not the harness root', () => {
  const root = scratchRoot()
  const workspace = scratchRoot()
  const targetPath = 'runtime/logs/workflows/run-1/agent/trace.json'
  writeJson(root, targetPath, { schema_version: 1, data: matchingData() })
  writeMatchingSchema(workspace)
  // The harness root has a different contract at the same path.
  writeJson(root, SCHEMA_PATH, {
    interfaces: [{ name: 'other', signature: '() => void' }],
  })
  const result = validateInterfaceSchema({
    ...input(root, targetPath),
    runState: { workspace_root: workspace },
  })
  assert.equal(result.status, 'passed')
  assert.deepEqual(result.issues, [])
})

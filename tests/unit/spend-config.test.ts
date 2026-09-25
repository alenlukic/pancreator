/**
 * Unit tests for spend.vercel_host validation and normalization (AC-1).
 */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import {
  readProjectConfig,
  resolveSpendSyncOrigin,
} from '../../src/lib/project-config.js'
import type { ProjectConfig } from '../../src/lib/types.js'
import { createTestTempDirectory } from '../temp.js'

interface CodedError {
  code: string
}

function hasCode(err: unknown): err is CodedError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as Record<string, unknown>).code === 'string'
  )
}

function assertThrowsCode(fn: () => unknown, code: string): void {
  try {
    fn()
    assert.fail(`Expected a throw with code ${code}`)
  } catch (err) {
    assert.ok(hasCode(err), `Expected a coded error, got: ${err}`)
    assert.equal((err as CodedError).code, code)
  }
}

function configWith(vercel_host: string | undefined): ProjectConfig {
  return {
    schema_version: 1,
    spend: vercel_host !== undefined ? { vercel_host } : {},
  }
}

test('spend.vercel_host accepts a bare host, an https origin, and a loopback http origin', () => {
  // Bare host → normalized to https://
  assert.equal(
    resolveSpendSyncOrigin(configWith('pan-spend.vercel.app')),
    'https://pan-spend.vercel.app',
  )

  // https origin with trailing slash → trailing slash stripped
  assert.equal(
    resolveSpendSyncOrigin(configWith('https://pan-spend.vercel.app/')),
    'https://pan-spend.vercel.app',
  )

  // https with port
  assert.equal(
    resolveSpendSyncOrigin(configWith('https://pan-spend.vercel.app:8443')),
    'https://pan-spend.vercel.app:8443',
  )

  // http loopback (for tests)
  assert.equal(
    resolveSpendSyncOrigin(configWith('http://127.0.0.1:3000')),
    'http://127.0.0.1:3000',
  )

  assert.equal(
    resolveSpendSyncOrigin(configWith('http://localhost:3001')),
    'http://localhost:3001',
  )

  assert.equal(
    resolveSpendSyncOrigin(configWith('http://[::1]:3002/')),
    'http://[::1]:3002',
  )
})

test('config load rejects an empty, non-string, or insecure spend.vercel_host and accepts an absent spend block', () => {
  const root = createTestTempDirectory('spend-config-')
  const load = (spend: unknown): unknown => {
    writeFileSync(
      path.join(root, 'config.json'),
      `${JSON.stringify(
        spend === undefined
          ? { schema_version: 1 }
          : { schema_version: 1, spend },
      )}\n`,
    )

    return readProjectConfig(root)
  }

  assert.deepEqual(load(undefined), { schema_version: 1 })
  assert.deepEqual(load({ vercel_host: 'pan-spend.vercel.app' }), {
    schema_version: 1,
    spend: { vercel_host: 'pan-spend.vercel.app' },
  })

  for (const vercel_host of ['', 42, 'http://pan-spend.vercel.app']) {
    assertThrowsCode(() => load({ vercel_host }), 'INVALID_PROJECT_CONFIG')
  }
})

test('spend.vercel_host rejects insecure, pathful, and non-string values', () => {
  // Non-loopback http
  assertThrowsCode(
    () => resolveSpendSyncOrigin(configWith('http://pan-spend.vercel.app')),
    'INVALID_PROJECT_CONFIG',
  )

  // Path in host
  assertThrowsCode(
    () =>
      resolveSpendSyncOrigin(configWith('https://pan-spend.vercel.app/api')),
    'INVALID_PROJECT_CONFIG',
  )

  // Query string
  assertThrowsCode(
    () =>
      resolveSpendSyncOrigin(
        configWith('https://pan-spend.vercel.app?foo=bar'),
      ),
    'INVALID_PROJECT_CONFIG',
  )

  // Fragment
  assertThrowsCode(
    () =>
      resolveSpendSyncOrigin(
        configWith('https://pan-spend.vercel.app#section'),
      ),
    'INVALID_PROJECT_CONFIG',
  )

  // Credentials in URL
  assertThrowsCode(
    () =>
      resolveSpendSyncOrigin(
        configWith('https://user:pass@pan-spend.vercel.app'),
      ),
    'INVALID_PROJECT_CONFIG',
  )

  // Empty string — resolveSpendSyncOrigin fails with SPEND_SYNC_HOST_MISSING
  assertThrowsCode(
    () => resolveSpendSyncOrigin(configWith('')),
    'SPEND_SYNC_HOST_MISSING',
  )

  // Absent spend block → SPEND_SYNC_HOST_MISSING
  assertThrowsCode(
    () => resolveSpendSyncOrigin({ schema_version: 1 }),
    'SPEND_SYNC_HOST_MISSING',
  )

  // Null config → SPEND_SYNC_HOST_MISSING
  assertThrowsCode(
    () => resolveSpendSyncOrigin(null),
    'SPEND_SYNC_HOST_MISSING',
  )
})

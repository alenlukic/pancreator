/**
 * Tests for AC-15, AC-16, AC-18: helper binary path, refusal codes, and
 * platform check.
 *
 * AC-15: pan doctor readiness block carries platform, swiftc, digest/build state,
 *        Cursor running, Agents window, Accessibility — and never fails doctor.
 * AC-16: Helper ships as Swift source; compiled path is digest-keyed;
 *        HANDOFF_HELPER_UNAVAILABLE and HANDOFF_HELPER_BUILD_FAILED work.
 * AC-18: Off macOS → HANDOFF_UNSUPPORTED_PLATFORM; doctor reports
 *        platform_supported: false.
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  ensureHelper,
  helperBinaryRelative,
  helperPreflight,
  SWIFT_SOURCE_RELATIVE,
} from '../../src/lib/cursor-handoff/helper.js'
import {
  cursorHandoffReadiness,
  cursorProcessListed,
} from '../../src/lib/cursor-handoff/readiness.js'
import { PanError } from '../../src/lib/errors.js'
import { createTestTempDirectory } from '../temp.js'

// ---------------------------------------------------------------------------
// AC-16: Digest-keyed binary path
// ---------------------------------------------------------------------------

test('AC-16: helperBinaryRelative produces a path containing the first 16 hex chars', () => {
  const digest = 'abcdef1234567890' + 'x'.repeat(48)
  const rel = helperBinaryRelative(digest)
  assert.ok(
    rel.includes('abcdef1234567890'),
    'path must include first 16 hex chars',
  )
  assert.ok(
    rel.startsWith('runtime/cache/native/'),
    'path must be under runtime/cache/native/',
  )
})

test('AC-16: SWIFT_SOURCE_RELATIVE points to src/native/cursor-handoff.swift', () => {
  assert.equal(SWIFT_SOURCE_RELATIVE, 'src/native/cursor-handoff.swift')
})

test('AC-16: ensureHelper throws HANDOFF_UNSUPPORTED_PLATFORM on non-macOS', () => {
  const tmpRoot = createTestTempDirectory('pancreator-helper-platform-')

  assert.throws(
    () => ensureHelper(tmpRoot, { platform: 'linux' }),
    (err: unknown) => {
      assert.ok(err instanceof Error)
      const e = err as { code?: string }
      assert.equal(e.code, 'HANDOFF_UNSUPPORTED_PLATFORM')
      return true
    },
  )
})

test('AC-16: ensureHelper without a built helper or swiftc refuses with HANDOFF_HELPER_UNAVAILABLE', () => {
  const tmpRoot = createTestTempDirectory('pancreator-helper-avail-')
  const srcDir = path.join(tmpRoot, 'src', 'native')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(path.join(srcDir, 'cursor-handoff.swift'), '// test\n')

  assert.throws(
    () => ensureHelper(tmpRoot, { platform: 'darwin', swiftcPath: null }),
    (err: unknown) =>
      err instanceof PanError && err.code === 'HANDOFF_HELPER_UNAVAILABLE',
  )
})

test('AC-18: doctor readiness off macOS is advisory and skips the Cursor checks', () => {
  const tmpRoot = createTestTempDirectory('pancreator-readiness-linux-')
  const readiness = cursorHandoffReadiness(tmpRoot, { platform: 'linux' })

  assert.equal(readiness.platform_supported, false)
  assert.equal(readiness.accessibility_trusted, null)
  assert.equal(readiness.agents_window_present, null)
  assert.match(readiness.advisories.join('\n'), /macOS only/u)
})

test('AC-15: the Cursor process check matches the bundle executable path', () => {
  assert.equal(
    cursorProcessListed(
      '/sbin/launchd\n/Applications/Cursor.app/Contents/MacOS/Cursor\n',
    ),
    true,
  )
  assert.equal(
    cursorProcessListed(
      '/Applications/Cursor.app/Contents/Frameworks/Cursor Helper.app/Contents/MacOS/Cursor Helper\n',
    ),
    false,
  )
})

// ---------------------------------------------------------------------------
// AC-15, AC-18: Doctor preflight
// ---------------------------------------------------------------------------

test('AC-18: helperPreflight returns platform_supported: false on non-macOS', () => {
  const tmpRoot = createTestTempDirectory('pancreator-helper-preflight-linux-')
  const result = helperPreflight(tmpRoot, { platform: 'linux' })

  assert.equal(result.platform_supported, false)
  assert.equal(result.swiftc_path, null)
  assert.equal(result.source_digest, null)
  assert.equal(result.binary_built, false)
  assert.equal(result.binary_path, null)
})

test('AC-15: helperPreflight returns platform_supported: true on macOS', () => {
  const tmpRoot = createTestTempDirectory('pancreator-helper-preflight-mac-')

  // Write the Swift source so helperPreflight can compute a digest
  const srcDir = path.join(tmpRoot, 'src', 'native')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(path.join(srcDir, 'cursor-handoff.swift'), '// test\n')

  const result = helperPreflight(tmpRoot, { platform: 'darwin' })

  assert.equal(result.platform_supported, true)
  // Source digest should be a 16-char hex prefix
  assert.ok(
    typeof result.source_digest === 'string' &&
      result.source_digest.length === 16,
    'source_digest must be 16 hex chars',
  )
  // Binary is not built yet (no compile was attempted)
  assert.equal(result.binary_built, false)
})

test('AC-15: helperPreflight returns binary_built: true when binary exists', () => {
  const tmpRoot = createTestTempDirectory('pancreator-helper-preflight-built-')

  // Write Swift source
  const srcDir = path.join(tmpRoot, 'src', 'native')
  mkdirSync(srcDir, { recursive: true })
  const sourceText = '// test source\n'
  writeFileSync(path.join(srcDir, 'cursor-handoff.swift'), sourceText)

  // Compute the expected digest and create a fake binary
  const digest = createHash('sha256').update(sourceText).digest('hex')
  const cacheDir = path.join(tmpRoot, 'runtime', 'cache', 'native')
  mkdirSync(cacheDir, { recursive: true })
  const binaryRel = helperBinaryRelative(digest)
  const binaryAbs = path.join(tmpRoot, binaryRel)
  writeFileSync(binaryAbs, '#!/bin/sh\n')

  const result = helperPreflight(tmpRoot, { platform: 'darwin' })

  assert.equal(result.binary_built, true)
  assert.ok(result.binary_path?.includes(digest.slice(0, 16)))
})

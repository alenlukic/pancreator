import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { auditTestScratchDirectories } from '../../src/lib/test-scratch-audit.js'
import { createTestTempDirectory } from '../temp.js'

// This file is itself under tests/, so the forbidden call is assembled at
// run time rather than written out, or the audit would flag these lines.
const SHARED_TEMP = ['tmp', 'dir'].join('')
const SHARED_TEMP_CALL = `${SHARED_TEMP}()`

function rejection(relative: string, line: number): string {
  return `${relative}:${line} allocates in the shared temp directory with ${SHARED_TEMP_CALL}; use createTestTempDirectory from tests/temp.ts`
}

function writeTestSource(root: string, relative: string, body: string): void {
  const file = path.join(root, relative)

  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, body)
}

test('the scratch audit rejects the shared temp call outside the sanctioned helper', () => {
  const root = createTestTempDirectory('scratch-audit-')

  // The helper owns the one permitted call.
  writeTestSource(
    root,
    'tests/temp.ts',
    `import { ${SHARED_TEMP} } from 'node:os'\nexport const parent = ${SHARED_TEMP_CALL}\n`,
  )
  // Both spellings of the shared temp call are leaks.
  writeTestSource(
    root,
    'tests/unit/leaky.test.ts',
    [
      `import { ${SHARED_TEMP} } from 'node:os'`,
      "import os from 'node:os'",
      `const a = mkdtempSync(path.join(${SHARED_TEMP_CALL}, 'pan-a-'))`,
      `const b = mkdtempSync(path.join(os.${SHARED_TEMP_CALL}, 'pan-b-'))`,
      '',
    ].join('\n'),
  )
  // A fixture created through the helper is fine, as is a nested mkdtemp
  // inside a fixture the helper already placed.
  writeTestSource(
    root,
    'tests/unit/clean.test.ts',
    [
      "import { createTestTempDirectory } from '../temp.js'",
      "const root = createTestTempDirectory('pan-clean-')",
      "const inner = mkdtempSync(path.join(root, 'inner-'))",
      '',
    ].join('\n'),
  )

  assert.deepEqual(auditTestScratchDirectories(root).errors, [
    rejection('tests/unit/leaky.test.ts', 3),
    rejection('tests/unit/leaky.test.ts', 4),
  ])
})

test('the scratch audit passes a root with no test sources', () => {
  const root = createTestTempDirectory('scratch-audit-empty-')

  assert.deepEqual(auditTestScratchDirectories(root).errors, [])
})

test('this repository passes its own scratch audit', () => {
  assert.deepEqual(auditTestScratchDirectories(process.cwd()).errors, [])
})

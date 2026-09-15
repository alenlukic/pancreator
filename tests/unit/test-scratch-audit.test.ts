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
const RUN_CONSTRUCTION_CALL = `${['create', 'Run'].join('')}({})`
const CHILD_PROCESS_MODULE = `node:${['child', 'process'].join('_')}`
const CHECKPOINT_CALL = `${['check', 'point'].join('')}()`
const WRITABLE_FIXTURE_CALL = `${['create', 'Fixture'].join('')}()`

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

  // A root with no test sources at all is nothing to report.
  assert.deepEqual(
    auditTestScratchDirectories(createTestTempDirectory('scratch-audit-empty-'))
      .errors,
    [],
  )
})

test('the structural audit rejects new hand-driven runs and unit process fixtures', () => {
  const root = createTestTempDirectory('test-structure-audit-')

  writeTestSource(
    root,
    'tests/integration/new-driver.test.ts',
    `const run = ${RUN_CONSTRUCTION_CALL}\n`,
  )
  writeTestSource(
    root,
    'tests/unit/new-process.test.ts',
    `import { spawn } from '${CHILD_PROCESS_MODULE}'\nvoid spawn\n`,
  )
  // The other half of the lane rule: a writable fixture is as much a lane
  // crossing as a subprocess, and a clone of a driven run is the same cost.
  writeTestSource(
    root,
    'tests/unit/new-fixture.test.ts',
    `const root = ${WRITABLE_FIXTURE_CALL}\nvoid root\n`,
  )
  writeTestSource(
    root,
    'tests/unit/new-clone.test.ts',
    `const run = ${CHECKPOINT_CALL}\nvoid run\n`,
  )
  writeTestSource(
    root,
    'tests/unit/read-only.test.ts',
    'const root = sharedFixture()\nvoid root\n',
  )

  const laneRejection = (relative: string): string =>
    `${relative} crosses the unit-lane boundary with a subprocess or writable fixture; move it to tests/integration or use sharedFixture() for read-only access`

  assert.deepEqual(auditTestScratchDirectories(root).errors, [
    `tests/integration/new-driver.test.ts constructs or prepares a run without cloning a checkpoint; use ${CHECKPOINT_CALL} from tests/integration/delivery-helpers.ts or add a reviewed allowlist entry`,
    laneRejection('tests/unit/new-clone.test.ts'),
    laneRejection('tests/unit/new-fixture.test.ts'),
    laneRejection('tests/unit/new-process.test.ts'),
  ])
  assert.deepEqual(auditTestScratchDirectories(process.cwd()).errors, [])
})

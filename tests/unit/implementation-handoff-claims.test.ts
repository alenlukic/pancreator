import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { validateImplementationClaims } from '../../src/lib/validators/stage/claims.js'
import { createTestTempDirectory } from '../temp.js'

const CONTRACT = 'library/schemas/stage-output-requirements.json'

function claims(handoff: unknown): string[] {
  const root = createTestTempDirectory('pan-handoff-claims-')

  mkdirSync(path.join(root, 'library/schemas'), { recursive: true })
  writeFileSync(
    path.join(root, CONTRACT),
    readFileSync(path.join(process.cwd(), CONTRACT)),
  )
  writeFileSync(
    path.join(root, 'output.json'),
    `${JSON.stringify({
      data: {
        implementation: {
          changed_files: [],
          tests_added: [],
          notes: [],
          ...(handoff === undefined ? {} : { handoff }),
        },
        acceptance_results: [
          { id: 'AC-01', result: 'pass', evidence: ['verified'] },
        ],
      },
    })}\n`,
  )

  return validateImplementationClaims({
    root,
    targetPath: 'output.json',
    invocation: { attempt: 1 },
    requirement: {
      policy_id: 'DEV-001',
      requirement_id: 'implementation-claims',
      registry_id: 'IMPLEMENTATION-CLAIMS-VALIDATE-001',
      arguments: {},
    },
  }).issues.map((entry) => entry.code)
}

test('handoff notes are optional and a usable set passes', () => {
  assert.ok(
    !claims(undefined).some((code) =>
      code.startsWith('implementation.handoff'),
    ),
  )
  assert.deepEqual(
    claims({
      start_here: [{ path: 'src/lib/io.ts', why: 'the parser' }],
      decisions: ['Kept the thrown error code.'],
      untested: [],
      symbols_changed: [],
    }).filter((code) => code.startsWith('implementation.handoff')),
    [],
  )
})

test('a handoff entry without a path, or a changed symbol outside changed_files, is refused', () => {
  const codes = claims({
    start_here: [{ why: 'no path' }],
    decisions: [''],
    symbols_changed: [{ path: 'src/lib/io.ts', symbol: 'readJson' }],
  })

  assert.equal(
    codes.filter((code) => code === 'implementation.handoff_shape').length,
    2,
  )
  assert.ok(codes.includes('implementation.handoff_unclaimed'))
  assert.deepEqual(
    claims('notes').filter((code) => code.startsWith('implementation.handoff')),
    ['implementation.handoff_shape'],
  )
})

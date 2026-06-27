import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createFixture } from '../helpers.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

test('requirements run validates a standalone decomposition artifact', () => {
  const root = createFixture()
  const targetPath = 'runtime/inbox/decomposition.md'

  writeFileSync(
    path.join(root, targetPath),
    `# Scope decomposition

## Decision

retain

## Scope summary

One coherent outcome.

## Threshold assessment

The independence gate does not justify a split. No hard trigger and only one pressure indicator apply. File count is not controlling.

## Fragmentation economics

Workflow overhead exceeds the expected risk reduction.

## Requirement traceability

All scope remains in the retained intake.

## Retained intake spec

Implement the request as one systematic run.

## Risks and unknowns

None.

## Next action

Run /pan-start.
`,
  )

  const stdout = execFileSync(
    process.execPath,
    [
      CLI,
      'requirements',
      'run',
      '--persona',
      'decomposer',
      '--workflow',
      'standalone',
      '--stage',
      'decompose',
      '--kind',
      'decomposition',
      '--registry',
      'DECOMPOSITION-VALIDATE-001',
      '--target',
      targetPath,
      '--json',
    ],
    { cwd: root, encoding: 'utf8' },
  )
  const result = JSON.parse(stdout) as { status: string; exit_code: number }

  assert.equal(result.status, 'passed')
  assert.equal(result.exit_code, 0)
})

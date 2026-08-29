import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { resolveTargetInstructionPaths } from '../../src/lib/target-instructions.js'

function fixture(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pan-target-instructions-'))

  writeFileSync(path.join(root, 'AGENTS.md'), '# Root\n')
  mkdirSync(path.join(root, 'apps', 'web', 'src'), { recursive: true })
  writeFileSync(path.join(root, 'apps', 'AGENTS.md'), '# Apps\n')
  writeFileSync(path.join(root, 'apps', 'web', 'AGENTS.md'), '# Web\n')
  mkdirSync(path.join(root, 'services', 'api'), { recursive: true })
  writeFileSync(path.join(root, 'services', 'AGENTS.md'), '# Services\n')

  return root
}

test('resolves exact root-to-file instruction chains across subtrees', () => {
  const root = fixture()

  assert.deepEqual(
    resolveTargetInstructionPaths(root, [
      'services/api/deleted.ts',
      'apps/web/src/renamed.ts',
      'apps/web/src/renamed.ts',
    ]),
    ['AGENTS.md', 'apps/AGENTS.md', 'services/AGENTS.md', 'apps/web/AGENTS.md'],
  )

  // Absolute in-workspace paths resolve their chains like relative ones.
  assert.deepEqual(
    resolveTargetInstructionPaths(root, [
      path.join(root, 'apps', 'web', 'src', 'file.ts'),
    ]),
    ['AGENTS.md', 'apps/AGENTS.md', 'apps/web/AGENTS.md'],
  )

  // Paths outside the workspace contribute no instruction chain.
  assert.deepEqual(resolveTargetInstructionPaths(root, ['../outside.ts']), [])
  assert.deepEqual(
    resolveTargetInstructionPaths(root, [
      '/somewhere/else/entirely.ts',
      'services/api/handler.ts',
    ]),
    ['AGENTS.md', 'services/AGENTS.md'],
  )

  // Empty changed paths are rejected.
  assert.throws(
    () => resolveTargetInstructionPaths(root, ['']),
    (error: unknown) =>
      error instanceof Error && error.message.includes('non-empty'),
  )
})

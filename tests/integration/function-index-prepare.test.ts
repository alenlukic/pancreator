import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { getRunState } from '../../src/lib/engine/run-status.js'
import { checkpoint } from './delivery-helpers.js'

test('preparing a stage in a self-development checkout writes a gitignored function index of the run workspace', () => {
  const { root, runId } = checkpoint('delivery@implement-prepared')
  const state = getRunState(root, runId)
  const workspace = path.resolve(root, state.workspace_root || '.')
  const readme = path.join(workspace, 'docs', 'function-index', 'README.md')

  assert.ok(existsSync(readme), 'prepare wrote the module map')
  assert.match(readFileSync(readme, 'utf8'), /# Function index/u)

  // The pages are ignored, so they never enter the workspace fingerprint or
  // a stage's changed-file claims.
  const status = execFileSync(
    'git',
    ['status', '--porcelain', '--', 'docs/function-index'],
    { cwd: workspace, encoding: 'utf8' },
  )

  assert.equal(status.trim(), '')
})

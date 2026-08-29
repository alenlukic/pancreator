import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { detectRunLayout, resolveRunLayout } from '../../src/lib/run-layout.js'

function fixture(): { root: string; runId: string; runRoot: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pan-run-layout-'))
  const runId = '63327_Aug-13-1079_deadbeef'
  const runRoot = path.join(root, 'runtime', 'logs', 'workflows', runId)

  mkdirSync(runRoot, { recursive: true })

  return { root, runId, runRoot }
}

test('new runs resolve to the split agent and operator layout', () => {
  const { root, runId } = fixture()
  const layout = resolveRunLayout(root, runId)

  assert.equal(layout.version, 'v2')
  assert.equal(
    layout.state.relative,
    `runtime/logs/workflows/${runId}/agent/state.json`,
  )
  assert.equal(
    layout.operatorHtml('97_implement-1_abcd1234').relative,
    `runtime/logs/workflows/${runId}/operator/97_implement-1_abcd1234.html`,
  )
})

test('legacy runs keep root-level machine and artifacts paths', () => {
  const { root, runId, runRoot } = fixture()

  writeFileSync(path.join(runRoot, 'state.json'), '{}\n')

  assert.equal(detectRunLayout(root, runId), 'v1')

  const layout = resolveRunLayout(root, runId)

  assert.equal(
    layout.output('97_implement-1_abcd1234').relative,
    `runtime/logs/workflows/${runId}/outputs/97_implement-1_abcd1234.json`,
  )
  assert.equal(
    layout.operatorHtml('97_implement-1_abcd1234').relative,
    `runtime/logs/workflows/${runId}/artifacts/html/97_implement-1_abcd1234.html`,
  )

  const partial = fixture()

  mkdirSync(path.join(partial.runRoot, 'outputs'))

  assert.equal(detectRunLayout(partial.root, partial.runId), 'v1')

  mkdirSync(path.join(runRoot, 'agent'), { recursive: true })
  writeFileSync(path.join(runRoot, 'agent', 'state.json'), '{}\n')

  assert.equal(detectRunLayout(root, runId), 'v2')
})

import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  syncCursorProjection,
  validateProjectionDrift,
} from '../../src/lib/projection.js'
import { loadPipelineConfig } from '../../src/lib/pipeline-config.js'
import { createFixture } from '../helpers.js'

test('projection drift validation runs on fixture repository', () => {
  const root = createFixture()
  const result = validateProjectionDrift(root)

  assert.equal(typeof result.regeneration_command, 'string')
  assert.deepEqual(result.errors, [])
})

test('repository validation does not require a local Cursor projection', () => {
  const root = createFixture()

  rmSync(path.join(root, '.cursor'), { recursive: true, force: true })

  const result = validateProjectionDrift(root)

  assert.deepEqual(result.errors, [])
})

test('Cursor sync renders ignored local files from canonical library sources', () => {
  const root = createFixture()
  const agentPath = path.join(root, '.cursor', 'agents', 'coder.md')
  const sourcePath = path.join(root, 'library', 'cursor', 'agents', 'coder.md')
  const activeModel = loadPipelineConfig(root).config.personas.coder
  const stale = readFileSync(agentPath, 'utf8').replace(
    /^model:.*$/mu,
    'model: intentionally-wrong',
  )

  writeFileSync(agentPath, stale)

  const preview = syncCursorProjection(root)
  const coder = preview.find((entry) => entry.path.endsWith('/coder.md'))

  assert.equal(coder?.id, 'cursor-agents')
  assert.equal(coder?.changed, true)

  syncCursorProjection(root, { write: true })

  assert.match(
    readFileSync(agentPath, 'utf8'),
    new RegExp(
      `^model: ${activeModel.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`,
      'mu',
    ),
  )
  assert.match(readFileSync(sourcePath, 'utf8'), /__PANCREATOR_MODEL__/u)
})

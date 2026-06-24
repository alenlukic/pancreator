import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  loadPipelineConfig,
  makePipelineConfigSnapshot,
  parsePipelineConfig,
  resolvePersonaModel,
  syncCursorAgentModels,
} from '../../src/lib/pipeline-config.js'
import { createFixture } from '../helpers.js'

test('pipeline config loads the active named persona mapping', () => {
  const root = createFixture()
  const loaded = loadPipelineConfig(root)

  assert.equal(loaded.name, 'default')
  assert.equal(
    resolvePersonaModel(loaded.config, 'coder'),
    'composer-2.5[fast=false]',
  )

  const snapshot = makePipelineConfigSnapshot(loaded)

  assert.equal(snapshot.name, 'default')
  assert.equal(snapshot.personas.reviewer, loaded.config.personas.reviewer)
})

test('pipeline config rejects an undefined active config', () => {
  assert.throws(
    () =>
      parsePipelineConfig({
        schema_version: 1,
        active_config: 'missing',
        configs: {
          default: { personas: { coder: 'auto' } },
        },
      }),
    /active_config 'missing' is not defined/u,
  )
})

test('cursor agent sync projects the active mapping into frontmatter', () => {
  const root = createFixture()
  const loaded = loadPipelineConfig(root)
  const agentPath = path.join(root, '.cursor', 'agents', 'coder.md')
  const raw = readFileSync(agentPath, 'utf8')

  writeFileSync(
    agentPath,
    raw.replace(/^model:.*$/mu, 'model: intentionally-wrong'),
  )

  const preview = syncCursorAgentModels(root, loaded)
  const coderPreview = preview.find((entry) => entry.persona === 'coder')

  assert.equal(coderPreview?.changed, true)
  assert.equal(coderPreview?.previous_model, 'intentionally-wrong')

  syncCursorAgentModels(root, loaded, { write: true })

  assert.match(
    readFileSync(agentPath, 'utf8'),
    /^model: composer-2\.5\[fast=false\]$/mu,
  )
})

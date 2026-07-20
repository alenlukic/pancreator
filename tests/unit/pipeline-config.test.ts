import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  loadPipelineConfig,
  makePipelineConfigSnapshot,
  parsePipelineConfig,
  resolveConfigPersonas,
  resolvePersonaModel,
} from '../../src/lib/pipeline-config.js'
import { createFixture } from '../helpers.js'

test('pipeline config loads the active named persona mapping', () => {
  const root = createFixture()
  const loaded = loadPipelineConfig(root)
  const config = JSON.parse(
    readFileSync(path.join(root, 'project.json'), 'utf8'),
  ) as { active_config: string }

  assert.equal(loaded.name, config.active_config)
  assert.equal(
    resolvePersonaModel(loaded.config, 'coder'),
    loaded.config.personas.coder,
  )

  const snapshot = makePipelineConfigSnapshot(loaded)

  assert.equal(snapshot.name, loaded.name)
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

test('pipeline config merges defaults with config-specific persona overrides', () => {
  const file = parsePipelineConfig({
    schema_version: 1,
    active_config: 'default',
    defaults: {
      orchestrator: 'default-orchestrator',
      coder: 'default-coder',
    },
    configs: {
      default: {
        personas: {
          coder: 'override-coder',
        },
      },
    },
  })

  assert.deepEqual(resolveConfigPersonas(file, 'default'), {
    orchestrator: 'default-orchestrator',
    coder: 'override-coder',
  })
})

test('pipeline config falls back to defaults for omitted config personas', () => {
  const file = parsePipelineConfig({
    schema_version: 1,
    active_config: 'default',
    defaults: {
      investigator: 'default-investigator',
    },
    configs: {
      default: {
        personas: {},
      },
    },
  })

  assert.equal(
    resolveConfigPersonas(file, 'default').investigator,
    'default-investigator',
  )
})

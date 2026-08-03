import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
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
    readFileSync(path.join(root, 'config.json'), 'utf8'),
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

test('every named configuration resolves a model for the intake writer', () => {
  const root = createFixture()
  const { file } = loadPipelineConfig(root)

  assert.ok(file.defaults['intake-writer'])

  // A persona no named configuration overrides must still resolve everywhere,
  // or selecting that configuration blocks run creation.
  for (const name of Object.keys(file.configs)) {
    assert.equal(
      resolveConfigPersonas(file, name)['intake-writer'],
      file.defaults['intake-writer'],
    )
  }
})

test('config.local.json preferences override the checked-in pipeline config', () => {
  const root = createFixture()
  const base = loadPipelineConfig(root)

  writeFileSync(
    path.join(root, 'config.local.json'),
    JSON.stringify({
      active_config: 'complex',
      defaults: { orchestrator: 'local-orchestrator[]' },
    }),
  )

  const loaded = loadPipelineConfig(root)

  assert.equal(loaded.name, 'complex')
  assert.equal(loaded.config.personas.orchestrator, 'local-orchestrator[]')
  // A preference the local file does not name still comes from config.json.
  assert.equal(loaded.config.personas.reviewer, loaded.file.defaults.reviewer)
  // The digest covers the effective configuration, so the local preference is
  // visible to drift detection exactly like a config.json edit.
  assert.notEqual(loaded.sha256, base.sha256)
})

test('a config.local.json that is not an object is rejected', () => {
  const root = createFixture()

  writeFileSync(
    path.join(root, 'config.local.json'),
    JSON.stringify(['active_config']),
  )

  assert.throws(() => loadPipelineConfig(root), /MUST contain an object/u)
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

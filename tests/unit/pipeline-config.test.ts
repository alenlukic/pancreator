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
      defaults: { orchestrator: 'gpt-5.4[effort=low]' },
    }),
  )

  const loaded = loadPipelineConfig(root)
  const expectedReviewer = resolveConfigPersonas(base.file, 'complex').reviewer

  assert.equal(loaded.name, 'complex')
  assert.equal(loaded.config.personas.orchestrator, 'gpt-5.4[effort=low]')
  // A preference the local file does not name still comes from config.json.
  assert.equal(loaded.config.personas.reviewer, expectedReviewer)
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

test('pipeline config accepts a Cursor model the catalog has not recorded', () => {
  // Pancreator cannot enumerate a model catalog it does not own. Rejecting an
  // unrecorded id bricked config on models Cursor supports, so an unknown id is
  // unverified rather than invalid.
  assert.doesNotThrow(() =>
    parsePipelineConfig({
      schema_version: 1,
      active_config: 'default',
      configs: {
        default: { personas: { coder: 'unknown-cursor-model' } },
      },
    }),
  )
})

test('pipeline config merges defaults with config-specific persona overrides', () => {
  const file = parsePipelineConfig({
    schema_version: 1,
    active_config: 'default',
    defaults: {
      orchestrator: 'auto',
      coder: 'gpt-5.4',
    },
    configs: {
      default: {
        personas: {
          coder: 'claude-opus-5',
        },
      },
    },
  })

  assert.deepEqual(resolveConfigPersonas(file, 'default'), {
    orchestrator: 'auto',
    coder: 'claude-opus-5',
  })
})

test('pipeline config falls back to defaults for omitted config personas', () => {
  const file = parsePipelineConfig({
    schema_version: 1,
    active_config: 'default',
    defaults: {
      investigator: 'kimi-k3',
    },
    configs: {
      default: {
        personas: {},
      },
    },
  })

  assert.equal(resolveConfigPersonas(file, 'default').investigator, 'kimi-k3')
})

test('a run snapshot with retired option grammar still resolves its personas', () => {
  const root = createFixture()
  const snapshot = makePipelineConfigSnapshot(loadPipelineConfig(root))

  // Preserved run-era mappings from audited run 63327: a snapshot keeps the
  // exact text it was created with, so a later option-grammar change must not
  // strand the in-flight run.
  snapshot.personas.coder =
    'gpt-5.6-sol[context=272k,reasoning=high,fast=false]'
  snapshot.personas.reviewer =
    'claude-opus-5[thinking=true,context=300k,effort=high]'

  assert.equal(
    resolvePersonaModel(snapshot, 'coder'),
    'gpt-5.6-sol[context=272k,effort=high,fast=false]',
  )
  assert.equal(
    resolvePersonaModel(snapshot, 'reviewer'),
    'claude-opus-5[context=300k,effort=high,thinking=true]',
  )
})

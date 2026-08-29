import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  loadPipelineConfig,
  parsePipelineConfig,
  resolveConfigPersonas,
  resolvePersonaModel,
  type PipelineConfigSnapshot,
} from '../../src/lib/pipeline-config.js'
import { createFixture } from '../helpers.js'

test('config_overrides.json preferences override the checked-in pipeline config', () => {
  const root = createFixture()
  const base = loadPipelineConfig(root)

  writeFileSync(
    path.join(root, 'config_overrides.json'),
    JSON.stringify({
      active_config: 'advanced',
      defaults: {
        orchestrator: 'gpt-5.4[context=272k,reasoning=low,fast=false]',
      },
    }),
  )

  const loaded = loadPipelineConfig(root)
  const expectedReviewer = resolveConfigPersonas(base.file, 'advanced').reviewer

  assert.equal(loaded.name, 'advanced')
  assert.equal(
    loaded.config.personas.orchestrator,
    'gpt-5.4[context=272k,reasoning=low,fast=false]',
  )
  // A preference the local file does not name still comes from config.json.
  assert.equal(loaded.config.personas.reviewer, expectedReviewer)
  // The digest covers the effective configuration, so the local preference is
  // visible to drift detection exactly like a config.json edit.
  assert.notEqual(loaded.sha256, base.sha256)

  // A config_overrides.json that is not an object is rejected.
  writeFileSync(
    path.join(root, 'config_overrides.json'),
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

  // A config that names no persona falls back to the defaults entirely.
  const sparse = parsePipelineConfig({
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

  assert.equal(resolveConfigPersonas(sparse, 'default').investigator, 'kimi-k3')
})

test('a run snapshot preserves its exact persona model strings', () => {
  // The run snapshot is the execution contract. Drift comparison may treat
  // equivalent spellings as equal, but execution must not rewrite them.
  const snapshot: PipelineConfigSnapshot = {
    schema_version: 1,
    name: 'default',
    source_path: 'config.json',
    source_sha256: 'a'.repeat(64),
    personas: {
      coder: 'gpt-5.6-sol[context=272k,reasoning=high,fast=false]',
      reviewer: 'claude-opus-5[thinking=true,context=300k,effort=high]',
    },
  }

  assert.equal(resolvePersonaModel(snapshot, 'coder'), snapshot.personas.coder)
  assert.equal(
    resolvePersonaModel(snapshot, 'reviewer'),
    snapshot.personas.reviewer,
  )
})

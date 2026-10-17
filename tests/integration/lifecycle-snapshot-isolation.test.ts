import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  loadRunPipelineConfig,
  runPipelineConfigAdvisories,
} from '../../src/lib/engine/core.js'
import { getRunState, prepareInvocation } from '../../src/lib/engine.js'
import { PanError } from '../../src/lib/errors.js'
import { isRecord, readJson } from '../../src/lib/io.js'
import { loadPipelineConfig } from '../../src/lib/pipeline-config.js'
import { writeJson } from '../helpers.js'
import { createRun } from '../run-helpers.js'
import { checkpoint, submitCurrentStage } from './delivery-helpers.js'

test('snapshot preparation and submission survive incompatible live model configuration', () => {
  const { root, runId, state } = checkpoint('delivery@created')

  assert.ok(state.pipeline_config)

  const snapshotPath = path.join(root, state.pipeline_config.path)
  const snapshotBefore = readFileSync(snapshotPath, 'utf8')
  const configPath = path.join(root, 'config.json')
  const configBefore = readFileSync(configPath, 'utf8')
  const overridesPath = path.join(root, 'config_overrides.json')

  // An invalid unused alias models a newer live schema without changing the
  // active configuration or the recorded execution contract.
  writeJson(overridesPath, {
    model_config: { anthropic: { future: 'copilot:future-model' } },
  })

  const overridesBefore = readFileSync(overridesPath, 'utf8')
  const prepared = prepareInvocation(root, runId)

  assert.ok(prepared.invocation)
  assert.equal(prepared.invocation.stage.slug, 'implement')
  assert.match(
    prepared.advisories.join('\n'),
    /PIPELINE_CONFIG_ADVISORY_UNAVAILABLE: INVALID_PIPELINE_CONFIG:.*future/u,
  )
  assert.match(prepared.advisories.join('\n'), /models --sync/u)
  assert.equal(
    prepared.invocation.stage.model,
    loadRunPipelineConfig(root, state).personas.coder.replace(/^cursor:/u, ''),
  )

  const submitted = submitCurrentStage(root, runId)

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(submitted.state.current_stage, 'verify')
  assert.ok(
    getRunState(root, runId).advisories?.some(
      (entry) =>
        entry.kind === 'pipeline_config' &&
        entry.source === 'prepare' &&
        entry.message.includes('INVALID_PIPELINE_CONFIG'),
    ),
  )
  assert.equal(readFileSync(snapshotPath, 'utf8'), snapshotBefore)
  assert.equal(readFileSync(configPath, 'utf8'), configBefore)
  assert.equal(readFileSync(overridesPath, 'utf8'), overridesBefore)
  assert.throws(
    () =>
      createRun(root, {
        workflowSlug: 'delivery',
        requestPath: 'request.md',
        title: 'Invalid live configuration',
      }),
    (error: unknown) =>
      error instanceof PanError && error.code === 'INVALID_PIPELINE_CONFIG',
  )
})

test('live projection incompatibility becomes an advisory after snapshot validation', () => {
  const { root, state } = checkpoint('delivery@created')
  const snapshot = loadRunPipelineConfig(root, state)

  writeJson(path.join(root, 'governance/registries/projection_manifest.json'), {
    schema_version: 999,
  })

  const advisories = runPipelineConfigAdvisories(root, state, snapshot)

  assert.match(
    advisories.join('\n'),
    /PIPELINE_CONFIG_ADVISORY_UNAVAILABLE: INVALID_PROJECTION_MANIFEST/u,
  )
  assert.match(
    advisories.join('\n'),
    /continues on its recorded pipeline snapshot/u,
  )
})

test('an incompatible live project configuration cannot break the recovery remedy', () => {
  const { root, state } = checkpoint('delivery@created')
  const snapshot = loadRunPipelineConfig(root, state)
  const overridesPath = path.join(root, 'config_overrides.json')
  const overrides = readJson(overridesPath)

  assert.ok(isRecord(overrides))
  writeJson(overridesPath, {
    ...overrides,
    hosts: ['unsupported-host'],
  })

  const advisories = runPipelineConfigAdvisories(root, state, snapshot)

  assert.match(
    advisories.join('\n'),
    /PIPELINE_CONFIG_ADVISORY_UNAVAILABLE: INVALID_PROJECT_CONFIG/u,
  )
  assert.ok(
    advisories.some((message) =>
      message.includes(path.join(root, 'bin', 'pan')),
    ),
  )
  assert.match(advisories.join('\n'), /models --sync/u)
})

test('corrupt required snapshots and unexpected advisory I/O remain fatal', () => {
  const { root, runId, state } = checkpoint('delivery@created')

  assert.ok(state.pipeline_config)

  const snapshotPath = path.join(root, state.pipeline_config.path)
  const snapshotBefore = readFileSync(snapshotPath, 'utf8')

  writeJson(snapshotPath, { schema_version: 999 })
  writeJson(path.join(root, 'config_overrides.json'), {
    model_config: { anthropic: { future: 'copilot:future-model' } },
  })

  assert.throws(
    () => prepareInvocation(root, runId),
    (error: unknown) =>
      error instanceof PanError && error.code === 'INVALID_PIPELINE_CONFIG',
  )
  writeFileSync(snapshotPath, snapshotBefore)

  const snapshot = loadRunPipelineConfig(root, state)
  const configPath = path.join(root, 'config.json')

  rmSync(configPath)
  mkdirSync(configPath)

  assert.throws(
    () => runPipelineConfigAdvisories(root, state, snapshot),
    (error: unknown) =>
      error instanceof PanError && error.code === 'INVALID_JSON',
  )
  assert.throws(() => loadPipelineConfig(root))
})

test('run-scoped projection recovery does not hide invalid snapshot mappings or missing required personas', () => {
  const fixture = checkpoint('delivery@created')
  const state = { ...fixture.state, cursor_agent_suffix: 'isolation' }
  const snapshot = loadRunPipelineConfig(fixture.root, state)

  writeFileSync(
    path.join(fixture.root, 'library/cursor/agents/coder.md'),
    'An incompatible projection template.\n',
  )
  assert.match(
    runPipelineConfigAdvisories(fixture.root, state, snapshot).join('\n'),
    /PIPELINE_CONFIG_ADVISORY_UNAVAILABLE: INVALID_CURSOR_AGENT/u,
  )
  assert.throws(
    () =>
      runPipelineConfigAdvisories(fixture.root, state, {
        ...snapshot,
        personas: { ...snapshot.personas, coder: 'unsupported:model' },
      }),
    (error: unknown) =>
      error instanceof PanError && error.code === 'INVALID_PIPELINE_CONFIG',
  )

  const { coder: _coder, ...personas } = snapshot.personas

  assert.throws(
    () =>
      runPipelineConfigAdvisories(fixture.root, state, {
        ...snapshot,
        personas,
      }),
    (error: unknown) =>
      error instanceof PanError && error.code === 'INVALID_PIPELINE_CONFIG',
  )
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { migratePipelineOverrides } from '../../src/lib/pipeline-config-migration.js'

/**
 * The QA-001 shape: a release blanks the tracked model values and expects the
 * operator overrides to carry the effective map. The migration is what makes
 * that replacement safe — it preserves the pre-change effective mapping for
 * every hole the new file opens, and it refuses the replacement entirely when
 * preservation cannot produce a complete map.
 */
const previous = {
  schema_version: 1,
  active_config: 'simple',
  defaults: { orchestrator: 'model-orchestrator' },
  configs: {
    simple: {
      personas: {
        coder: 'model-coder',
        decomposer: 'model-decomposer',
        'design-reviewer': 'model-design-reviewer',
      },
    },
  },
}

test('migration preserves the pre-change effective map into the overrides', () => {
  // The replacement blanks two mappings the overrides do not carry yet.
  const next = {
    schema_version: 1,
    active_config: 'simple',
    defaults: { orchestrator: '' },
    configs: {
      simple: {
        personas: {
          coder: 'model-coder-next',
          decomposer: '',
          'design-reviewer': '',
        },
      },
    },
  }
  const result = migratePipelineOverrides({
    previous,
    next,
    overrides: {
      configs: { simple: { personas: { 'design-reviewer': 'local-choice' } } },
    },
  })

  assert.equal(result.changed, true)
  assert.deepEqual(result.missing, [])
  assert.deepEqual(result.preserved, [
    {
      location: 'defaults',
      persona: 'orchestrator',
      model: 'model-orchestrator',
    },
    {
      location: 'configs.simple.personas',
      persona: 'decomposer',
      model: 'model-decomposer',
    },
  ])
  // An existing local override outranks preservation; a non-empty tracked
  // value needs no override at all.
  assert.deepEqual(result.overrides, {
    defaults: { orchestrator: 'model-orchestrator' },
    configs: {
      simple: {
        personas: {
          'design-reviewer': 'local-choice',
          decomposer: 'model-decomposer',
        },
      },
    },
  })
})

test('migration fails before mutation when a required mapping stays empty', () => {
  // The replacement introduces a persona the previous map never covered.
  const next = {
    schema_version: 1,
    active_config: 'simple',
    defaults: {},
    configs: {
      simple: {
        personas: {
          coder: 'model-coder-next',
          'brand-new-persona': '',
        },
      },
    },
  }
  const result = migratePipelineOverrides({
    previous,
    next,
    overrides: null,
  })

  assert.deepEqual(result.missing, [
    'configs.simple.personas.brand-new-persona',
  ])
  // Nothing else moved, so the caller has nothing to write.
  assert.equal(result.changed, false)

  const handWritten = migratePipelineOverrides({
    previous,
    next: structuredClone(previous),
    overrides: { configs: { simple: { personas: { coder: '' } } } },
  })
  assert.deepEqual(handWritten.missing, ['configs.simple.personas.coder'])
})

test('migration keeps complete local overrides unchanged', () => {
  const next = structuredClone(previous)
  const overrides = {
    active_config: 'simple',
    configs: { simple: { personas: { coder: 'operator-preference' } } },
  }
  const result = migratePipelineOverrides({ previous, next, overrides })

  assert.equal(result.changed, false)
  assert.deepEqual(result.missing, [])
  assert.deepEqual(result.preserved, [])
  // Deep-equal to the input: a caller that skips the write on
  // `changed === false` keeps the file byte-identical.
  assert.deepEqual(result.overrides, overrides)
})

test('migration does not report a named-config hole that defaults fill', () => {
  const next = {
    schema_version: 1,
    active_config: 'simple',
    defaults: { orchestrator: 'model-orchestrator', coder: 'default-coder' },
    configs: {
      simple: {
        personas: { coder: '', 'brand-new-persona': '' },
      },
    },
  }
  const result = migratePipelineOverrides({
    previous: {
      schema_version: 1,
      active_config: 'simple',
      defaults: {},
      configs: { simple: { personas: {} } },
    },
    next,
    overrides: null,
  })

  // `coder` inherits `defaults.coder`; only the persona defaults omit is a hole.
  assert.deepEqual(result.missing, [
    'configs.simple.personas.brand-new-persona',
  ])
  assert.equal(result.changed, false)
})

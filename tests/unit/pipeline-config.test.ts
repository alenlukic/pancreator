import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  loadPipelineConfig,
  makePipelineConfigSnapshot,
  parsePipelineConfig,
  resolveConfigPersonas,
  resolvePersonaModel,
  type PipelineConfigSnapshot,
} from '../../src/lib/pipeline-config.js'
import { createTestTempDirectory } from '../temp.js'

test('config_overrides.json preferences override the checked-in pipeline config', () => {
  // The merge depends on config.json and config_overrides.json alone, so the
  // case writes the two named configs it needs into a scratch root rather than
  // cloning the fixture template and re-running the Cursor projection over it.
  const root = createTestTempDirectory('pipeline-config-overrides-')

  writeFileSync(
    path.join(root, 'config.json'),
    `${JSON.stringify(
      {
        schema_version: 1,
        active_config: 'default',
        configs: {
          default: {
            orchestrator: 'gpt-5.6-sol',
            reviewer: 'default-reviewer',
          },
          advanced: { reviewer: 'advanced-reviewer' },
        },
      },
      null,
      2,
    )}\n`,
  )

  const base = loadPipelineConfig(root)

  assert.equal(base.config.personas.orchestrator, 'gpt-5.6-sol')

  writeFileSync(
    path.join(root, 'config_overrides.json'),
    JSON.stringify({
      active_config: 'advanced',
      defaults: {
        orchestrator: 'gpt-5.6-terra[context=272k,reasoning=high,fast=false]',
      },
    }),
  )

  const loaded = loadPipelineConfig(root)
  const expectedReviewer = resolveConfigPersonas(base.file, 'advanced').reviewer

  assert.equal(loaded.name, 'advanced')
  assert.equal(
    loaded.config.personas.orchestrator,
    'gpt-5.6-terra[context=272k,reasoning=high,fast=false]',
  )
  // A preference the local file does not name still comes from config.json.
  assert.equal(loaded.config.personas.reviewer, expectedReviewer)
  // The digest covers the effective configuration, so the local preference is
  // visible to drift detection exactly like a config.json edit.
  assert.notEqual(loaded.sha256, base.sha256)

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
          default: { coder: 'auto' },
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
      orchestrator: 'auto',
      coder: 'gpt-5.6-terra',
    },
    configs: {
      default: {
        coder: 'claude-opus-5',
      },
    },
  })

  assert.deepEqual(resolveConfigPersonas(file, 'default'), {
    orchestrator: 'auto',
    coder: 'claude-opus-5',
  })

  const sparse = parsePipelineConfig({
    schema_version: 1,
    active_config: 'default',
    defaults: {
      investigator: 'kimi-k3',
    },
    configs: {
      default: {},
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
      coder: 'gpt-5.6-sol[context=272k,reasoning=xhigh,fast=false]',
      reviewer: 'claude-opus-5[thinking=true,context=300k,effort=high]',
    },
  }

  assert.equal(resolvePersonaModel(snapshot, 'coder'), snapshot.personas.coder)
  assert.equal(
    resolvePersonaModel(snapshot, 'reviewer'),
    snapshot.personas.reviewer,
  )
})

// Pancreator cannot enumerate a model catalog it does not own, so
// `parsePipelineConfig` without a root accepts an unrecorded id such as
// 'default-coder' as unverified rather than invalid.
test('an empty named-config mapping inherits the default and an empty default is rejected', () => {
  const file = parsePipelineConfig({
    schema_version: 1,
    active_config: 'advanced',
    defaults: {
      coder: 'default-coder',
      remediator: 'default-remediator',
    },
    configs: {
      advanced: {
        coder: 'advanced-coder',
        remediator: '',
      },
    },
  })

  assert.deepEqual(resolveConfigPersonas(file, 'advanced'), {
    coder: 'advanced-coder',
    remediator: 'default-remediator',
  })
  assert.deepEqual(file.configs.advanced.personas, { coder: 'advanced-coder' })

  assert.throws(
    () =>
      parsePipelineConfig({
        schema_version: 1,
        active_config: 'advanced',
        defaults: { coder: '' },
        configs: { advanced: {} },
      }),
    /config\.json\.defaults\.coder MUST be a non-empty model string/u,
  )
})

test('pipeline config expands every alias exactly in defaults and named configs', () => {
  const aliases = [
    ['anthropic', 'balanced', 'claude-sonnet-5'],
    [
      'anthropic',
      'advanced',
      'claude-opus-5[thinking=true,context=300k,effort=high,fast=false]',
    ],
    [
      'anthropic',
      'ultra',
      'claude-fable-5-1[thinking=true,context=300k,effort=high]',
    ],
    [
      'oai',
      'balanced',
      'gpt-5.6-terra[context=272k,reasoning=high,fast=false]',
    ],
    ['oai', 'advanced', 'gpt-5.6-sol[context=272k,reasoning=high,fast=false]'],
    ['open', 'balanced', 'glm-5.2'],
    ['open', 'advanced', 'kimi-k3[reasoning=max]'],
    ['cursor', 'balanced', 'composer-2.5'],
    ['cursor', 'advanced', 'grok-4.6[effort=high,fast=false]'],
  ] as const
  const file = parsePipelineConfig({
    schema_version: 1,
    active_config: 'default',
    anthropic: {
      balanced: 'claude-sonnet-5',
      advanced:
        'claude-opus-5[thinking=true,context=300k,effort=high,fast=false]',
      ultra: 'claude-fable-5-1[thinking=true,context=300k,effort=high]',
    },
    oai: {
      balanced: 'gpt-5.6-terra[context=272k,reasoning=high,fast=false]',
      advanced: 'gpt-5.6-sol[context=272k,reasoning=high,fast=false]',
    },
    open: {
      balanced: 'glm-5.2',
      advanced: 'kimi-k3[reasoning=max]',
    },
    cursor: {
      balanced: 'composer-2.5',
      advanced: 'grok-4.6[effort=high,fast=false]',
    },
    defaults: {
      inherited: 'oai:advanced',
    },
    configs: {
      default: Object.fromEntries(
        aliases.map(([family, tier], index) => [
          `alias-${index}`,
          `${family}:${tier}`,
        ]),
      ),
    },
  })

  const resolved = resolveConfigPersonas(file, 'default')

  assert.equal(
    resolved.inherited,
    'gpt-5.6-sol[context=272k,reasoning=high,fast=false]',
  )

  for (const [index, [, , specification]] of aliases.entries()) {
    assert.equal(resolved[`alias-${index}`], specification)
  }
})

test('pipeline config rejects alias references to missing tiers', () => {
  assert.throws(
    () =>
      parsePipelineConfig({
        schema_version: 1,
        active_config: 'default',
        anthropic: {},
        configs: {
          default: { coder: 'anthropic:balanced' },
        },
      }),
    /references alias 'anthropic:balanced'.*is not defined/u,
  )
})

test('pipeline config rejects malformed alias-like mappings', () => {
  assert.throws(
    () =>
      parsePipelineConfig({
        schema_version: 1,
        active_config: 'default',
        configs: {
          default: { coder: 'oai:fast' },
        },
      }),
    /names model alias 'oai:fast'.*Supported tiers/u,
  )
})

test('pipeline config rejects recursive aliases and unsupported tier keys', () => {
  assert.throws(
    () =>
      parsePipelineConfig({
        schema_version: 1,
        active_config: 'default',
        anthropic: { balanced: 'oai:balanced' },
        oai: { balanced: 'gpt-5.6-sol' },
        configs: { default: { coder: 'anthropic:balanced' } },
      }),
    /anthropic\.balanced MUST be an explicit model spec; recursive aliases are not supported/u,
  )

  assert.throws(
    () =>
      parsePipelineConfig({
        schema_version: 1,
        active_config: 'default',
        anthropic: { expert: 'claude-opus-5' },
        configs: { default: { coder: 'claude-sonnet-5' } },
      }),
    /anthropic key 'expert' is not supported.*balanced, advanced, ultra/u,
  )

  // The persona names an explicit spec so the alias definition is the only
  // failure path that can satisfy this assertion.
  assert.throws(
    () =>
      parsePipelineConfig({
        schema_version: 1,
        active_config: 'default',
        anthropic: { balanced: 'claude-code:claude-opus-5' },
        configs: { default: { coder: 'claude-sonnet-5' } },
      }),
    /anthropic\.balanced MUST use the cursor executor/u,
  )
})

test('cursor tier aliases stay distinct from explicit executor mappings', () => {
  const file = parsePipelineConfig({
    schema_version: 1,
    active_config: 'default',
    cursor: { balanced: 'composer-2.5' },
    configs: {
      default: {
        alias: 'cursor:balanced',
        explicitCursor: 'cursor:gpt-5.2',
        explicitOptions: 'gpt-5.6-sol[reasoning=xhigh,fast=false]',
        external: 'claude-code:claude-opus-5[session-resume=true]',
      },
    },
  })

  assert.deepEqual(file.configs.default.personas, {
    alias: 'composer-2.5',
    explicitCursor: 'cursor:gpt-5.2',
    explicitOptions: 'gpt-5.6-sol[reasoning=xhigh,fast=false]',
    external: 'claude-code:claude-opus-5[session-resume=true]',
  })
})

test('pipeline config accepts legacy nested named-config mappings', () => {
  const file = parsePipelineConfig({
    schema_version: 1,
    active_config: 'default',
    configs: {
      default: {
        summary: 'Legacy-compatible config.',
        coder: 'direct-coder',
        personas: {
          coder: 'legacy-coder',
          reviewer: 'legacy-reviewer',
        },
      },
    },
  })

  assert.equal(file.configs.default.summary, 'Legacy-compatible config.')
  assert.deepEqual(file.configs.default.personas, {
    coder: 'legacy-coder',
    reviewer: 'legacy-reviewer',
  })
})

test('unused aliases do not require account-catalog availability', () => {
  const root = createTestTempDirectory('unused-model-alias-')
  const catalogPath = path.join(
    root,
    'governance',
    'registries',
    'cursor_model_catalog.json',
  )

  mkdirSync(path.dirname(catalogPath), { recursive: true })
  writeFileSync(
    catalogPath,
    JSON.stringify({
      models: [
        {
          id: 'claude-sonnet-5',
          displayName: 'Claude Sonnet 5',
          aliases: [],
        },
      ],
    }),
  )
  writeFileSync(
    path.join(root, 'config.json'),
    JSON.stringify({
      schema_version: 1,
      active_config: 'default',
      anthropic: { balanced: 'claude-sonnet-5' },
      open: { balanced: 'glm-5.2' },
      configs: { default: { coder: 'anthropic:balanced' } },
    }),
  )

  const loaded = loadPipelineConfig(root)
  const snapshot = makePipelineConfigSnapshot(loaded)

  assert.equal(loaded.config.personas.coder, 'claude-sonnet-5')
  assert.equal(snapshot.personas.coder, 'claude-sonnet-5')
})

test('loadPipelineConfig skipCatalog projects a spec the catalog rejects', () => {
  const root = createTestTempDirectory('forced-model-catalog-')
  const catalogPath = path.join(
    root,
    'governance',
    'registries',
    'cursor_model_catalog.json',
  )

  mkdirSync(path.dirname(catalogPath), { recursive: true })
  writeFileSync(
    catalogPath,
    JSON.stringify({
      models: [
        {
          id: 'kept-model',
          displayName: 'Kept',
          aliases: [],
        },
      ],
    }),
  )
  writeFileSync(
    path.join(root, 'config.json'),
    JSON.stringify({
      schema_version: 1,
      active_config: 'default',
      configs: { default: { coder: 'retired-model[thinking=true]' } },
    }),
  )

  assert.throws(
    () => loadPipelineConfig(root),
    /not in the Cursor model catalog/u,
  )

  // The skipped catalog echoes the spec verbatim, options included.
  const loaded = loadPipelineConfig(root, undefined, { skipCatalog: true })

  assert.equal(loaded.config.personas.coder, 'retired-model[thinking=true]')
})

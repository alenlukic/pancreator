import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { personaExecutorOf } from '../../src/lib/executors/mapping.js'
import { PanError } from '../../src/lib/errors.js'
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
            orchestrator: 'oai:advanced',
            reviewer: 'anthropic:balanced',
          },
          advanced: { reviewer: 'anthropic:advanced' },
        },
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    path.join(root, 'config_overrides.json'),
    JSON.stringify({
      model_config: {
        oai: { advanced: 'cursor:gpt-5.6-sol' },
        anthropic: {
          balanced: 'cursor:claude-sonnet-5',
          advanced: 'cursor:claude-opus-5-5',
        },
      },
    }),
  )

  const base = loadPipelineConfig(root)

  assert.equal(base.config.personas.orchestrator, 'cursor:gpt-5.6-sol')

  writeFileSync(
    path.join(root, 'config_overrides.json'),
    JSON.stringify({
      active_config: 'advanced',
      model_config: {
        oai: { advanced: 'cursor:gpt-5.6-sol' },
        anthropic: {
          balanced: 'cursor:claude-sonnet-5',
          advanced: 'cursor:claude-opus-5-5',
        },
      },
      defaults: {
        orchestrator: 'copilot:gpt-5.6-terra[provider=openai,effort=high]',
      },
    }),
  )

  const loaded = loadPipelineConfig(root)
  const expectedReviewer = resolveConfigPersonas(base.file, 'advanced').reviewer

  assert.equal(loaded.name, 'advanced')
  assert.equal(
    loaded.config.personas.orchestrator,
    'copilot:gpt-5.6-terra[provider=openai,effort=high]',
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

test('tracked config rejects executor-specific persona model strings', () => {
  const root = createTestTempDirectory('pipeline-config-env-model-')

  writeFileSync(
    path.join(root, 'config.json'),
    JSON.stringify({
      schema_version: 1,
      active_config: 'default',
      defaults: { coder: 'copilot:gpt-6.1-sol[provider=openai]' },
      configs: { default: {} },
    }),
  )

  assert.throws(
    () => loadPipelineConfig(root),
    /config\.json\.defaults\.coder MUST use a provider:tier alias/u,
  )
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

test('pipeline config rejects an invalid openai persona mapping', () => {
  assert.throws(
    () =>
      parsePipelineConfig({
        schema_version: 1,
        active_config: 'default',
        configs: {
          default: {
            planner: 'openai:gpt-6-astra[effort=extreme]',
          },
        },
      }),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'INVALID_PIPELINE_CONFIG' &&
      /planner/u.test(error.message) &&
      /effort/u.test(error.message) &&
      /session-resume/u.test(error.message) &&
      /max-tool-rounds/u.test(error.message),
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

test('provider-tier aliases expand through local model_config overrides', () => {
  const aliases = [
    ['anthropic', 'balanced', 'cursor:claude-sonnet-5'],
    [
      'anthropic',
      'advanced',
      'copilot:claude-opus-5[provider=anthropic,effort=high]',
    ],
    [
      'anthropic',
      'ultra',
      'cursor:claude-fable-5-1[thinking=true,context=300k,effort=high]',
    ],
    [
      'oai',
      'balanced',
      'cursor:gpt-5.6-terra[context=272k,reasoning=high,fast=false]',
    ],
    ['oai', 'advanced', 'copilot:gpt-6.1-sol[provider=openai,effort=high]'],
    ['open', 'balanced', 'cursor:glm-5.2'],
    ['open', 'advanced', 'cursor:kimi-k3[reasoning=max]'],
    ['cursor', 'balanced', 'cursor-cli:composer-2.5'],
    ['cursor', 'advanced', 'cursor-cli:grok-4.6[effort=high,fast=false]'],
  ] as const
  const file = parsePipelineConfig({
    schema_version: 1,
    active_config: 'default',
    model_config: {
      anthropic: {
        balanced: 'cursor:claude-sonnet-5',
        advanced: 'copilot:claude-opus-5[provider=anthropic,effort=high]',
        ultra:
          'cursor:claude-fable-5-1[thinking=true,context=300k,effort=high]',
      },
      oai: {
        balanced:
          'cursor:gpt-5.6-terra[context=272k,reasoning=high,fast=false]',
        advanced: 'copilot:gpt-6.1-sol[provider=openai,effort=high]',
      },
      open: {
        balanced: 'cursor:glm-5.2',
        advanced: 'cursor:kimi-k3[reasoning=max]',
      },
      cursor: {
        balanced: 'cursor-cli:composer-2.5',
        advanced: 'cursor-cli:grok-4.6[effort=high,fast=false]',
      },
    },
    defaults: {
      inherited: 'oai:advanced',
    },
    configs: {
      default: Object.fromEntries(
        aliases.map(([provider, tier], index) => [
          `alias-${index}`,
          `${provider}:${tier}`,
        ]),
      ),
    },
  })

  const resolved = resolveConfigPersonas(file, 'default')

  assert.equal(
    resolved.inherited,
    'copilot:gpt-6.1-sol[provider=openai,effort=high]',
  )

  for (const [index, [, , specification]] of aliases.entries()) {
    assert.equal(resolved[`alias-${index}`], specification)
    assert.equal(
      personaExecutorOf(resolved[`alias-${index}`] ?? ''),
      specification.split(':', 1)[0],
    )
  }
})

test('pipeline config rejects alias references to missing tiers', () => {
  assert.throws(
    () =>
      parsePipelineConfig({
        schema_version: 1,
        active_config: 'default',
        model_config: { anthropic: {} },
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

test('pipeline config rejects unsupported model_config tiers and executors', () => {
  assert.throws(
    () =>
      parsePipelineConfig({
        schema_version: 1,
        active_config: 'default',
        model_config: { anthropic: { expert: 'cursor:claude-opus-5' } },
        configs: { default: { coder: 'anthropic:balanced' } },
      }),
    /model_config\.anthropic key 'expert' is not supported.*balanced, advanced, ultra/u,
  )

  assert.throws(
    () =>
      parsePipelineConfig({
        schema_version: 1,
        active_config: 'default',
        model_config: {
          anthropic: { balanced: 'claude-code:claude-opus-5' },
        },
        configs: { default: { coder: 'anthropic:balanced' } },
      }),
    /model_config\.anthropic\.balanced MUST use one of these executors: copilot, cursor, cursor-cli/u,
  )
})

test('pipeline aliases preserve Copilot mappings and validate their options', () => {
  for (const spec of [
    'copilot:claude-opus-5-5[provider=anthropic,effort=high]',
    'copilot:gpt-5.6-sol[provider=openai,effort=xhigh]',
  ]) {
    const file = parsePipelineConfig({
      schema_version: 1,
      active_config: 'default',
      model_config: { anthropic: { advanced: spec } },
      defaults: { planner: 'anthropic:advanced' },
      configs: { default: { reviewer: 'anthropic:advanced' } },
    })

    assert.deepEqual(resolveConfigPersonas(file, 'default'), {
      planner: spec,
      reviewer: spec,
    })
    const snapshot = makePipelineConfigSnapshot({
      name: 'default',
      config: { personas: resolveConfigPersonas(file, 'default') },
      file,
      path: 'config.json',
      sha256: 'test',
    })
    assert.equal(snapshot.executors?.planner, personaExecutorOf(spec))
  }

  for (const [spec, error] of [
    [
      'copilot:gpt-5.6-sol[reasoning=high]',
      /unknown copilot option 'reasoning'/u,
    ],
    ['copilot:gpt-5.6-sol[provider=missing]', /provider.*not supported/u],
    ['copilot:gpt-5.6-sol[effort=invalid]', /effort.*not supported/u],
    [
      'codex:gpt-5.6-sol',
      /model_config\.oai\.advanced MUST use one of these executors/u,
    ],
  ] as const) {
    assert.throws(
      () =>
        parsePipelineConfig({
          schema_version: 1,
          active_config: 'default',
          model_config: { oai: { advanced: spec } },
          configs: { default: { coder: 'oai:advanced' } },
        }),
      error,
    )
  }
})

test('shipped profiles use environment-independent aliases', () => {
  const config = JSON.parse(
    readFileSync(path.join(process.cwd(), 'config.json'), 'utf8'),
  ) as Record<string, unknown> & {
    defaults: Record<string, string>
    configs: Record<string, Record<string, unknown>>
  }
  const personas = readdirSync(
    path.join(process.cwd(), 'library/cursor/agents'),
  )
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.slice(0, -3))
    .sort()
  const alias = /^(anthropic|oai|open|cursor):(balanced|advanced|ultra)$/u

  assert.deepEqual(Object.keys(config.defaults).sort(), personas)
  assert.equal(config.model_config, undefined)
  for (const provider of ['anthropic', 'oai', 'open', 'cursor']) {
    assert.equal(config[provider], undefined)
  }

  for (const mapping of Object.values(config.defaults)) {
    assert.match(mapping, alias)
  }
  for (const [name, entries] of Object.entries(config.configs)) {
    for (const [persona, mapping] of Object.entries(entries)) {
      if (persona === 'summary' || persona === 'personas' || mapping === '') {
        continue
      }
      assert.equal(typeof mapping, 'string', `${name}.${persona}`)
      assert.match(mapping as string, alias, `${name}.${persona}`)
    }
  }
})

test('cursor tier aliases stay distinct from explicit executor mappings', () => {
  const file = parsePipelineConfig({
    schema_version: 1,
    active_config: 'default',
    model_config: { cursor: { balanced: 'cursor-cli:composer-2.5' } },
    configs: {
      default: {
        alias: 'cursor:balanced',
        explicitCursor: 'cursor:gpt-5.2',
        explicitOptions: 'gpt-5.6-sol[reasoning=xhigh,fast=false]',
        external: 'claude-code:claude-opus-5[session-resume=true]',
        openai: 'openai:gpt-6-astra[effort=high]',
      },
    },
  })

  assert.deepEqual(file.configs.default.personas, {
    alias: 'cursor-cli:composer-2.5',
    explicitCursor: 'cursor:gpt-5.2',
    explicitOptions: 'gpt-5.6-sol[reasoning=xhigh,fast=false]',
    external: 'claude-code:claude-opus-5[session-resume=true]',
    openai: 'openai:gpt-6-astra[effort=high]',
  })
})

test('an oai tier alias and an openai executor prefix mean different things', () => {
  // `oai:` names a Cursor tier family. `openai:` names the runtime that
  // executes the stage. Registering the second must not capture the first.
  const file = parsePipelineConfig({
    schema_version: 1,
    active_config: 'default',
    model_config: {
      oai: {
        balanced: 'cursor:gpt-5.5-medium',
        ultra: 'copilot:gpt-5.6-sol-high',
      },
    },
    configs: {
      default: {
        tier: 'oai:balanced',
        runtime: 'openai:gpt-6-astra',
      },
    },
  })

  assert.deepEqual(file.configs.default.personas, {
    tier: 'cursor:gpt-5.5-medium',
    runtime: 'openai:gpt-6-astra',
  })
  assert.equal(personaExecutorOf(file.configs.default.personas.tier), 'cursor')
  assert.equal(
    personaExecutorOf(file.configs.default.personas.runtime),
    'openai',
  )
})

test('model enumerations default without changing resolved persona mappings', () => {
  const value = {
    schema_version: 1,
    active_config: 'default',
    model_config: {
      oai: { advanced: 'copilot:gpt-6.1-sol[provider=openai,effort=medium]' },
    },
    configs: { default: { coder: 'oai:advanced' } },
  }
  const defaults = parsePipelineConfig(value)
  const explicit = parsePipelineConfig({
    ...value,
    executor: ['copilot', 'cursor', 'cursor-cli'],
    provider: ['anthropic', 'oai', 'cursor', 'open'],
    tier: ['balanced', 'advanced', 'ultra'],
  })

  assert.deepEqual(explicit, defaults)
  assert.deepEqual(defaults.executor, ['copilot', 'cursor', 'cursor-cli'])
  assert.deepEqual(defaults.provider, ['anthropic', 'oai', 'cursor', 'open'])
  assert.deepEqual(defaults.tier, ['balanced', 'advanced', 'ultra'])
  assert.equal(
    resolveConfigPersonas(explicit, 'default').coder,
    'copilot:gpt-6.1-sol[provider=openai,effort=medium]',
  )
})

test('model enumerations reject unsupported, missing, and duplicate values', () => {
  const value = {
    schema_version: 1,
    active_config: 'default',
    configs: { default: { coder: 'cursor:auto' } },
  }

  for (const [key, entries] of [
    ['executor', ['copilot', 'cursor', 'openai']],
    ['provider', ['anthropic', 'oai', 'open']],
    ['tier', ['balanced', 'advanced', 'advanced']],
    ['tier', 'balanced'],
  ] as const) {
    assert.throws(
      () => parsePipelineConfig({ ...value, [key]: entries }),
      new RegExp(`${key} MUST enumerate exactly`, 'u'),
    )
  }
})

test('the model schemas constrain aliases and local executors', () => {
  const schema = JSON.parse(
    readFileSync(
      path.join(process.cwd(), 'library/schemas/config.schema.json'),
      'utf8',
    ),
  ) as {
    $defs: {
      executor: { enum: string[] }
      provider: { enum: string[] }
      tier: { enum: string[] }
      modelAlias: { pattern: string }
    }
    properties: Record<
      'executor' | 'provider' | 'tier',
      {
        type: string
        items: { $ref: string }
        uniqueItems: boolean
        minItems: number
        maxItems: number
      }
    > & {
      defaults: { additionalProperties: { $ref: string } }
    }
    not: { anyOf: { required?: string[] }[] }
  }
  const overrideSchema = JSON.parse(
    readFileSync(
      path.join(process.cwd(), 'library/schemas/config-overrides.schema.json'),
      'utf8',
    ),
  ) as {
    $defs: {
      modelConfigValue: { pattern: string }
      modelSpec: { pattern: string }
    }
  }

  const localModelSpec = new RegExp(overrideSchema.$defs.modelSpec.pattern, 'u')

  assert.equal(localModelSpec.test('openai:gpt-6-astra'), true)
  assert.equal(
    localModelSpec.test(
      'copilot:claude-opus-5-5[provider=anthropic,effort=high]',
    ),
    true,
  )
  assert.equal(localModelSpec.test('claude-code:claude-opus-5'), true)
  assert.equal(localModelSpec.test('cursor:auto'), true)
  assert.equal(localModelSpec.test('gpt-5.6-sol'), true)
  assert.equal(localModelSpec.test('codex:gpt-5.6-sol'), false)
  assert.deepEqual(schema.$defs.executor.enum, [
    'copilot',
    'cursor',
    'cursor-cli',
  ])
  assert.deepEqual(schema.$defs.provider.enum, [
    'anthropic',
    'oai',
    'cursor',
    'open',
  ])
  assert.deepEqual(schema.$defs.tier.enum, ['balanced', 'advanced', 'ultra'])

  const config = JSON.parse(
    readFileSync(path.join(process.cwd(), 'config.json'), 'utf8'),
  ) as Record<string, unknown>

  for (const key of ['executor', 'provider', 'tier'] as const) {
    assert.deepEqual(config[key], schema.$defs[key].enum)
    assert.deepEqual(schema.properties[key], {
      type: 'array',
      items: { $ref: `#/$defs/${key}` },
      uniqueItems: true,
      minItems: schema.$defs[key].enum.length,
      maxItems: schema.$defs[key].enum.length,
    })
  }

  assert.equal(
    new RegExp(schema.$defs.modelAlias.pattern, 'u').test('oai:advanced'),
    true,
  )
  assert.equal(
    new RegExp(schema.$defs.modelAlias.pattern, 'u').test(
      'copilot:gpt-6-astra',
    ),
    false,
  )
  assert.equal(
    schema.properties.defaults.additionalProperties.$ref,
    '#/$defs/modelAlias',
  )
  assert.ok(
    schema.not.anyOf.some((rule) => rule.required?.includes('model_config')),
  )
  assert.equal(
    new RegExp(overrideSchema.$defs.modelConfigValue.pattern, 'u').test(
      'cursor-cli:composer-2.5',
    ),
    true,
  )
  assert.equal(
    new RegExp(overrideSchema.$defs.modelConfigValue.pattern, 'u').test(
      'anthropic:advanced',
    ),
    false,
  )
  assert.equal(
    new RegExp(overrideSchema.$defs.modelConfigValue.pattern, 'u').test(
      'claude-code:claude-opus-5',
    ),
    false,
  )
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
      configs: { default: { coder: 'anthropic:balanced' } },
    }),
  )
  writeFileSync(
    path.join(root, 'config_overrides.json'),
    JSON.stringify({
      model_config: {
        anthropic: { balanced: 'cursor:claude-sonnet-5' },
        open: { balanced: 'cursor:glm-5.2' },
      },
    }),
  )

  const loaded = loadPipelineConfig(root)
  const snapshot = makePipelineConfigSnapshot(loaded)

  assert.equal(loaded.config.personas.coder, 'cursor:claude-sonnet-5')
  assert.equal(snapshot.personas.coder, 'cursor:claude-sonnet-5')
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
      configs: { default: { coder: 'anthropic:balanced' } },
    }),
  )
  writeFileSync(
    path.join(root, 'config_overrides.json'),
    JSON.stringify({
      model_config: {
        anthropic: { balanced: 'cursor:retired-model[thinking=true]' },
      },
    }),
  )

  assert.throws(
    () => loadPipelineConfig(root),
    /not in the Cursor model catalog/u,
  )

  // The skipped catalog echoes the spec verbatim, options included.
  const loaded = loadPipelineConfig(root, undefined, { skipCatalog: true })

  assert.equal(
    loaded.config.personas.coder,
    'cursor:retired-model[thinking=true]',
  )
})

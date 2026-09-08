import path from 'node:path'

import { invariant } from './errors.js'
import {
  createCursorModelResolver,
  resolveCursorModelSlug,
} from './executors/cursor-catalog.js'
import {
  parsePersonaMapping,
  type ParsedPersonaMapping,
} from './executors/mapping.js'
import { fileExists, isRecord, readJson, resolveInside, sha256 } from './io.js'
import { harnessConfigName, readHarnessConfig } from './project-config.js'
import type { PersonaExecutorKind } from './types.js'

const MODEL_ALIAS_FAMILIES = ['anthropic', 'oai', 'open', 'cursor'] as const
type ModelAliasFamily = (typeof MODEL_ALIAS_FAMILIES)[number]

const MODEL_ALIAS_TIERS = ['balanced', 'advanced', 'ultra'] as const
type ModelAliasTier = (typeof MODEL_ALIAS_TIERS)[number]

type ModelAliasMap = Partial<Record<ModelAliasTier, string>>

function isAliasTier(value: string): value is ModelAliasTier {
  return (MODEL_ALIAS_TIERS as readonly string[]).includes(value)
}

function parseAliasReference(
  value: string,
): { family: ModelAliasFamily; tier: ModelAliasTier } | null {
  const match = /^(anthropic|oai|open|cursor):([^:]+)$/u.exec(value)

  if (!match) {
    return null
  }

  const family = match[1] as ModelAliasFamily
  const tier = match[2]

  // `cursor:<model>` is also a valid executor-prefixed spec. Only treat the
  // three tier names as aliases; every other `cursor:` value is executor
  // routing and must remain unchanged.
  if (!isAliasTier(tier)) {
    return null
  }

  return { family, tier }
}

function resolveModelAlias(
  spec: string,
  source: string,
  aliases: Record<ModelAliasFamily, ModelAliasMap>,
): string {
  const parsed = parseAliasReference(spec)

  if (parsed) {
    const resolved = aliases[parsed.family]?.[parsed.tier]

    invariant(
      typeof resolved === 'string' && resolved.length > 0,
      `${source} references alias '${spec}', but ${parsed.family}.${parsed.tier} is not defined. Define the alias or use an explicit model spec.`,
      { code: 'INVALID_PIPELINE_CONFIG' },
    )

    return resolved
  }

  // Actionable errors for malformed alias-like forms. Do not intercept
  // `cursor:<model>` executor strings; those are handled by parsePersonaMapping.
  for (const family of ['anthropic', 'oai', 'open'] as const) {
    if (!spec.startsWith(`${family}:`)) {
      continue
    }

    const suffix = spec.slice(family.length + 1)

    invariant(
      isAliasTier(suffix),
      `${source} names model alias '${spec}', which is not supported. Supported tiers: ${MODEL_ALIAS_TIERS.join(
        ', ',
      )}.`,
      { code: 'INVALID_PIPELINE_CONFIG' },
    )
  }

  return spec
}

export interface NamedPipelineConfig {
  summary?: string
  personas: Record<string, string>
}

export interface PipelineConfigFile {
  schema_version: 1
  active_config: string
  anthropic: ModelAliasMap
  oai: ModelAliasMap
  open: ModelAliasMap
  cursor: ModelAliasMap
  defaults: Record<string, string>
  $operator?: {
    summary?: string
    note?: string
  }
  configs: Record<string, NamedPipelineConfig>
}

export interface LoadedPipelineConfig {
  name: string
  config: NamedPipelineConfig
  file: PipelineConfigFile
  path: string
  sha256: string
}

export interface PipelineConfigSnapshot {
  schema_version: 1
  name: string
  source_path: string
  source_sha256: string
  summary?: string
  personas: Record<string, string>
  /**
   * Executor per persona, derived from the mapping strings above. Recorded so
   * the snapshot names who ran what without re-parsing; absent on snapshots
   * taken before executor routing existed, where every persona is `cursor`.
   */
  executors?: Record<string, PersonaExecutorKind>
}

const CONFIG_PATH = 'config.json'

function parsePersonaMap(
  value: unknown,
  source: string,
  aliases: Record<ModelAliasFamily, ModelAliasMap>,
  {
    allowEmpty = false,
    inheritEmpty = false,
  }: { allowEmpty?: boolean; inheritEmpty?: boolean } = {},
): Record<string, string> {
  invariant(isRecord(value), `${source} MUST be an object.`, {
    code: 'INVALID_PIPELINE_CONFIG',
  })

  const personas: Record<string, string> = {}

  for (const [persona, model] of Object.entries(value)) {
    // A named config lists only the personas it changes. An empty string
    // there is a placeholder the tracked file ships, and it means "inherit
    // the default", so it is dropped rather than rejected. `defaults` has
    // nothing to inherit from and stays strict.
    if (inheritEmpty && persona.length > 0 && model === '') {
      continue
    }

    invariant(
      persona.length > 0 && typeof model === 'string' && model.length > 0,
      `${source}.${persona} MUST be a non-empty model string.`,
      { code: 'INVALID_PIPELINE_CONFIG' },
    )

    const expanded = resolveModelAlias(model, `${source}.${persona}`, aliases)

    // Validates the optional executor prefix against the closed set and, for
    // harness-consumed executors, the bracket options.
    const mapping = parsePersonaMapping(expanded, `${source}.${persona}`)

    if (mapping.executor === 'cursor') {
      resolveCursorModelSlug(mapping, `${source}.${persona}`)
    }

    personas[persona] = expanded
  }

  invariant(
    allowEmpty || Object.keys(personas).length > 0,
    `${source} MUST NOT be empty.`,
    { code: 'INVALID_PIPELINE_CONFIG' },
  )

  return personas
}

function parseNamedConfig(
  value: unknown,
  source: string,
  aliases: Record<ModelAliasFamily, ModelAliasMap>,
): NamedPipelineConfig {
  invariant(isRecord(value), `${source} MUST be an object.`, {
    code: 'INVALID_PIPELINE_CONFIG',
  })

  const directValues: Record<string, unknown> = {}

  for (const [key, entry] of Object.entries(value)) {
    if (key === 'summary' || key === 'personas') {
      continue
    }

    directValues[key] = entry
  }

  const direct = parsePersonaMap(directValues, source, aliases, {
    allowEmpty: true,
    inheritEmpty: true,
  })

  const legacy = value.personas
  const legacyPersonas = legacy
    ? parsePersonaMap(legacy, `${source}.personas`, aliases, {
        allowEmpty: true,
        inheritEmpty: true,
      })
    : {}

  // Compatibility: when an older overrides file still writes `personas`, those
  // entries must override the new flat keys that can coexist after merge.
  const personas = { ...direct, ...legacyPersonas }

  return {
    ...(typeof value.summary === 'string' ? { summary: value.summary } : {}),
    personas,
  }
}

export function resolveConfigPersonas(
  file: PipelineConfigFile,
  configName: string,
): Record<string, string> {
  const config = file.configs[configName]

  invariant(
    config !== undefined,
    `Pipeline config '${configName}' is not defined.`,
    { code: 'INVALID_PIPELINE_CONFIG' },
  )

  return {
    ...file.defaults,
    ...config.personas,
  }
}

export function parsePipelineConfig(
  value: unknown,
  source = CONFIG_PATH,
): PipelineConfigFile {
  invariant(isRecord(value), `${source} MUST contain an object.`, {
    code: 'INVALID_PIPELINE_CONFIG',
  })
  invariant(value.schema_version === 1, `${source}.schema_version MUST be 1.`, {
    code: 'INVALID_PIPELINE_CONFIG',
  })
  invariant(
    typeof value.active_config === 'string' && value.active_config.length > 0,
    `${source}.active_config MUST be a non-empty string.`,
    { code: 'INVALID_PIPELINE_CONFIG' },
  )
  invariant(isRecord(value.configs), `${source}.configs MUST be an object.`, {
    code: 'INVALID_PIPELINE_CONFIG',
  })

  function parseAliasMap(
    family: ModelAliasFamily,
    raw: unknown,
  ): ModelAliasMap {
    if (raw === undefined) {
      return {}
    }

    invariant(isRecord(raw), `${source}.${family} MUST be an object.`, {
      code: 'INVALID_PIPELINE_CONFIG',
    })

    const parsed: ModelAliasMap = {}

    for (const [tier, spec] of Object.entries(raw)) {
      invariant(
        isAliasTier(tier),
        `${source}.${family} key '${tier}' is not supported. Supported tiers: ${MODEL_ALIAS_TIERS.join(
          ', ',
        )}.`,
        { code: 'INVALID_PIPELINE_CONFIG' },
      )
      invariant(
        typeof spec === 'string' && spec.length > 0,
        `${source}.${family}.${tier} MUST be a non-empty model string.`,
        { code: 'INVALID_PIPELINE_CONFIG' },
      )

      invariant(
        parseAliasReference(spec) === null,
        `${source}.${family}.${tier} MUST be an explicit model spec; recursive aliases are not supported.`,
        { code: 'INVALID_PIPELINE_CONFIG' },
      )

      const mapping = parsePersonaMapping(spec, `${source}.${family}.${tier}`)
      invariant(
        mapping.executor === 'cursor',
        `${source}.${family}.${tier} MUST use the cursor executor.`,
        { code: 'INVALID_PIPELINE_CONFIG' },
      )

      resolveCursorModelSlug(mapping, `${source}.${family}.${tier}`)
      parsed[tier] = spec
    }

    return parsed
  }

  const aliases: Record<ModelAliasFamily, ModelAliasMap> = {
    anthropic: parseAliasMap('anthropic', value.anthropic),
    oai: parseAliasMap('oai', value.oai),
    open: parseAliasMap('open', value.open),
    cursor: parseAliasMap('cursor', value.cursor),
  }

  const defaults = isRecord(value.defaults)
    ? parsePersonaMap(value.defaults, `${source}.defaults`, aliases, {
        allowEmpty: true,
      })
    : {}

  const configs: Record<string, NamedPipelineConfig> = {}

  for (const [name, config] of Object.entries(value.configs)) {
    configs[name] = parseNamedConfig(
      config,
      `${source}.configs.${name}`,
      aliases,
    )
  }

  invariant(
    Object.keys(configs).length > 0,
    `${source}.configs MUST NOT be empty.`,
    { code: 'INVALID_PIPELINE_CONFIG' },
  )
  invariant(
    configs[value.active_config] !== undefined,
    `${source}.active_config '${value.active_config}' is not defined.`,
    { code: 'INVALID_PIPELINE_CONFIG' },
  )

  const operator = isRecord(value.$operator)
    ? {
        ...(typeof value.$operator.summary === 'string'
          ? { summary: value.$operator.summary }
          : {}),
        ...(typeof value.$operator.note === 'string'
          ? { note: value.$operator.note }
          : {}),
      }
    : undefined

  return {
    schema_version: 1,
    active_config: value.active_config,
    anthropic: aliases.anthropic,
    oai: aliases.oai,
    open: aliases.open,
    cursor: aliases.cursor,
    defaults,
    ...(operator ? { $operator: operator } : {}),
    configs,
  }
}

export function loadPipelineConfig(
  root: string,
  name?: string,
): LoadedPipelineConfig {
  const configName = harnessConfigName(root) ?? CONFIG_PATH
  const filePath = path.join(root, configName)

  invariant(fileExists(filePath), `Missing required file: ${CONFIG_PATH}`, {
    code: 'INVALID_PIPELINE_CONFIG',
  })

  // The digest covers the effective configuration, so a `config_overrides.json`
  // preference is indistinguishable from the same edit made in `config.json`.
  const raw = readHarnessConfig(root, filePath)
  const file = parsePipelineConfig(raw, configName)
  const resolvedName = name ?? file.active_config
  const config = file.configs[resolvedName]

  invariant(
    config !== undefined,
    `Pipeline config '${resolvedName}' is not defined in ${configName}.`,
    { code: 'INVALID_PIPELINE_CONFIG' },
  )

  // Every named config receives strict validation here when the operator has
  // supplied an account-local Cursor model catalog. Without one, model specs
  // remain grammar-only because model availability is account-specific.
  const resolveModel = createCursorModelResolver(root)

  for (const candidate of Object.keys(file.configs)) {
    for (const [persona, model] of Object.entries(
      resolveConfigPersonas(file, candidate),
    )) {
      const mapping = parsePersonaMapping(model, `${candidate}.${persona}`)

      if (mapping.executor === 'cursor') {
        resolveModel(mapping, `${candidate}.${persona}`)
      }
    }
  }

  return {
    name: resolvedName,
    config: {
      ...config,
      personas: resolveConfigPersonas(file, resolvedName),
    },
    file,
    path: configName,
    sha256: sha256(raw),
  }
}

export function makePipelineConfigSnapshot(
  loaded: LoadedPipelineConfig,
): PipelineConfigSnapshot {
  const executors: Record<string, PersonaExecutorKind> = {}

  for (const [persona, model] of Object.entries(loaded.config.personas)) {
    executors[persona] = parsePersonaMapping(model, persona).executor
  }

  return {
    schema_version: 1,
    name: loaded.name,
    source_path: loaded.path,
    source_sha256: loaded.sha256,
    ...(loaded.config.summary ? { summary: loaded.config.summary } : {}),
    personas: structuredClone(loaded.config.personas),
    executors,
  }
}

export function loadPipelineConfigSnapshot(
  root: string,
  relativePath: string,
): PipelineConfigSnapshot {
  const value = readJson(resolveInside(root, relativePath))

  invariant(isRecord(value), `${relativePath} MUST contain an object.`, {
    code: 'INVALID_PIPELINE_CONFIG',
  })
  invariant(
    value.schema_version === 1 &&
      typeof value.name === 'string' &&
      typeof value.source_path === 'string' &&
      typeof value.source_sha256 === 'string' &&
      isRecord(value.personas),
    `${relativePath} MUST contain a valid pipeline config snapshot.`,
    { code: 'INVALID_PIPELINE_CONFIG' },
  )

  for (const [persona, model] of Object.entries(value.personas)) {
    invariant(
      typeof model === 'string' && model.length > 0,
      `${relativePath}.personas.${persona} MUST be a non-empty string.`,
      { code: 'INVALID_PIPELINE_CONFIG' },
    )
  }

  return value as unknown as PipelineConfigSnapshot
}

export function resolvePersonaMapping(
  config: NamedPipelineConfig | PipelineConfigSnapshot,
  persona: string,
): ParsedPersonaMapping {
  const model = config.personas[persona]

  invariant(
    typeof model === 'string' && model.length > 0,
    `Pipeline config does not map persona '${persona}' to a model.`,
    { code: 'INVALID_PIPELINE_CONFIG' },
  )

  // The snapshot is the execution contract. Parse its model string verbatim;
  // canonicalization is only for drift comparison and must not rewrite the
  // model that cards, attestations, and projected workers use.
  const mapping = parsePersonaMapping(model, `personas.${persona}`)

  if (mapping.executor === 'cursor') {
    resolveCursorModelSlug(mapping, `personas.${persona}`)
  }

  return mapping
}

/**
 * Model string for a persona with the executor prefix stripped. Cursor
 * mappings carry no prefix, so this is unchanged behavior for them.
 */
export function resolvePersonaModel(
  config: NamedPipelineConfig | PipelineConfigSnapshot,
  persona: string,
): string {
  return resolvePersonaMapping(config, persona).model_spec
}

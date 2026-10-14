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

const MODEL_CONFIG_EXECUTORS = [
  'copilot',
  'cursor',
  'cursor-cli',
] as const satisfies readonly PersonaExecutorKind[]
type ModelConfigMap = Partial<
  Record<ModelAliasFamily, Partial<Record<ModelAliasTier, string>>>
>
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
      `${source} references alias '${spec}', but ${parsed.family}.${parsed.tier} is not defined in model_config. Add it to config_overrides.json.model_config.`,
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
  model_config: ModelConfigMap
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

    if (mapping.executor === 'cursor' || mapping.executor === 'cursor-cli') {
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

function parseModelConfig(value: unknown, source: string): ModelConfigMap {
  if (value === undefined) {
    return {}
  }

  invariant(isRecord(value), `${source} MUST be an object.`, {
    code: 'INVALID_PIPELINE_CONFIG',
  })

  const modelConfig: ModelConfigMap = {}

  for (const [provider, rawTiers] of Object.entries(value)) {
    invariant(
      MODEL_ALIAS_FAMILIES.includes(provider as ModelAliasFamily),
      `${source} provider '${provider}' is not supported. Supported providers: ${MODEL_ALIAS_FAMILIES.join(', ')}.`,
      { code: 'INVALID_PIPELINE_CONFIG' },
    )
    invariant(isRecord(rawTiers), `${source}.${provider} MUST be an object.`, {
      code: 'INVALID_PIPELINE_CONFIG',
    })

    const tiers: Partial<Record<ModelAliasTier, string>> = {}

    for (const [tier, spec] of Object.entries(rawTiers)) {
      invariant(
        isAliasTier(tier),
        `${source}.${provider} key '${tier}' is not supported. Supported tiers: ${MODEL_ALIAS_TIERS.join(', ')}.`,
        { code: 'INVALID_PIPELINE_CONFIG' },
      )
      invariant(
        typeof spec === 'string' && spec.length > 0,
        `${source}.${provider}.${tier} MUST be a non-empty executor:model string.`,
        { code: 'INVALID_PIPELINE_CONFIG' },
      )

      const prefix = /^([a-z][a-z0-9-]*):/u.exec(spec)?.[1]
      invariant(
        prefix !== undefined &&
          MODEL_CONFIG_EXECUTORS.includes(
            prefix as (typeof MODEL_CONFIG_EXECUTORS)[number],
          ),
        `${source}.${provider}.${tier} MUST use one of these executors: ${MODEL_CONFIG_EXECUTORS.join(', ')}.`,
        { code: 'INVALID_PIPELINE_CONFIG' },
      )

      const mapping = parsePersonaMapping(spec, `${source}.${provider}.${tier}`)

      if (mapping.executor === 'cursor' || mapping.executor === 'cursor-cli') {
        resolveCursorModelSlug(mapping, `${source}.${provider}.${tier}`)
      }

      tiers[tier] = spec
    }

    modelConfig[provider as ModelAliasFamily] = tiers
  }

  return modelConfig
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

function assertTrackedConfigUsesAliases(
  value: unknown,
  source: string,
  root: string,
): void {
  invariant(isRecord(value), `${source} MUST contain an object.`, {
    code: 'INVALID_PIPELINE_CONFIG',
  })

  const personaDirectory = path.join(root, 'library', 'cursor', 'agents')
  const hasCanonicalPersonas = fileExists(
    path.join(personaDirectory, 'coder.md'),
  )
  invariant(
    value.model_config === undefined,
    `${source}.model_config belongs in config_overrides.json.`,
    { code: 'INVALID_PIPELINE_CONFIG' },
  )

  for (const provider of MODEL_ALIAS_FAMILIES) {
    invariant(
      value[provider] === undefined,
      `${source}.${provider} model definitions belong in config_overrides.json.model_config.`,
      { code: 'INVALID_PIPELINE_CONFIG' },
    )
  }

  const assertAliasMap = (
    raw: unknown,
    mappingSource: string,
    allowEmpty: boolean,
  ): void => {
    if (raw === undefined) {
      return
    }

    invariant(isRecord(raw), `${mappingSource} MUST be an object.`, {
      code: 'INVALID_PIPELINE_CONFIG',
    })

    for (const [persona, model] of Object.entries(raw)) {
      if (persona === 'summary') {
        continue
      }
      if (persona === 'personas') {
        assertAliasMap(model, `${mappingSource}.personas`, allowEmpty)
        continue
      }
      if (allowEmpty && model === '') {
        continue
      }
      if (
        hasCanonicalPersonas &&
        !fileExists(path.join(personaDirectory, `${persona}.md`))
      ) {
        continue
      }

      invariant(
        typeof model === 'string' && parseAliasReference(model) !== null,
        `${mappingSource}.${persona} MUST use a provider:tier alias; executor-specific model strings belong in config_overrides.json.`,
        { code: 'INVALID_PIPELINE_CONFIG' },
      )
    }
  }

  assertAliasMap(value.defaults, `${source}.defaults`, false)

  if (value.configs !== undefined) {
    invariant(isRecord(value.configs), `${source}.configs MUST be an object.`, {
      code: 'INVALID_PIPELINE_CONFIG',
    })

    for (const [name, config] of Object.entries(value.configs)) {
      assertAliasMap(config, `${source}.configs.${name}`, true)
    }
  }
}

/**
 * Persona-to-model map of a named config: the file's `defaults` overlaid by
 * that config's personas. Throws `INVALID_PIPELINE_CONFIG` when the name is
 * not defined.
 */
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

/**
 * Validates a pipeline config document and returns it normalized, with model
 * alias tiers checked and persona aliases expanded through `model_config` to
 * explicit executor-specific specs. Throws `INVALID_PIPELINE_CONFIG` on a bad
 * shape, an unsupported or unresolved alias, a recursive alias, an invalid
 * executor mapping, an empty `configs`, or an undefined `active_config`.
 */
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

  const modelConfig = parseModelConfig(
    value.model_config,
    `${source}.model_config`,
  )
  const aliases: Record<ModelAliasFamily, ModelAliasMap> = {
    anthropic: modelConfig.anthropic ?? {},
    oai: modelConfig.oai ?? {},
    open: modelConfig.open ?? {},
    cursor: modelConfig.cursor ?? {},
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
    model_config: modelConfig,
    anthropic: aliases.anthropic,
    oai: aliases.oai,
    open: aliases.open,
    cursor: aliases.cursor,
    defaults,
    ...(operator ? { $operator: operator } : {}),
    configs,
  }
}

/**
 * Loads the effective harness config (with local overrides merged), parses
 * it, and returns the named config (the active one by default) with resolved
 * personas and a digest of the effective config. Throws
 * `INVALID_PIPELINE_CONFIG` when the file is missing or the config is
 * undefined or invalid.
 *
 * When a local Cursor model catalog exists, every Cursor or Cursor CLI persona
 * of every named config is also checked against it; `skipCatalog` bypasses that check.
 */
export function loadPipelineConfig(
  root: string,
  name?: string,
  options: { skipCatalog?: boolean } = {},
): LoadedPipelineConfig {
  const configName = harnessConfigName(root) ?? CONFIG_PATH
  const filePath = path.join(root, configName)

  invariant(fileExists(filePath), `Missing required file: ${CONFIG_PATH}`, {
    code: 'INVALID_PIPELINE_CONFIG',
  })

  // The digest covers the effective configuration, so a `config_overrides.json`
  // preference is indistinguishable from the same edit made in `config.json`.
  const baseConfig = readJson(filePath)
  assertTrackedConfigUsesAliases(baseConfig, configName, root)

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
  // `skipCatalog` is the models --sync --force path: project a stale or
  // incomplete catalog instead of refusing the configured specs.
  if (!options.skipCatalog) {
    const resolveModel = createCursorModelResolver(root)

    for (const candidate of Object.keys(file.configs)) {
      for (const [persona, model] of Object.entries(
        resolveConfigPersonas(file, candidate),
      )) {
        const mapping = parsePersonaMapping(model, `${candidate}.${persona}`)

        if (
          mapping.executor === 'cursor' ||
          mapping.executor === 'cursor-cli'
        ) {
          resolveModel(mapping, `${candidate}.${persona}`)
        }
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

/**
 * Every persona mapping the file declares, across every named config.
 *
 * The diagnostic commands read this to report which mappings a stale catalog
 * cannot resolve, instead of failing at config load the way a lifecycle
 * command still does.
 */
export function pipelineConfigPersonaMappings(
  file: PipelineConfigFile,
): Array<{ source: string; mapping: ParsedPersonaMapping }> {
  const mappings: Array<{ source: string; mapping: ParsedPersonaMapping }> = []

  for (const candidate of Object.keys(file.configs)) {
    for (const [persona, model] of Object.entries(
      resolveConfigPersonas(file, candidate),
    )) {
      const source = `${candidate}.${persona}`

      mappings.push({ source, mapping: parsePersonaMapping(model, source) })
    }
  }

  return mappings
}

/**
 * Freezes a loaded config into the run snapshot record: its name, source path
 * and digest, summary, a copy of the persona models, and each persona's
 * executor kind.
 */
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

/**
 * Reads a run's pipeline config snapshot from a root-relative path. Throws
 * `INVALID_PIPELINE_CONFIG` when it is not a schema-1 snapshot with non-empty
 * persona models, and `PATH_ESCAPE` when the path leaves the root.
 */
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

/**
 * Parses the model string a config or snapshot maps to a persona, verbatim,
 * checking a cursor model's slug. Throws `INVALID_PIPELINE_CONFIG` when the
 * persona has no model.
 */
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

  if (mapping.executor === 'cursor' || mapping.executor === 'cursor-cli') {
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

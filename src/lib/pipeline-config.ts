import { readdirSync } from 'node:fs'
import path from 'node:path'

import { invariant } from './errors.js'
import {
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
  sha256,
  writeTextAtomic,
} from './io.js'

export interface NamedPipelineConfig {
  summary?: string
  personas: Record<string, string>
}

export interface PipelineConfigFile {
  schema_version: 1
  active_config: string
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
}

export interface CursorAgentModelChange {
  persona: string
  path: string
  previous_model: string | null
  model: string
  changed: boolean
}

const CONFIG_PATH = 'project.json'

function parseNamedConfig(value: unknown, source: string): NamedPipelineConfig {
  invariant(isRecord(value), `${source} MUST be an object.`, {
    code: 'INVALID_PIPELINE_CONFIG',
  })
  invariant(isRecord(value.personas), `${source}.personas MUST be an object.`, {
    code: 'INVALID_PIPELINE_CONFIG',
  })

  const personas: Record<string, string> = {}

  for (const [persona, model] of Object.entries(value.personas)) {
    invariant(
      persona.length > 0 && typeof model === 'string' && model.length > 0,
      `${source}.personas.${persona} MUST be a non-empty model string.`,
      { code: 'INVALID_PIPELINE_CONFIG' },
    )

    personas[persona] = model
  }

  invariant(
    Object.keys(personas).length > 0,
    `${source}.personas MUST NOT be empty.`,
    { code: 'INVALID_PIPELINE_CONFIG' },
  )

  return {
    ...(typeof value.summary === 'string' ? { summary: value.summary } : {}),
    personas,
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

  const configs: Record<string, NamedPipelineConfig> = {}

  for (const [name, config] of Object.entries(value.configs)) {
    configs[name] = parseNamedConfig(config, `${source}.configs.${name}`)
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
    ...(operator ? { $operator: operator } : {}),
    configs,
  }
}

export function loadPipelineConfig(
  root: string,
  name?: string,
): LoadedPipelineConfig {
  const filePath = path.join(root, CONFIG_PATH)

  invariant(fileExists(filePath), `Missing required file: ${CONFIG_PATH}`, {
    code: 'INVALID_PIPELINE_CONFIG',
  })

  const raw = readText(filePath)
  const file = parsePipelineConfig(readJson(filePath), CONFIG_PATH)
  const resolvedName = name ?? file.active_config
  const config = file.configs[resolvedName]

  invariant(
    config !== undefined,
    `Pipeline config '${resolvedName}' is not defined in ${CONFIG_PATH}.`,
    { code: 'INVALID_PIPELINE_CONFIG' },
  )

  return {
    name: resolvedName,
    config,
    file,
    path: CONFIG_PATH,
    sha256: sha256(raw),
  }
}

export function makePipelineConfigSnapshot(
  loaded: LoadedPipelineConfig,
): PipelineConfigSnapshot {
  return {
    schema_version: 1,
    name: loaded.name,
    source_path: loaded.path,
    source_sha256: loaded.sha256,
    ...(loaded.config.summary ? { summary: loaded.config.summary } : {}),
    personas: structuredClone(loaded.config.personas),
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

export function resolvePersonaModel(
  config: NamedPipelineConfig | PipelineConfigSnapshot,
  persona: string,
): string {
  const model = config.personas[persona]

  invariant(
    typeof model === 'string' && model.length > 0,
    `Pipeline config does not map persona '${persona}' to a model.`,
    { code: 'INVALID_PIPELINE_CONFIG' },
  )

  return model
}

function agentFrontmatter(raw: string, source: string): RegExpExecArray {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(raw)

  invariant(match, `${source} MUST start with YAML frontmatter.`, {
    code: 'INVALID_CURSOR_AGENT',
  })

  return match
}

export function readCursorAgentModel(
  raw: string,
  source: string,
): string | null {
  const match = agentFrontmatter(raw, source)
  const model = /^model:\s*(.+)$/mu.exec(match[1] ?? '')?.[1]?.trim()

  return model?.replace(/^['"]|['"]$/gu, '') ?? null
}

export function setCursorAgentModel(
  raw: string,
  model: string,
  source: string,
): { content: string; previousModel: string | null; changed: boolean } {
  const match = agentFrontmatter(raw, source)
  const frontmatter = match[1] ?? ''
  const modelPattern = /^model:\s*.*$/mu
  const previousModel = readCursorAgentModel(raw, source)
  const nextFrontmatter = modelPattern.test(frontmatter)
    ? frontmatter.replace(modelPattern, `model: ${model}`)
    : `${frontmatter}\nmodel: ${model}`
  const content = raw.replace(match[0], `---\n${nextFrontmatter}\n---`)

  return { content, previousModel, changed: content !== raw }
}

export function syncCursorAgentModels(
  root: string,
  loaded: LoadedPipelineConfig,
  options: { write?: boolean } = {},
): CursorAgentModelChange[] {
  const agentsDirectory = path.join(root, '.cursor', 'agents')

  if (!fileExists(agentsDirectory)) {
    return []
  }

  const changes: CursorAgentModelChange[] = []

  for (const entry of readdirSync(agentsDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue
    }

    const persona = entry.name.slice(0, -3)
    const model = loaded.config.personas[persona]

    if (!model) {
      continue
    }

    const relativePath = `.cursor/agents/${entry.name}`
    const filePath = path.join(agentsDirectory, entry.name)
    const raw = readText(filePath)
    const result = setCursorAgentModel(raw, model, relativePath)

    if (options.write && result.changed) {
      writeTextAtomic(filePath, result.content)
    }

    changes.push({
      persona,
      path: relativePath,
      previous_model: result.previousModel,
      model,
      changed: result.changed,
    })
  }

  return changes.sort((left, right) =>
    left.persona.localeCompare(right.persona),
  )
}

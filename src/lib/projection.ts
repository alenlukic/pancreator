import { readdirSync } from 'node:fs'
import path from 'node:path'

import {
  projectCursorContent,
  type CursorInstallationMode,
} from './cursor-content.js'
import { invariant } from './errors.js'
import {
  fileExists,
  isRecord,
  readJson,
  readText,
  sha256,
  writeTextAtomic,
} from './io.js'
import { loadPipelineConfig } from './pipeline-config.js'
import { loadProjectConfig, panCommand } from './project-config.js'

interface ProjectionDefinition {
  id: string
  source: string
  target: string
  installation_modes: CursorInstallationMode[]
  generated_fields: string[]
  transforms: string[]
}

interface ProjectionManifest {
  schema_version: 2
  policy: string
  regeneration_command: string
  projections: ProjectionDefinition[]
}

interface RenderedProjection {
  id: string
  source: string
  target: string
  content: string
}

export interface CursorProjectionChange {
  id: string
  source: string
  path: string
  changed: boolean
  previous_sha256: string | null
  sha256: string
}

export interface ProjectionDriftResult {
  errors: string[]
  regeneration_command: string
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function readProjectionManifest(root: string): ProjectionManifest {
  const manifestPath = path.join(
    root,
    'governance',
    'registries',
    'projection_manifest.json',
  )
  const value = readJson(manifestPath)

  invariant(
    isRecord(value) && value.schema_version === 2,
    'projection manifest schema_version MUST be 2',
    { code: 'INVALID_PROJECTION_MANIFEST' },
  )
  invariant(
    value.policy === 'CONTRACT-001',
    'projection manifest policy MUST be CONTRACT-001',
    { code: 'INVALID_PROJECTION_MANIFEST' },
  )
  invariant(
    typeof value.regeneration_command === 'string' &&
      value.regeneration_command.length > 0,
    'projection manifest regeneration_command MUST be non-empty',
    { code: 'INVALID_PROJECTION_MANIFEST' },
  )
  invariant(
    Array.isArray(value.projections),
    'projection manifest projections MUST be an array',
    { code: 'INVALID_PROJECTION_MANIFEST' },
  )

  const projections = value.projections.map((entry, index) => {
    invariant(isRecord(entry), `projection ${index} MUST be an object`, {
      code: 'INVALID_PROJECTION_MANIFEST',
    })
    invariant(
      typeof entry.id === 'string' && entry.id.length > 0,
      `projection ${index}.id MUST be non-empty`,
      { code: 'INVALID_PROJECTION_MANIFEST' },
    )
    invariant(
      typeof entry.source === 'string' && entry.source.length > 0,
      `projection ${entry.id}.source MUST be non-empty`,
      { code: 'INVALID_PROJECTION_MANIFEST' },
    )
    invariant(
      typeof entry.target === 'string' && entry.target.startsWith('.cursor/'),
      `projection ${entry.id}.target MUST be under .cursor/`,
      { code: 'INVALID_PROJECTION_MANIFEST' },
    )
    invariant(
      !entry.source.startsWith('.cursor/'),
      `projection ${entry.id}.source MUST NOT be under .cursor/`,
      { code: 'INVALID_PROJECTION_MANIFEST' },
    )

    const installationModes = stringArray(entry.installation_modes)
    const generatedFields = stringArray(entry.generated_fields)
    const transforms = stringArray(entry.transforms)
    const sourceVariables = [...entry.source.matchAll(/\{([a-z_]+)\}/gu)].map(
      (match) => match[1],
    )
    const targetVariables = [...entry.target.matchAll(/\{([a-z_]+)\}/gu)].map(
      (match) => match[1],
    )

    invariant(
      installationModes.length > 0 &&
        installationModes.every(
          (mode) => mode === 'self_development' || mode === 'embedded',
        ),
      `projection ${entry.id}.installation_modes MUST contain supported modes`,
      { code: 'INVALID_PROJECTION_MANIFEST' },
    )
    invariant(
      generatedFields.every((field) => field === 'frontmatter.model'),
      `projection ${entry.id}.generated_fields contains an unsupported field`,
      { code: 'INVALID_PROJECTION_MANIFEST' },
    )
    invariant(
      transforms.every((transform) => transform === 'installation-paths'),
      `projection ${entry.id}.transforms contains an unsupported transform`,
      { code: 'INVALID_PROJECTION_MANIFEST' },
    )
    invariant(
      sourceVariables.length <= 1 &&
        targetVariables.length === sourceVariables.length &&
        sourceVariables.every(
          (variable, variableIndex) =>
            variable === targetVariables[variableIndex],
        ),
      `projection ${entry.id} source and target variables MUST match`,
      { code: 'INVALID_PROJECTION_MANIFEST' },
    )

    return {
      id: entry.id,
      source: entry.source,
      target: entry.target,
      installation_modes: installationModes as CursorInstallationMode[],
      generated_fields: generatedFields,
      transforms,
    }
  })

  invariant(
    new Set(projections.map((projection) => projection.id)).size ===
      projections.length,
    'projection manifest ids MUST be unique',
    { code: 'INVALID_PROJECTION_MANIFEST' },
  )

  return {
    schema_version: 2,
    policy: value.policy,
    regeneration_command: value.regeneration_command,
    projections,
  }
}

function expandProjection(
  root: string,
  projection: ProjectionDefinition,
): Array<{ source: string; target: string; variable: string | null }> {
  const match = /\{([a-z_]+)\}/u.exec(projection.source)

  if (!match) {
    return [
      {
        source: projection.source,
        target: projection.target,
        variable: null,
      },
    ]
  }

  const token = match[0]
  const sourceDirectory = path.dirname(projection.source)
  const basename = path.basename(projection.source)
  const [prefix, suffix] = basename.split(token)
  const absoluteDirectory = path.join(root, sourceDirectory)

  if (!fileExists(absoluteDirectory)) {
    return []
  }

  return readdirSync(absoluteDirectory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(prefix ?? '') &&
        entry.name.endsWith(suffix ?? ''),
    )
    .map((entry) => {
      const variable = entry.name.slice(
        (prefix ?? '').length,
        entry.name.length - (suffix ?? '').length,
      )

      return {
        source: projection.source.replace(token, variable),
        target: projection.target.replace(token, variable),
        variable,
      }
    })
    .sort((left, right) => left.target.localeCompare(right.target))
}

function installationMode(root: string): CursorInstallationMode {
  return loadProjectConfig(root).installation_mode ?? 'self_development'
}

function renderProjections(root: string): RenderedProjection[] {
  const manifest = readProjectionManifest(root)
  const mode = installationMode(root)
  const pipeline = loadPipelineConfig(root)
  const rendered: RenderedProjection[] = []

  for (const projection of manifest.projections) {
    if (!projection.installation_modes.includes(mode)) {
      continue
    }

    for (const entry of expandProjection(root, projection)) {
      const absoluteSource = path.join(root, entry.source)

      invariant(
        fileExists(absoluteSource),
        `Missing projection source: ${entry.source}`,
        {
          code: 'INVALID_PROJECTION_MANIFEST',
        },
      )

      let content = readText(absoluteSource)

      if (projection.generated_fields.includes('frontmatter.model')) {
        invariant(
          entry.variable !== null,
          `projection ${projection.id} requires a persona variable`,
          { code: 'INVALID_PROJECTION_MANIFEST' },
        )

        const model = pipeline.config.personas[entry.variable]

        invariant(
          typeof model === 'string' && model.length > 0,
          `Pipeline config does not map projection persona '${entry.variable}'.`,
          { code: 'INVALID_PIPELINE_CONFIG' },
        )
        invariant(
          content.includes('__PANCREATOR_MODEL__'),
          `${entry.source} MUST contain __PANCREATOR_MODEL__.`,
          { code: 'INVALID_CURSOR_AGENT' },
        )

        content = content.replaceAll('__PANCREATOR_MODEL__', model)
      }

      if (projection.transforms.includes('installation-paths')) {
        content = projectCursorContent(content, entry.target, mode)
      }

      rendered.push({
        id: projection.id,
        source: entry.source,
        target: entry.target,
        content,
      })
    }
  }

  return rendered.sort((left, right) => left.target.localeCompare(right.target))
}

/** Project canonical Pancreator Cursor artifacts into the local ignored .cursor tree. */
export function syncCursorProjection(
  root: string,
  options: { write?: boolean } = {},
): CursorProjectionChange[] {
  return renderProjections(root).map((entry) => {
    const targetPath = path.join(root, entry.target)
    const previous = fileExists(targetPath) ? readText(targetPath) : null
    const changed = previous !== entry.content

    if (options.write && changed) {
      writeTextAtomic(targetPath, entry.content)
    }

    return {
      id: entry.id,
      source: entry.source,
      path: entry.target,
      changed,
      previous_sha256: previous === null ? null : sha256(previous),
      sha256: sha256(entry.content),
    }
  })
}

/** Validate canonical projection ownership and optional local projection drift. */
export function validateProjectionDrift(root: string): ProjectionDriftResult {
  const errors: string[] = []
  let regenerationCommand = `${panCommand(root)} models --sync`

  try {
    const manifest = readProjectionManifest(root)
    regenerationCommand = manifest.regeneration_command.replace(
      './bin/pan',
      panCommand(root),
    )

    if (installationMode(root) === 'self_development') {
      const gitignorePath = path.join(root, '.gitignore')

      if (!fileExists(gitignorePath)) {
        errors.push('missing required file: .gitignore')
      } else {
        const lines = readText(gitignorePath)
          .split(/\r?\n/u)
          .map((line) => line.trim())
        const cursorNegations = lines.filter((line) =>
          line.startsWith('!.cursor/'),
        )

        if (!lines.includes('.cursor/')) {
          errors.push('.gitignore MUST ignore .cursor/ as a local projection')
        }

        if (cursorNegations.length > 0) {
          errors.push('.gitignore MUST NOT re-include files beneath .cursor/')
        }
      }
    }

    const targetModes = new Map<string, Set<CursorInstallationMode>>()

    for (const projection of manifest.projections) {
      const expanded = expandProjection(root, projection)

      if (expanded.length === 0) {
        errors.push(`projection ${projection.id} has no canonical source files`)
      }

      for (const entry of expanded) {
        if (!fileExists(path.join(root, entry.source))) {
          errors.push(`missing projection source: ${entry.source}`)
        }
      }

      const modes = targetModes.get(projection.target) ?? new Set()

      for (const mode of projection.installation_modes) {
        if (modes.has(mode)) {
          errors.push(
            `multiple projections target ${projection.target} in ${mode} mode`,
          )
        }

        modes.add(mode)
      }

      targetModes.set(projection.target, modes)
    }

    if (fileExists(path.join(root, '.cursor'))) {
      const changes = syncCursorProjection(root)
      const hasManagedProjection = changes.some((change) =>
        fileExists(path.join(root, change.path)),
      )

      if (hasManagedProjection) {
        for (const change of changes) {
          if (change.changed) {
            errors.push(
              `${change.path} projection drift; run ${regenerationCommand}`,
            )
          }
        }
      }
    }
  } catch (error) {
    errors.push(String(error))
  }

  return {
    errors: [...new Set(errors)],
    regeneration_command: regenerationCommand,
  }
}

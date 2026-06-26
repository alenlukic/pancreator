import { readdirSync } from 'node:fs'
import path from 'node:path'

import { fileExists, isRecord, readJson, readText } from './io.js'
import {
  loadPipelineConfig,
  readCursorAgentModel,
  syncCursorAgentModels,
} from './pipeline-config.js'

export interface ProjectionDriftResult {
  errors: string[]
  regeneration_command: string
}

function validateGeneratedField(
  root: string,
  field: string,
  targetPath: string,
  expectedModel: string,
): string | null {
  if (field !== 'frontmatter.model') {
    return null
  }

  const absolute = path.join(root, targetPath)

  if (!fileExists(absolute)) {
    return null
  }

  const observed = readCursorAgentModel(readText(absolute), targetPath)

  if (observed !== expectedModel) {
    return (
      `${targetPath} model drift: expected '${expectedModel}', ` +
      `found '${observed ?? 'missing'}'`
    )
  }

  return null
}

/** Validate declared Cursor projection drift against canonical sources. */
export function validateProjectionDrift(root: string): ProjectionDriftResult {
  const errors: string[] = []
  const manifestPath = path.join(root, 'governance', 'projection_manifest.json')
  const value = readJson(manifestPath)

  if (!isRecord(value)) {
    return {
      errors: ['projection manifest is missing or invalid'],
      regeneration_command: './bin/pan models --sync',
    }
  }

  const regenerationCommand =
    typeof value.regeneration_command === 'string'
      ? value.regeneration_command
      : './bin/pan models --sync'
  const projections = Array.isArray(value.projections) ? value.projections : []
  const pipelineConfig = loadPipelineConfig(root)
  const personaDir = path.join(root, 'library', 'personas')

  for (const projection of projections) {
    if (!isRecord(projection)) {
      continue
    }

    const canonicalPattern =
      typeof projection.canonical === 'string' ? projection.canonical : ''
    const targetPattern =
      typeof projection.target === 'string' ? projection.target : ''
    const generatedFields = Array.isArray(projection.generated_fields)
      ? projection.generated_fields.filter(
          (field): field is string => typeof field === 'string',
        )
      : []

    if (
      !canonicalPattern.includes('{persona}') ||
      !targetPattern.includes('{persona}') ||
      !fileExists(personaDir)
    ) {
      continue
    }

    for (const entry of readdirSync(personaDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue
      }

      const persona = entry.name.slice(0, -3)
      const expectedModel = pipelineConfig.config.personas[persona]

      if (!expectedModel) {
        continue
      }

      const targetPath = targetPattern.replace('{persona}', persona)

      for (const field of generatedFields) {
        const drift = validateGeneratedField(
          root,
          field,
          targetPath,
          expectedModel,
        )

        if (drift) {
          errors.push(`${drift}; run ${regenerationCommand}`)
        }
      }
    }
  }

  try {
    for (const entry of syncCursorAgentModels(root, pipelineConfig)) {
      if (entry.changed) {
        errors.push(
          `${entry.path} model drift: expected '${entry.model}', ` +
            `found '${entry.previous_model ?? 'missing'}'; run ${regenerationCommand}`,
        )
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

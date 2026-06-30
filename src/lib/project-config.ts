import path from 'node:path'

import { invariant } from './errors.js'
import { fileExists, isRecord, readJson } from './io.js'
import type { ProjectConfig } from './types.js'

const PROJECT_CONFIG_PATH = 'project.json'

export function readProjectConfig(root: string): ProjectConfig | null {
  const configPath = path.join(root, PROJECT_CONFIG_PATH)

  if (!fileExists(configPath)) {
    return null
  }

  const value = readJson(configPath)

  invariant(
    isRecord(value) && value.schema_version === 1,
    `Invalid project configuration: ${configPath}`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  invariant(
    value.workspace_id === undefined || typeof value.workspace_id === 'string',
    `${PROJECT_CONFIG_PATH}.workspace_id MUST be a string when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  invariant(
    value.workspace_root === undefined ||
      (typeof value.workspace_root === 'string' &&
        value.workspace_root.length > 0),
    `${PROJECT_CONFIG_PATH}.workspace_root MUST be a non-empty string when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  invariant(
    value.state_root === undefined ||
      (typeof value.state_root === 'string' && value.state_root.length > 0),
    `${PROJECT_CONFIG_PATH}.state_root MUST be a non-empty string when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  invariant(
    value.installation_mode === undefined ||
      value.installation_mode === 'self_development' ||
      value.installation_mode === 'embedded',
    `${PROJECT_CONFIG_PATH}.installation_mode MUST be self_development or embedded when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  return value as unknown as ProjectConfig
}

export function loadProjectConfig(root: string): ProjectConfig {
  const config = readProjectConfig(root)

  invariant(config, `Missing required file: ${PROJECT_CONFIG_PATH}`, {
    code: 'INVALID_PROJECT_CONFIG',
  })

  return config
}

export function configuredWorkspaceRoot(root: string): string {
  return loadProjectConfig(root).workspace_root ?? '.'
}

export function isSelfDevelopmentInstallation(root: string): boolean {
  return loadProjectConfig(root).installation_mode === 'self_development'
}

export function isEmbeddedInstallation(root: string): boolean {
  return loadProjectConfig(root).installation_mode === 'embedded'
}

export function panCommand(root: string): string {
  return isEmbeddedInstallation(root) ? './.pancreator/bin/pan' : './bin/pan'
}

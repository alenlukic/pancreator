import path from 'node:path'

import { EMBEDDED_HARNESS_PREFIX } from './cursor-content.js'
import { invariant } from './errors.js'
import { fileExists, isRecord, readJson } from './io.js'
import type { ProjectConfig } from './types.js'

const PROJECT_CONFIG_PATH = 'config.json'

/**
 * Pre-rename installations keep the harness configuration at `project.json`.
 * `bin/install` migrates the file in place, but the CLI MUST stay usable in an
 * installation that has not been refreshed yet, so reads fall back to the
 * legacy name. Remove once no supported installation predates the rename.
 */
const LEGACY_PROJECT_CONFIG_PATH = 'project.json'

/**
 * Root-relative name of the harness configuration present in `root`, or null
 * when neither the current nor the legacy name exists.
 */
export function harnessConfigName(root: string): string | null {
  if (fileExists(path.join(root, PROJECT_CONFIG_PATH))) {
    return PROJECT_CONFIG_PATH
  }

  return fileExists(path.join(root, LEGACY_PROJECT_CONFIG_PATH))
    ? LEGACY_PROJECT_CONFIG_PATH
    : null
}

function resolveConfigPath(root: string): string | null {
  const name = harnessConfigName(root)

  return name ? path.join(root, name) : null
}

export function readProjectConfig(root: string): ProjectConfig | null {
  const configPath = resolveConfigPath(root)

  if (!configPath) {
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
      value.installation_mode === 'embedded' ||
      value.installation_mode === 'detached',
    `${PROJECT_CONFIG_PATH}.installation_mode MUST be self_development, embedded, or detached when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  // A detached harness cannot reach its target by a relative path that would
  // survive being moved, so the target MUST be recorded absolutely.
  invariant(
    value.installation_mode !== 'detached' ||
      (typeof value.workspace_root === 'string' &&
        path.isAbsolute(value.workspace_root)),
    `${PROJECT_CONFIG_PATH}.workspace_root MUST be an absolute path for a detached installation.`,
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

export function isDetachedInstallation(root: string): boolean {
  return loadProjectConfig(root).installation_mode === 'detached'
}

/**
 * True when the harness governs a separate target repository, whether it lives
 * inside that repository (`embedded`) or outside it (`detached`). Use this for
 * every rule about target-repository semantics; reserve
 * `isEmbeddedInstallation` for questions that are genuinely about the harness
 * sitting inside the target tree.
 */
export function isTargetInstallation(root: string): boolean {
  const mode = loadProjectConfig(root).installation_mode

  return mode === 'embedded' || mode === 'detached'
}

/**
 * Harness prefix that Cursor filesystem operations must use to reach the
 * installation from the target repository.
 */
export function harnessPathPrefix(root: string): string {
  return isDetachedInstallation(root) ? root : EMBEDDED_HARNESS_PREFIX
}

export function panCommand(root: string): string {
  if (isDetachedInstallation(root)) {
    return path.join(root, 'bin', 'pan')
  }

  return isEmbeddedInstallation(root)
    ? `./${EMBEDDED_HARNESS_PREFIX}/bin/pan`
    : './bin/pan'
}

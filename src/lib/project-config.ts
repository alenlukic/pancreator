import path from 'node:path'

import { EMBEDDED_HARNESS_PREFIX } from './cursor-content.js'
import { invariant } from './errors.js'
import { fileExists, isRecord, readJson } from './io.js'
import type {
  ProjectConfig,
  ResolvedWorktreesConfig,
  ReviewMode,
} from './types.js'

/** Review method a run adopts when `config.json` declares none. */
export const DEFAULT_REVIEW_MODE: ReviewMode = 'default'

/**
 * Operator worktrees share `runtime/worktrees/` with best-of-N sessions. The
 * fixed `operator` child keeps the two apart, so `pan best-of-n clean` can
 * never reach a worktree an operator created by hand.
 */
export const DEFAULT_WORKTREE_ROOT = 'runtime/worktrees/operator'

/** Branch prefix that keeps harness branches recognizable in `git branch`. */
export const DEFAULT_WORKTREE_BRANCH_PREFIX = 'pan-wt/'

const PROJECT_CONFIG_PATH = 'config.json'

/**
 * Pre-rename installations keep the harness configuration at `project.json`.
 * `bin/install` migrates the file in place, but the CLI MUST stay usable in an
 * installation that has not been refreshed yet, so reads fall back to the
 * legacy name. Remove once no supported installation predates the rename.
 */
const LEGACY_PROJECT_CONFIG_PATH = 'project.json'

/**
 * Untracked operator-local overrides, merged over the checked-in harness
 * configuration. The checked-in `config.json` carries the recommended defaults
 * a release can update; this file holds per-checkout preferences such as
 * `active_config` or persona model overrides.
 */
export const LOCAL_CONFIG_PATH = 'config.local.json'

/** Objects merge recursively; any other local value replaces the base value. */
function mergeConfigValues(base: unknown, override: unknown): unknown {
  if (!isRecord(base) || !isRecord(override)) {
    return override
  }

  const merged: Record<string, unknown> = { ...base }

  for (const [key, value] of Object.entries(override)) {
    merged[key] = mergeConfigValues(base[key], value)
  }

  return merged
}

/**
 * Read a harness configuration file with `config.local.json` merged over it.
 * Every reader of the harness configuration goes through this, so a local
 * preference behaves exactly as if it were edited into `config.json`.
 */
export function readHarnessConfig(root: string, filePath: string): unknown {
  const value = readJson(filePath)
  const localPath = path.join(root, LOCAL_CONFIG_PATH)

  if (!fileExists(localPath)) {
    return value
  }

  const local = readJson(localPath)

  invariant(isRecord(local), `${LOCAL_CONFIG_PATH} MUST contain an object.`, {
    code: 'INVALID_PROJECT_CONFIG',
  })

  return mergeConfigValues(value, local)
}

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

function assertWorktreesBlock(value: unknown): void {
  if (value === undefined) {
    return
  }

  invariant(
    isRecord(value),
    `${PROJECT_CONFIG_PATH}.worktrees MUST be an object when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  invariant(
    value.root === undefined ||
      (typeof value.root === 'string' &&
        value.root.trim().length > 0 &&
        !path.isAbsolute(value.root) &&
        path.normalize(value.root) !== '..' &&
        !path.normalize(value.root).startsWith(`..${path.sep}`)),
    `${PROJECT_CONFIG_PATH}.worktrees.root MUST be a non-empty repository-relative path when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  invariant(
    value.branch_prefix === undefined ||
      (typeof value.branch_prefix === 'string' &&
        value.branch_prefix.length > 0 &&
        !/\s/u.test(value.branch_prefix)),
    `${PROJECT_CONFIG_PATH}.worktrees.branch_prefix MUST be a non-empty string without whitespace when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  if (value.setup === undefined) {
    return
  }

  invariant(
    Array.isArray(value.setup),
    `${PROJECT_CONFIG_PATH}.worktrees.setup MUST be an array when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  for (const [index, command] of value.setup.entries()) {
    invariant(
      typeof command === 'string' && command.trim().length > 0,
      `${PROJECT_CONFIG_PATH}.worktrees.setup[${index}] MUST be a non-empty command string.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
  }
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

  const value = readHarnessConfig(root, configPath)

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

  invariant(
    value.review_mode === undefined ||
      value.review_mode === 'default' ||
      value.review_mode === 'squad',
    `${PROJECT_CONFIG_PATH}.review_mode MUST be default or squad when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  assertWorktreesBlock(value.worktrees)

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

/** Worktree defaults for this installation, with code defaults applied. */
export function worktreesConfig(root: string): ResolvedWorktreesConfig {
  const configured = loadProjectConfig(root).worktrees

  return {
    root: configured?.root ?? DEFAULT_WORKTREE_ROOT,
    branch_prefix: configured?.branch_prefix ?? DEFAULT_WORKTREE_BRANCH_PREFIX,
    setup: configured?.setup ?? [],
  }
}

/**
 * Review method for a new run. `selected` comes from `pan init --review-mode`
 * and overrides the configured default for that run only.
 */
export function resolveReviewMode(
  root: string,
  selected?: string | null,
): ReviewMode {
  if (selected !== undefined && selected !== null) {
    invariant(
      selected === 'default' || selected === 'squad',
      `Unknown review mode '${selected}'. Available: default, squad.`,
      { code: 'INVALID_REVIEW_MODE' },
    )

    return selected
  }

  return loadProjectConfig(root).review_mode ?? DEFAULT_REVIEW_MODE
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

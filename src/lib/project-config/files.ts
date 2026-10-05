/**
 * Configuration file locations, managed worktree defaults, and the merge of
 * the tracked harness configuration with its local override.
 */

import path from 'node:path'

import { invariant } from '../errors.js'
import { fileExists, isRecord, readJson } from '../io.js'
import type { AwayModeAction } from '../types.js'

/** Top-level managed worktree root for current installations. */
export const CURRENT_MANAGED_WORKTREES_ROOT = 'worktrees'

/** Legacy managed worktree root kept for read-side compatibility. */
export const LEGACY_MANAGED_WORKTREES_ROOT = 'runtime/worktrees'

/**
 * Operator worktrees share the managed root with best-of-N sessions. The fixed
 * `operator` child keeps the two apart, so `pan best-of-n clean` can never
 * reach a worktree an operator created by hand.
 */
export const DEFAULT_WORKTREE_ROOT = 'worktrees/operator'

/** Legacy default operator worktree directory. */
export const LEGACY_DEFAULT_WORKTREE_ROOT = 'runtime/worktrees/operator'

/** Candidate worktree path for a new best-of-N session slot. */
export function bestOfNCandidatePath(bonId: string, slot: string): string {
  return path.posix.join(CURRENT_MANAGED_WORKTREES_ROOT, bonId, slot)
}

/** Legacy candidate worktree path kept for read-side compatibility. */
export function legacyBestOfNCandidatePath(
  bonId: string,
  slot: string,
): string {
  return path.posix.join(LEGACY_MANAGED_WORKTREES_ROOT, bonId, slot)
}

/**
 * Legacy branch prefix retained on the read side for existing configuration.
 * New managed worktrees use their exact operator-provided names as branches.
 */
export const DEFAULT_WORKTREE_BRANCH_PREFIX = 'worktree/'

export const PROJECT_CONFIG_PATH = 'config.json'

/**
 * Pre-rename installations keep the harness configuration at `project.json`.
 * `bin/install` migrates the file in place, but the CLI MUST stay usable in an
 * installation that has not been refreshed yet, so reads fall back to the
 * legacy name. Remove once no supported installation predates the rename.
 */
const LEGACY_PROJECT_CONFIG_PATH = 'project.json'

export const AWAY_MODE_ACTIONS = [
  'approve',
  'reject',
  'revise',
  'resume',
  'set-stage',
  'waive-gate',
] as const satisfies readonly AwayModeAction[]

export const DEFAULT_AWAY_MODE_ACTIONS = [...AWAY_MODE_ACTIONS]
export const DEFAULT_RETENTION_DAYS = 30

/** Operator clients `config.json` `hosts` can enable. */
export const PROJECT_HOSTS = ['cursor', 'vscode'] as const

export type ProjectHost = (typeof PROJECT_HOSTS)[number]

/** An installation without a `hosts` value behaves as Cursor only. */
export const DEFAULT_PROJECT_HOSTS: readonly ProjectHost[] = ['cursor']

/**
 * Untracked operator-local overrides, merged over the checked-in harness
 * configuration. The checked-in `config.json` carries the recommended defaults
 * a release can update; this file holds per-checkout preferences such as
 * `active_config` or persona model overrides.
 */
export const LOCAL_CONFIG_PATH = 'config_overrides.json'

/**
 * Pre-rename installations keep operator overrides at `config.local.json`.
 * Reads fall back to the legacy name so an installation stays usable before
 * its operator renames the file. Remove once no supported installation
 * predates the rename.
 */
export const LEGACY_LOCAL_CONFIG_PATH = 'config.local.json'

/** Root-relative name of the operator-overrides file present in `root`. */
export function localConfigName(root: string): string {
  if (fileExists(path.join(root, LOCAL_CONFIG_PATH))) {
    return LOCAL_CONFIG_PATH
  }

  return fileExists(path.join(root, LEGACY_LOCAL_CONFIG_PATH))
    ? LEGACY_LOCAL_CONFIG_PATH
    : LOCAL_CONFIG_PATH
}

/** Objects merge recursively; any other local value replaces the base value. */
export function mergeConfigValues(base: unknown, override: unknown): unknown {
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
 * Read a harness configuration file with `config_overrides.json` merged over
 * it. Every reader of the harness configuration goes through this, so a local
 * preference behaves exactly as if it were edited into `config.json`.
 */
export function readHarnessConfig(root: string, filePath: string): unknown {
  const value = readJson(filePath)
  const localName = localConfigName(root)
  const localPath = path.join(root, localName)

  if (!fileExists(localPath)) {
    return value
  }

  const local = readJson(localPath)

  invariant(isRecord(local), `${localName} MUST contain an object.`, {
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

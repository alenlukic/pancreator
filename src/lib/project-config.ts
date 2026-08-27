import path from 'node:path'

import { EMBEDDED_HARNESS_PREFIX } from './cursor-content.js'
import { invariant } from './errors.js'
import { fileExists, isRecord, readJson, sha256 } from './io.js'
import type {
  AwayModeAction,
  ProjectConfig,
  ResolvedAwayModeConfig,
  ResolvedWorktreesConfig,
  ReviewMode,
} from './types.js'

/** Review method a run adopts when `config.json` declares none. */
export const DEFAULT_REVIEW_MODE: ReviewMode = 'default'

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

/**
 * The operator worktree root `config.json` declares, or `undefined` when it
 * declares none. Only an absent declaration follows the default relocation
 * from `runtime/worktrees/operator` to `worktrees/operator`; a declared root
 * stays exactly where the operator put it.
 */
export function configuredWorktreeRoot(root: string): string | undefined {
  return loadProjectConfig(root).worktrees?.root
}

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
 * Branch prefix that keeps harness branches recognizable in `git branch`.
 * Configurable per installation via `worktrees.branch_prefix` in
 * `config.json`; the prefix is concatenated directly with the worktree name,
 * so the trailing separator belongs to the prefix.
 */
export const DEFAULT_WORKTREE_BRANCH_PREFIX = 'worktree/'

const PROJECT_CONFIG_PATH = 'config.json'

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
] as const satisfies readonly AwayModeAction[]

const DEFAULT_AWAY_MODE_ACTIONS = [...AWAY_MODE_ACTIONS]
const DEFAULT_MAX_AWAY_DECISIONS_PER_RUN = 3
const DEFAULT_MAX_REMEDIATION_ATTEMPTS_PER_AGENT = 2

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

function assertPositiveInteger(value: unknown, source: string): void {
  invariant(
    value === undefined || (Number.isInteger(value) && (value as number) > 0),
    `${source} MUST be a positive integer when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
}

function assertAwayModeBlock(value: unknown): void {
  if (value === undefined) {
    return
  }

  invariant(
    isRecord(value) && typeof value.enabled === 'boolean',
    `${PROJECT_CONFIG_PATH}.away_mode MUST contain enabled as a boolean.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  const guardrails = value.guardrails

  if (guardrails === undefined) {
    return
  }

  invariant(
    isRecord(guardrails),
    `${PROJECT_CONFIG_PATH}.away_mode.guardrails MUST be an object when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  invariant(
    guardrails.allowed_actions === undefined ||
      (Array.isArray(guardrails.allowed_actions) &&
        guardrails.allowed_actions.every(
          (action) =>
            typeof action === 'string' &&
            AWAY_MODE_ACTIONS.includes(action as AwayModeAction),
        )),
    `${PROJECT_CONFIG_PATH}.away_mode.guardrails.allowed_actions MUST contain only approve, reject, revise, resume, or set-stage.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  assertPositiveInteger(
    guardrails.max_decisions_per_run,
    `${PROJECT_CONFIG_PATH}.away_mode.guardrails.max_decisions_per_run`,
  )
  assertPositiveInteger(
    guardrails.max_remediation_attempts_per_agent,
    `${PROJECT_CONFIG_PATH}.away_mode.guardrails.max_remediation_attempts_per_agent`,
  )
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
    value.state_size_budget_bytes === undefined ||
      (Number.isInteger(value.state_size_budget_bytes) &&
        (value.state_size_budget_bytes as number) > 0),
    `${PROJECT_CONFIG_PATH}.state_size_budget_bytes MUST be a positive integer when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  invariant(
    value.stage_liveness_ms === undefined ||
      (Number.isInteger(value.stage_liveness_ms) &&
        (value.stage_liveness_ms as number) > 0),
    `${PROJECT_CONFIG_PATH}.stage_liveness_ms MUST be a positive integer when present.`,
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
  assertAwayModeBlock(value.away_mode)

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

/** Away-mode settings for a new run, with safe defaults and a source digest. */
export function resolveAwayModeConfig(root: string): ResolvedAwayModeConfig {
  const configured = loadProjectConfig(root).away_mode
  const allowedActions =
    configured?.guardrails?.allowed_actions ?? DEFAULT_AWAY_MODE_ACTIONS

  return {
    enabled: configured?.enabled ?? false,
    guardrails: {
      allowed_actions: [...allowedActions],
      max_decisions_per_run:
        configured?.guardrails?.max_decisions_per_run ??
        DEFAULT_MAX_AWAY_DECISIONS_PER_RUN,
      max_remediation_attempts_per_agent:
        configured?.guardrails?.max_remediation_attempts_per_agent ??
        DEFAULT_MAX_REMEDIATION_ATTEMPTS_PER_AGENT,
    },
    source_sha256: sha256(configured ?? { enabled: false }),
  }
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

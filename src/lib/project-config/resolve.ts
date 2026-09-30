/**
 * The loaded project configuration, installation identity and mode, and the
 * resolvers that apply defaults to one configuration block.
 */

import path from 'node:path'

import { EMBEDDED_HARNESS_PREFIX } from '../cursor-content.js'
import { invariant } from '../errors.js'
import { isRecord, sha256 } from '../io.js'
import { testScratchDeclarationError } from '../test-scratch.js'
import type {
  ProjectConfig,
  RegisteredInstallation,
  ResolvedWorktreesConfig,
  AwayModeConfig,
  ResolvedAwayModeConfig,
  HandoffConfig,
} from '../types.js'
import {
  DEFAULT_AWAY_MODE_ACTIONS,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_WORKTREE_BRANCH_PREFIX,
  DEFAULT_WORKTREE_ROOT,
  PROJECT_CONFIG_PATH,
  harnessConfigName,
  readHarnessConfig,
} from './files.js'
import {
  DEFAULT_HANDOFF_EFFORT,
  DEFAULT_HANDOFF_MODEL,
  assertAwayModeBlock,
  assertFastWallBlock,
  assertHandoffBlock,
  assertInstallationsBlock,
  assertRetentionBlock,
  assertScheduleBlock,
  assertSpendBlock,
  assertWorktreesBlock,
} from './blocks.js'

/**
 * The operator worktree root `config.json` declares, or `undefined` when it
 * declares none. Only an absent declaration follows the default relocation
 * from `runtime/worktrees/operator` to `worktrees/operator`; a declared root
 * stays exactly where the operator put it.
 */
export function configuredWorktreeRoot(root: string): string | undefined {
  return loadProjectConfig(root).worktrees?.root
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

  assertWorktreesBlock(value.worktrees)
  assertRetentionBlock(value.retention)
  assertAwayModeBlock(value.away_mode)
  assertInstallationsBlock(value.installations)
  assertScheduleBlock(value.schedule)
  assertFastWallBlock(value.fast_wall)
  assertSpendBlock(value.spend)
  assertHandoffBlock(value.handoff)

  const testScratchError = testScratchDeclarationError(value.test_scratch)

  invariant(testScratchError === null, testScratchError ?? '', {
    code: 'INVALID_PROJECT_CONFIG',
  })

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

/**
 * The subset of a registered installation's configuration that requires no
 * schema currency: `installation_mode` and `workspace_root`. A version-skewed
 * installation's `config.json` can fail `readProjectConfig` against this
 * checkout's current schema (a required field added after that installation
 * was last refreshed) even though its own harness still accepts it. Callers
 * that only need to know what kind of installation this is, and where its
 * workspace sits, read this instead of the full-schema reader so a schema
 * failure never blanks fields that do not depend on it.
 *
 * Returns null when no config file exists. Throws when the file exists but
 * is not valid JSON, or its `config_overrides.json` is not an object, exactly
 * as `readHarnessConfig` does. Type-checks only the two returned fields: an
 * out-of-range `installation_mode` reads as null rather than throwing, and a
 * non-string or empty `workspace_root` reads as null the same way.
 */
export function readInstallationIdentity(root: string): {
  installation_mode: 'self_development' | 'embedded' | 'detached' | null
  workspace_root: string | null
} | null {
  const configPath = resolveConfigPath(root)

  if (!configPath) {
    return null
  }

  const value = readHarnessConfig(root, configPath)

  if (!isRecord(value)) {
    return null
  }

  const mode =
    value.installation_mode === 'self_development' ||
    value.installation_mode === 'embedded' ||
    value.installation_mode === 'detached'
      ? value.installation_mode
      : null

  const workspaceRoot =
    typeof value.workspace_root === 'string' && value.workspace_root.length > 0
      ? value.workspace_root
      : null

  return { installation_mode: mode, workspace_root: workspaceRoot }
}

export function configuredWorkspaceRoot(root: string): string {
  return loadProjectConfig(root).workspace_root ?? '.'
}

export function registeredInstallations(
  root: string,
): RegisteredInstallation[] {
  return (loadProjectConfig(root).installations ?? []).map((entry) => ({
    id: entry.id,
    path: entry.path,
  }))
}

export function resolveRegisteredInstallation(
  root: string,
  id: string,
): RegisteredInstallation {
  const installations = registeredInstallations(root)
  const installation = installations.find((entry) => entry.id === id)

  invariant(
    installation,
    `Unknown installation '${id}'. Registered installations: ${
      installations.map((entry) => entry.id).join(', ') || '(none)'
    }.`,
    {
      code: 'UNKNOWN_INSTALLATION',
      details: { id, registered_ids: installations.map((entry) => entry.id) },
    },
  )

  return installation
}

/** Worktree defaults for this installation, with code defaults applied. */
export function worktreesConfig(root: string): ResolvedWorktreesConfig {
  const configured = loadProjectConfig(root).worktrees

  return {
    root: configured?.root ?? DEFAULT_WORKTREE_ROOT,
    branch_prefix: configured?.branch_prefix ?? DEFAULT_WORKTREE_BRANCH_PREFIX,
    setup: configured?.setup ?? [],
    readiness_paths: configured?.readiness_paths ?? [],
  }
}

/** Apply the configured class, default, and built-in retention precedence. */
export function retentionDaysFromConfig(
  config: Pick<ProjectConfig, 'retention'> | null | undefined,
  className: string,
): number {
  return (
    config?.retention?.classes?.[className] ??
    config?.retention?.default_days ??
    DEFAULT_RETENTION_DAYS
  )
}

/**
 * Retention window for one harness-owned ephemeral artifact class. A root
 * without `config.json` takes the built-in default: the installer runs runtime
 * maintenance over the new harness directory before it writes that file.
 */
export function resolveRetentionDays(root: string, className: string): number {
  return retentionDaysFromConfig(readProjectConfig(root), className)
}

/** Away-mode settings for a new run, with safe defaults and a source digest. */
export function resolveAwayModeConfig(
  root: string,
  profileAwayMode?: AwayModeConfig,
): ResolvedAwayModeConfig {
  const configured = profileAwayMode ?? loadProjectConfig(root).away_mode
  const allowedActions =
    configured?.guardrails?.allowed_actions ?? DEFAULT_AWAY_MODE_ACTIONS

  return {
    enabled: configured?.enabled ?? false,
    guardrails: {
      allowed_actions: [...allowedActions],
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

/** Longest picker label a `pan handoff` flag may name, in UTF-8 bytes. */
export const HANDOFF_LABEL_MAX_BYTES = 100

function assertHandoffFlag(name: string, value: string | undefined): void {
  if (value === undefined) {
    return
  }

  invariant(
    value.trim().length > 0 &&
      !/[\r\n]/u.test(value) &&
      Buffer.byteLength(value, 'utf8') <= HANDOFF_LABEL_MAX_BYTES,
    `--${name} MUST be one non-empty line of at most ` +
      `${HANDOFF_LABEL_MAX_BYTES} bytes that names a Cursor picker label.`,
    { code: 'INVALID_ARGUMENT' },
  )
}

/**
 * Resolve model and effort for `pan handoff` with flag, then config, then
 * built-in default precedence. A flag that is present MUST be a valid label;
 * it never falls back silently.
 */
export function resolveHandoffConfig(
  config: ProjectConfig | null,
  flags?: { model?: string; effort?: string },
): HandoffConfig {
  assertHandoffFlag('model', flags?.model)
  assertHandoffFlag('effort', flags?.effort)

  const model =
    flags?.model ??
    ((config?.handoff?.model ?? '').trim().length > 0
      ? (config?.handoff?.model as string)
      : DEFAULT_HANDOFF_MODEL)

  const effort =
    flags?.effort ??
    ((config?.handoff?.effort ?? '').trim().length > 0
      ? (config?.handoff?.effort as string)
      : DEFAULT_HANDOFF_EFFORT)

  return { model, effort }
}

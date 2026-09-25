import path from 'node:path'

import { EMBEDDED_HARNESS_PREFIX } from './cursor-content.js'
import { invariant } from './errors.js'
import { fileExists, isRecord, readJson, sha256 } from './io.js'
import { testScratchDeclarationError } from './test-scratch.js'
import type {
  AwayModeAction,
  AwayModeConfig,
  ProjectConfig,
  RegisteredInstallation,
  ResolvedAwayModeConfig,
  ResolvedWorktreesConfig,
} from './types.js'

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
 * Legacy branch prefix retained on the read side for existing configuration.
 * New managed worktrees use their exact operator-provided names as branches.
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
  'waive-gate',
] as const satisfies readonly AwayModeAction[]

const DEFAULT_AWAY_MODE_ACTIONS = [...AWAY_MODE_ACTIONS]
const DEFAULT_MAX_AWAY_DECISIONS_PER_RUN = 3
const DEFAULT_MAX_REMEDIATION_ATTEMPTS_PER_AGENT = 2
export const DEFAULT_RETENTION_DAYS = 30

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

  assertWorktreeReadinessPaths(value.readiness_paths)

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

function assertWorktreeReadinessPaths(value: unknown): void {
  if (value === undefined) {
    return
  }

  invariant(
    Array.isArray(value),
    `${PROJECT_CONFIG_PATH}.worktrees.readiness_paths MUST be an array when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  for (const [index, entry] of value.entries()) {
    const source = `${PROJECT_CONFIG_PATH}.worktrees.readiness_paths[${index}]`

    invariant(
      typeof entry === 'string' &&
        entry.trim().length > 0 &&
        !path.isAbsolute(entry) &&
        !path.normalize(entry).startsWith('..'),
      `${source} MUST be a non-empty worktree-relative path.`,
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

function assertRetentionBlock(value: unknown): void {
  if (value === undefined) {
    return
  }

  invariant(
    isRecord(value),
    `${PROJECT_CONFIG_PATH}.retention MUST be an object when present.`,
    { code: 'INVALID_RETENTION_DAYS' },
  )
  invariant(
    value.default_days === undefined ||
      (Number.isInteger(value.default_days) &&
        (value.default_days as number) > 0),
    `${PROJECT_CONFIG_PATH}.retention.default_days MUST be a positive integer when present.`,
    { code: 'INVALID_RETENTION_DAYS' },
  )
  invariant(
    value.classes === undefined || isRecord(value.classes),
    `${PROJECT_CONFIG_PATH}.retention.classes MUST be an object when present.`,
    { code: 'INVALID_RETENTION_DAYS' },
  )

  if (!isRecord(value.classes)) {
    return
  }

  for (const [className, days] of Object.entries(value.classes)) {
    invariant(
      className.trim().length > 0 &&
        Number.isInteger(days) &&
        (days as number) > 0,
      `${PROJECT_CONFIG_PATH}.retention.classes.${className || '(empty)'} MUST be a positive integer.`,
      { code: 'INVALID_RETENTION_DAYS' },
    )
  }
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
    `${PROJECT_CONFIG_PATH}.away_mode.guardrails.allowed_actions MUST contain only ${AWAY_MODE_ACTIONS.join(', ')}.`,
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

const SCHEDULE_JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u

function assertScheduleMinutes(value: unknown, source: string): void {
  invariant(
    value === undefined || (Number.isInteger(value) && (value as number) >= 0),
    `${source} MUST be a non-negative integer when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
}

function assertScheduleAction(value: unknown, source: string): void {
  invariant(isRecord(value), `${source} MUST be an action object.`, {
    code: 'INVALID_PROJECT_CONFIG',
  })

  const kind = value.kind
  invariant(
    kind === 'command' ||
      kind === 'workflow' ||
      kind === 'session' ||
      kind === 'prompt',
    `${source}.kind MUST be command, workflow, session, or prompt.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  const nonEmpty = (candidate: unknown): candidate is string =>
    typeof candidate === 'string' && candidate.trim().length > 0
  const shared = [
    'kind',
    'involvement',
    'verification',
    'pipeline_config',
    'attest_supervisor_card',
  ]
  const allowed =
    kind === 'command'
      ? ['kind', 'command']
      : kind === 'session'
        ? ['kind', 'queue_path', 'involvement']
        : kind === 'workflow'
          ? [...shared, 'workflow', 'request_path']
          : [...shared, 'prompt', 'workflow']
  const unsupported = Object.keys(value).filter((key) => !allowed.includes(key))
  invariant(
    unsupported.length === 0,
    `${source} contains unsupported fields for '${kind}': ${unsupported.join(', ')}.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  if (kind === 'command') {
    invariant(nonEmpty(value.command), `${source}.command MUST be non-empty.`, {
      code: 'INVALID_PROJECT_CONFIG',
    })
    return
  }

  if (kind === 'session') {
    invariant(
      nonEmpty(value.queue_path),
      `${source}.queue_path MUST be non-empty.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
  } else if (kind === 'workflow') {
    invariant(
      nonEmpty(value.workflow) && nonEmpty(value.request_path),
      `${source} MUST name a non-empty workflow and request_path.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
  } else {
    invariant(nonEmpty(value.prompt), `${source}.prompt MUST be non-empty.`, {
      code: 'INVALID_PROJECT_CONFIG',
    })
    invariant(
      value.workflow === undefined || nonEmpty(value.workflow),
      `${source}.workflow MUST be non-empty when present.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
  }

  invariant(
    value.involvement === undefined || nonEmpty(value.involvement),
    `${source}.involvement MUST be non-empty when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  if (kind !== 'session') {
    invariant(
      value.verification === undefined || nonEmpty(value.verification),
      `${source}.verification MUST be non-empty when present.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
    invariant(
      value.pipeline_config === undefined || nonEmpty(value.pipeline_config),
      `${source}.pipeline_config MUST be non-empty when present.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
    invariant(
      value.attest_supervisor_card === undefined ||
        typeof value.attest_supervisor_card === 'boolean',
      `${source}.attest_supervisor_card MUST be boolean when present.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
  }
}

const INSTALLATION_ID = /^[a-z0-9][a-z0-9-]*$/u

function assertInstallationsBlock(value: unknown): void {
  if (value === undefined) {
    return
  }

  invariant(
    Array.isArray(value),
    `${PROJECT_CONFIG_PATH}.installations MUST be an array when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  const ids = new Set<string>()

  for (const [index, entry] of value.entries()) {
    const source = `${PROJECT_CONFIG_PATH}.installations[${index}]`

    invariant(isRecord(entry), `${source} MUST be an object.`, {
      code: 'INVALID_PROJECT_CONFIG',
    })
    invariant(
      typeof entry.id === 'string' && INSTALLATION_ID.test(entry.id),
      `${source}.id MUST match ${INSTALLATION_ID.source}.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
    invariant(!ids.has(entry.id), `${source}.id duplicates '${entry.id}'.`, {
      code: 'INVALID_PROJECT_CONFIG',
    })
    ids.add(entry.id)
    invariant(
      typeof entry.path === 'string' && path.isAbsolute(entry.path),
      `${source}.path MUST be an absolute path.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
  }
}

function assertScheduleBlock(value: unknown): void {
  if (value === undefined) {
    return
  }

  invariant(
    isRecord(value) &&
      typeof value.enabled === 'boolean' &&
      Array.isArray(value.jobs),
    `${PROJECT_CONFIG_PATH}.schedule MUST contain enabled as a boolean and jobs as an array.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  assertScheduleMinutes(
    value.catch_up_window_minutes,
    `${PROJECT_CONFIG_PATH}.schedule.catch_up_window_minutes`,
  )
  assertScheduleMinutes(
    value.grace_period_minutes,
    `${PROJECT_CONFIG_PATH}.schedule.grace_period_minutes`,
  )

  const ids = new Set<string>()

  for (const [index, job] of value.jobs.entries()) {
    const source = `${PROJECT_CONFIG_PATH}.schedule.jobs[${index}]`
    invariant(isRecord(job), `${source} MUST be an object.`, {
      code: 'INVALID_PROJECT_CONFIG',
    })
    invariant(
      typeof job.id === 'string' && SCHEDULE_JOB_ID.test(job.id),
      `${source}.id MUST match ${SCHEDULE_JOB_ID.source}.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
    invariant(!ids.has(job.id), `${source}.id duplicates '${job.id}'.`, {
      code: 'INVALID_PROJECT_CONFIG',
    })
    ids.add(job.id)
    invariant(
      typeof job.enabled === 'boolean',
      `${source}.enabled MUST be boolean.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
    invariant(
      Number.isInteger(job.hour) &&
        (job.hour as number) >= 0 &&
        (job.hour as number) <= 23,
      `${source}.hour MUST be an integer from 0 through 23.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
    invariant(
      Number.isInteger(job.minute) &&
        (job.minute as number) >= 0 &&
        (job.minute as number) <= 59,
      `${source}.minute MUST be an integer from 0 through 59.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
    invariant(
      job.weekdays === undefined ||
        (Array.isArray(job.weekdays) &&
          job.weekdays.length > 0 &&
          new Set(job.weekdays).size === job.weekdays.length &&
          job.weekdays.every(
            (day) => Number.isInteger(day) && day >= 0 && day <= 6,
          )),
      `${source}.weekdays MUST contain unique integers from 0 (Sunday) through 6 (Saturday).`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )

    if (job.timezone !== undefined) {
      invariant(
        nonEmptyScheduleString(job.timezone),
        `${source}.timezone MUST be non-empty when present.`,
        { code: 'INVALID_PROJECT_CONFIG' },
      )

      try {
        new Intl.DateTimeFormat('en-US', { timeZone: job.timezone as string })
      } catch {
        invariant(false, `${source}.timezone MUST be a valid IANA timezone.`, {
          code: 'INVALID_PROJECT_CONFIG',
        })
      }
    }
    assertScheduleMinutes(
      job.catch_up_window_minutes,
      `${source}.catch_up_window_minutes`,
    )
    assertScheduleMinutes(
      job.grace_period_minutes,
      `${source}.grace_period_minutes`,
    )
    invariant(
      (nonEmptyScheduleString(job.workspace) ? 1 : 0) +
        (nonEmptyScheduleString(job.worktree) ? 1 : 0) ===
        1,
      `${source} MUST name exactly one of workspace or worktree.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
    assertScheduleAction(job.action, `${source}.action`)
  }
}

function nonEmptyScheduleString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function assertFastWallBlock(value: unknown): void {
  if (value === undefined) {
    return
  }

  invariant(
    isRecord(value),
    `${PROJECT_CONFIG_PATH}.fast_wall MUST be an object when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  invariant(
    value.ceiling_ms === null ||
      (Number.isInteger(value.ceiling_ms) && (value.ceiling_ms as number) > 0),
    `${PROJECT_CONFIG_PATH}.fast_wall.ceiling_ms MUST be a positive integer, or null until a measured baseline sets it.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  invariant(
    value.calibrated_at === undefined ||
      (typeof value.calibrated_at === 'string' &&
        Number.isFinite(Date.parse(value.calibrated_at))),
    `${PROJECT_CONFIG_PATH}.fast_wall.calibrated_at MUST be an ISO-8601 timestamp when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  invariant(
    typeof value.anchor_date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/u.test(value.anchor_date) &&
      Number.isFinite(Date.parse(`${value.anchor_date}T00:00:00.000Z`)),
    `${PROJECT_CONFIG_PATH}.fast_wall.anchor_date MUST be a UTC date in YYYY-MM-DD form.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  invariant(
    Number.isInteger(value.weekly_allowance_ms) &&
      (value.weekly_allowance_ms as number) >= 0,
    `${PROJECT_CONFIG_PATH}.fast_wall.weekly_allowance_ms MUST be a non-negative integer.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  invariant(
    typeof value.max_load_average_per_cpu === 'number' &&
      Number.isFinite(value.max_load_average_per_cpu) &&
      value.max_load_average_per_cpu > 0,
    `${PROJECT_CONFIG_PATH}.fast_wall.max_load_average_per_cpu MUST be a positive number.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  invariant(
    Number.isInteger(value.minimum_qualified_samples) &&
      (value.minimum_qualified_samples as number) > 0,
    `${PROJECT_CONFIG_PATH}.fast_wall.minimum_qualified_samples MUST be a positive integer.`,
    { code: 'INVALID_PROJECT_CONFIG' },
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

  assertWorktreesBlock(value.worktrees)
  assertRetentionBlock(value.retention)
  assertAwayModeBlock(value.away_mode)
  assertInstallationsBlock(value.installations)
  assertScheduleBlock(value.schedule)
  assertFastWallBlock(value.fast_wall)

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

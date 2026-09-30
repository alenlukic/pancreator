import { invariant, PanError } from '../errors.js'
import { fileExists, isRecord, readJson } from '../io.js'
import { isIsolationCommand, templateIsolationCommands } from './isolation.js'
import { repositoryChecksSourcePath } from './paths.js'

export interface RepositoryCheckProfile {
  description?: string
  timeout_ms?: number
  environment_probes?: string[]
  probes: string[]
  commands: string[]
  /** Command template for one isolated test; requires `{file}` and `{test}`. */
  isolation_command?: string
  /**
   * The profile declares its commands independent of one another, so the
   * asynchronous runner MAY execute them together. Probes stay serial because
   * they are preconditions, and the synchronous runner ignores the flag: the
   * gate path it serves is a synchronous call path by design.
   */
  concurrent?: boolean
}

export interface RepositoryChecksConfig {
  schema_version: 1
  source_head?: string
  /**
   * Commands that bootstrap a fresh workspace before profile commands can run.
   * A new worktree carries no ignored build state (dependencies, compiled
   * output), so checks there are doomed until setup has run.
   */
  setup?: string[]
  profiles: Record<string, RepositoryCheckProfile>
}

export interface RepositoryCheckCommandResult {
  kind: 'probe' | 'command'
  command: string
  exit_code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  passed: boolean
  timed_out: boolean
  duration_ms: number
  error?: string
}

export interface RepositoryCheckResult {
  profile: string
  status: 'passed' | 'failed' | 'not_configured'
  config_path: string
  workspace_root: string
  timeout_ms: number
  description?: string
  results: RepositoryCheckCommandResult[]
  total_duration_ms: number
  advisories: string[]
}

export interface RepositoryCheckRunOptions {
  timeout_ms?: number
  /**
   * Directory the profile commands run in, absolute or installation-relative.
   * Absent means the configured workspace root. A run that targets a worktree
   * passes its own workspace so checks observe the worktree, not the main
   * checkout.
   */
  workspace?: string
  /**
   * Extra environment variables for the profile commands, layered over the
   * harness process environment. A gate uses this to hand the test reporter
   * its profile target.
   */
  env?: Record<string, string>
}

export interface RepositoryCheckStreamingOptions extends RepositoryCheckRunOptions {
  on_start?: (
    kind: RepositoryCheckCommandResult['kind'],
    command: string,
  ) => void
  on_stdout?: (chunk: string) => void
  on_stderr?: (chunk: string) => void
  /** Called once the entry settles, whether it passed, failed, or timed out. */
  on_close?: () => void
}

export interface RepositoryCheckBaselineArtifact {
  schema_version: 1
  run_id: string
  stage: string
  profile: string
  workspace_fingerprint: string
  recorded_at: string
  /**
   * Content digest of the verification configuration the capture ran under.
   * Another unit of work reuses an artifact only when this matches its own,
   * so an artifact written before reuse existed is never adopted.
   */
  checks_config_sha256?: string
  /**
   * Uncommitted workspace paths at capture time, so an inherited failure is
   * attributable instead of reading as pre-existing repository state. Capped;
   * `workspace_dirty_path_count` carries the full count. Absent on records
   * written before provenance capture existed.
   */
  workspace_dirty_paths?: string[]
  workspace_dirty_path_count?: number
  /** Run whose final workspace fingerprint matches this dirty starting state. */
  predecessor_run_id?: string
  result: RepositoryCheckResult
  /** Set when `result` holds elided output and the untruncated run lives elsewhere. */
  full_result_path?: string
}

function stringArray(value: unknown, source: string): string[] {
  invariant(Array.isArray(value), `${source} MUST be an array.`, {
    code: 'INVALID_REPOSITORY_CHECKS',
  })

  for (const [index, item] of value.entries()) {
    invariant(
      typeof item === 'string' && item.trim().length > 0,
      `${source}[${index}] MUST be a non-empty command string.`,
      { code: 'INVALID_REPOSITORY_CHECKS' },
    )
  }

  return value as string[]
}

function optionalTimeout(value: unknown, source: string): number | undefined {
  if (value === undefined) {
    return undefined
  }

  invariant(
    typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1_000 &&
      value <= 86_400_000,
    `${source} MUST be an integer between 1000 and 86400000 milliseconds.`,
    { code: 'INVALID_REPOSITORY_CHECKS' },
  )

  return value
}

function normalizedCommands(commands: string[]): string[] {
  return commands.map((command) => command.trim().replaceAll(/\s+/gu, ' '))
}

/**
 * True when `left` is non-empty and every one of its commands, compared with
 * whitespace collapsed, also appears in `right`.
 */
export function commandSetIsSubset(left: string[], right: string[]): boolean {
  if (left.length === 0) {
    return false
  }

  const rightCommands = new Set(normalizedCommands(right))

  return normalizedCommands(left).every((command) => rightCommands.has(command))
}

function sameCommands(left: string[], right: string[]): boolean {
  if (left.length === 0 || left.length !== right.length) {
    return false
  }

  const normalizedLeft = normalizedCommands(left)
  const normalizedRight = normalizedCommands(right)

  return normalizedLeft.every(
    (command, index) => command === normalizedRight[index],
  )
}

function validateProfileSemantics(
  filePath: string,
  profiles: Record<string, RepositoryCheckProfile>,
): void {
  const fast = profiles.fast
  const full = profiles.full

  invariant(
    !fast || !full || !sameCommands(fast.commands, full.commands),
    `${filePath}.profiles.fast MUST NOT duplicate profiles.full. Use the repository's documented fast/default command, or leave fast unconfigured when no distinct iterative suite exists.`,
    { code: 'INVALID_REPOSITORY_CHECKS' },
  )

  for (const [name, profile] of Object.entries(profiles)) {
    if (profile.timeout_ms === undefined) {
      continue
    }

    for (const [subsetName, subset] of Object.entries(profiles)) {
      if (
        subsetName === name ||
        subset.timeout_ms === undefined ||
        !commandSetIsSubset(subset.commands, profile.commands)
      ) {
        continue
      }

      invariant(
        profile.timeout_ms >= subset.timeout_ms,
        `${filePath}.profiles.${name}.timeout_ms MUST be at least ` +
          `${filePath}.profiles.${subsetName}.timeout_ms because '${name}' ` +
          `runs a superset of '${subsetName}'.`,
        { code: 'INVALID_REPOSITORY_CHECKS' },
      )
    }
  }
}

/**
 * Reads and validates the repository-check configuration from its resolved
 * source path, returning normalized profiles (with template isolation
 * commands filled in for unchanged template profiles). A missing file yields
 * an empty profile map. Throws `INVALID_REPOSITORY_CHECKS` on a bad shape, a
 * fast profile that duplicates full, or a superset profile with a shorter
 * timeout than its subset.
 */
export function loadRepositoryChecks(root: string): RepositoryChecksConfig {
  const filePath = repositoryChecksSourcePath(root)

  if (!fileExists(filePath)) {
    return { schema_version: 1, profiles: {} }
  }

  const value = readJson(filePath)

  invariant(
    isRecord(value) && value.schema_version === 1 && isRecord(value.profiles),
    `${filePath} MUST contain a schema_version 1 repository-check profile map.`,
    { code: 'INVALID_REPOSITORY_CHECKS' },
  )

  const profiles: Record<string, RepositoryCheckProfile> = {}

  for (const [name, rawProfile] of Object.entries(value.profiles)) {
    invariant(
      isRecord(rawProfile),
      `${filePath}.profiles.${name} MUST be an object.`,
      { code: 'INVALID_REPOSITORY_CHECKS' },
    )
    invariant(
      rawProfile.description === undefined ||
        typeof rawProfile.description === 'string',
      `${filePath}.profiles.${name}.description MUST be a string when present.`,
      { code: 'INVALID_REPOSITORY_CHECKS' },
    )

    const timeoutMs = optionalTimeout(
      rawProfile.timeout_ms,
      `${filePath}.profiles.${name}.timeout_ms`,
    )

    invariant(
      rawProfile.concurrent === undefined ||
        typeof rawProfile.concurrent === 'boolean',
      `${filePath}.profiles.${name}.concurrent MUST be a boolean when present.`,
      { code: 'INVALID_REPOSITORY_CHECKS' },
    )
    invariant(
      rawProfile.isolation_command === undefined ||
        isIsolationCommand(rawProfile.isolation_command),
      `${filePath}.profiles.${name}.isolation_command MUST be a non-empty ` +
        'string containing {file} and either {test_pattern} or {test} when ' +
        'present.',
      { code: 'INVALID_REPOSITORY_CHECKS' },
    )

    profiles[name] = {
      ...(typeof rawProfile.description === 'string'
        ? { description: rawProfile.description }
        : {}),
      ...(timeoutMs !== undefined ? { timeout_ms: timeoutMs } : {}),
      ...(rawProfile.concurrent === true ? { concurrent: true } : {}),
      ...(typeof rawProfile.isolation_command === 'string'
        ? { isolation_command: rawProfile.isolation_command }
        : {}),
      environment_probes: stringArray(
        rawProfile.environment_probes ?? [],
        `${filePath}.profiles.${name}.environment_probes`,
      ),
      probes: stringArray(
        rawProfile.probes ?? [],
        `${filePath}.profiles.${name}.probes`,
      ),
      commands: stringArray(
        rawProfile.commands ?? [],
        `${filePath}.profiles.${name}.commands`,
      ),
    }
  }

  for (const [name, template] of templateIsolationCommands(root, filePath)) {
    const profile = profiles[name]

    if (
      profile &&
      profile.isolation_command === undefined &&
      sameCommands(profile.commands, template.commands)
    ) {
      profiles[name] = {
        ...profile,
        isolation_command: template.isolation_command,
      }
    }
  }

  validateProfileSemantics(filePath, profiles)

  const setup =
    value.setup === undefined
      ? undefined
      : stringArray(value.setup, `${filePath}.setup`)

  return {
    schema_version: 1,
    ...(typeof value.source_head === 'string'
      ? { source_head: value.source_head }
      : {}),
    ...(setup !== undefined ? { setup } : {}),
    profiles,
  }
}

export interface RepositorySetupResult {
  status: 'passed' | 'failed' | 'not_configured'
  workspace_root: string
  results: RepositoryCheckCommandResult[]
  total_duration_ms: number
}

/**
 * Loads the repository-check configuration, rethrowing any non-`PanError`
 * failure as `INVALID_REPOSITORY_CHECKS`.
 */
export function assertRepositoryChecksValid(
  root: string,
): RepositoryChecksConfig {
  try {
    return loadRepositoryChecks(root)
  } catch (error) {
    if (error instanceof PanError) {
      throw error
    }

    throw new PanError('Repository check configuration is invalid.', {
      code: 'INVALID_REPOSITORY_CHECKS',
      details: {
        cause: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

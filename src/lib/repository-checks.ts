import { spawnSync } from 'node:child_process'
import path from 'node:path'

import { PanError, invariant } from './errors.js'
import { fileExists, isRecord, readJson } from './io.js'
import {
  configuredWorkspaceRoot,
  isSelfDevelopmentInstallation,
} from './project-config.js'

export interface RepositoryCheckProfile {
  description?: string
  probes: string[]
  commands: string[]
}

export interface RepositoryChecksConfig {
  schema_version: 1
  source_head?: string
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
  error?: string
}

export interface RepositoryCheckResult {
  profile: string
  status: 'passed' | 'failed' | 'not_configured'
  config_path: string
  workspace_root: string
  description?: string
  results: RepositoryCheckCommandResult[]
}

export function repositoryChecksPath(root: string): string {
  return path.join(root, 'runtime', 'repository-checks.json')
}

export function repositoryChecksSourcePath(root: string): string {
  const runtimePath = repositoryChecksPath(root)

  if (fileExists(runtimePath) || !isSelfDevelopmentInstallation(root)) {
    return runtimePath
  }

  return path.join(
    root,
    'library',
    'templates',
    'repository-checks.self-development.json',
  )
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

    profiles[name] = {
      ...(typeof rawProfile.description === 'string'
        ? { description: rawProfile.description }
        : {}),
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

  return {
    schema_version: 1,
    ...(typeof value.source_head === 'string'
      ? { source_head: value.source_head }
      : {}),
    profiles,
  }
}

function execute(
  kind: RepositoryCheckCommandResult['kind'],
  command: string,
  workspaceRoot: string,
  timeoutMs: number,
): RepositoryCheckCommandResult {
  const result = spawnSync(command, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 10 * 1024 * 1024,
    timeout: timeoutMs,
    env: { ...process.env },
  })

  return {
    kind,
    command,
    exit_code: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    passed: result.status === 0 && !result.error,
    timed_out:
      result.error instanceof Error &&
      'code' in result.error &&
      result.error.code === 'ETIMEDOUT',
    ...(result.error ? { error: result.error.message } : {}),
  }
}

export function runRepositoryCheck(
  root: string,
  profileName: string,
  options: { timeout_ms?: number } = {},
): RepositoryCheckResult {
  const config = loadRepositoryChecks(root)
  const configPath = repositoryChecksSourcePath(root)
  const profile = config.profiles[profileName]
  const workspaceRoot = path.resolve(root, configuredWorkspaceRoot(root))
  const timeoutMs = options.timeout_ms ?? 600_000

  if (!profile || profile.commands.length === 0) {
    return {
      profile: profileName,
      status: 'not_configured',
      config_path: path.relative(root, configPath).split(path.sep).join('/'),
      workspace_root: workspaceRoot,
      ...(profile?.description ? { description: profile.description } : {}),
      results: [],
    }
  }

  const results: RepositoryCheckCommandResult[] = []

  for (const command of profile.probes) {
    const result = execute('probe', command, workspaceRoot, timeoutMs)
    results.push(result)

    if (!result.passed) {
      return {
        profile: profileName,
        status: 'failed',
        config_path: path.relative(root, configPath).split(path.sep).join('/'),
        workspace_root: workspaceRoot,
        ...(profile.description ? { description: profile.description } : {}),
        results,
      }
    }
  }

  for (const command of profile.commands) {
    const result = execute('command', command, workspaceRoot, timeoutMs)
    results.push(result)

    if (!result.passed) {
      return {
        profile: profileName,
        status: 'failed',
        config_path: path.relative(root, configPath).split(path.sep).join('/'),
        workspace_root: workspaceRoot,
        ...(profile.description ? { description: profile.description } : {}),
        results,
      }
    }
  }

  return {
    profile: profileName,
    status: 'passed',
    config_path: path.relative(root, configPath).split(path.sep).join('/'),
    workspace_root: workspaceRoot,
    ...(profile.description ? { description: profile.description } : {}),
    results,
  }
}

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

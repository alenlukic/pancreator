import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'

import { PanError, invariant } from './errors.js'
import { fileExists, isRecord, readJson } from './io.js'
import {
  configuredWorkspaceRoot,
  isSelfDevelopmentInstallation,
} from './project-config.js'

const DEFAULT_TIMEOUT_MS = 600_000
const MAX_CAPTURE_BYTES = 10 * 1024 * 1024

export interface RepositoryCheckProfile {
  description?: string
  timeout_ms?: number
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
  timeout_ms: number
  description?: string
  results: RepositoryCheckCommandResult[]
}

export interface RepositoryCheckRunOptions {
  timeout_ms?: number
}

export interface RepositoryCheckStreamingOptions extends RepositoryCheckRunOptions {
  on_start?: (
    kind: RepositoryCheckCommandResult['kind'],
    command: string,
  ) => void
  on_stdout?: (chunk: string) => void
  on_stderr?: (chunk: string) => void
}

export interface RepositoryCheckBaselineArtifact {
  schema_version: 1
  run_id: string
  stage: string
  profile: string
  workspace_fingerprint: string
  recorded_at: string
  result: RepositoryCheckResult
}

export interface RepositoryCheckBaselineComparison {
  passed: boolean
  explanation: string
}

export function repositoryCheckProfileName(command: string): string | null {
  const match = /^pan repository-check ([a-z0-9][a-z0-9_-]*)$/u.exec(
    command.trim(),
  )

  return match?.[1] ?? null
}

function stripAnsi(value: string): string {
  return value.replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
}

function isVolatileSummaryLine(line: string): boolean {
  return (
    /^(?:✖\s*)?\d+\s+problems?(?:\s+\(|$)/iu.test(line) ||
    /^(?:tests?|test suites?|snapshots?|time):/iu.test(line) ||
    /^#\s+(?:tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\b/iu.test(
      line,
    ) ||
    /^=+\s+.*\b(?:failed|passed|error|errors)\b.*=+$/iu.test(line)
  )
}

function normalizeDiagnosticLine(line: string, workspaceRoot: string): string {
  return stripAnsi(line)
    .replaceAll('\\', '/')
    .replaceAll(workspaceRoot.replaceAll('\\', '/'), '<workspace>')
    .replaceAll(
      /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/gu,
      '<timestamp>',
    )
    .replaceAll(
      /\b\d+(?:\.\d+)?\s?(?:ms|s|sec|secs|seconds|m|min|mins|minutes)\b/giu,
      '<duration>',
    )
    .replaceAll(/([/\w.-]+):\d+:\d+/gu, '$1:<line>:<column>')
    .replaceAll(/([/\w.-]+):\d+/gu, '$1:<line>')
    .replaceAll(/\s+/gu, ' ')
    .trim()
}

function diagnosticCounts(
  result: RepositoryCheckCommandResult,
  workspaceRoot: string,
): Map<string, number> {
  const lines = `${result.stdout}\n${result.stderr}\n${result.error ?? ''}`
    .split(/\r?\n/u)
    .map((line) => normalizeDiagnosticLine(line, workspaceRoot))
    .filter((line) => line.length > 0 && !isVolatileSummaryLine(line))
  const counts = new Map<string, number>()

  for (const line of lines) {
    counts.set(line, (counts.get(line) ?? 0) + 1)
  }

  return counts
}

function failedCommandKey(result: RepositoryCheckCommandResult): string {
  return `${result.kind}:${result.command.trim().replaceAll(/\s+/gu, ' ')}`
}

function failureCoveredByBaseline(
  baseline: RepositoryCheckCommandResult,
  current: RepositoryCheckCommandResult,
  baselineWorkspaceRoot: string,
  currentWorkspaceRoot: string,
): boolean {
  if (baseline.passed || current.passed) {
    return false
  }

  if (
    baseline.timed_out !== current.timed_out ||
    baseline.signal !== current.signal ||
    baseline.exit_code !== current.exit_code
  ) {
    return false
  }

  const baselineDiagnostics = diagnosticCounts(baseline, baselineWorkspaceRoot)
  const currentDiagnostics = diagnosticCounts(current, currentWorkspaceRoot)

  if (currentDiagnostics.size === 0) {
    return baselineDiagnostics.size === 0
  }

  for (const [line, count] of currentDiagnostics) {
    if ((baselineDiagnostics.get(line) ?? 0) < count) {
      return false
    }
  }

  return true
}

export function compareRepositoryCheckToBaseline(
  baseline: RepositoryCheckResult,
  current: RepositoryCheckResult,
): RepositoryCheckBaselineComparison {
  if (current.status === 'passed') {
    return {
      passed: true,
      explanation: `Repository check '${current.profile}' passes.`,
    }
  }

  if (current.status === 'not_configured') {
    return {
      passed: false,
      explanation: `Repository check '${current.profile}' is not configured.`,
    }
  }

  if (baseline.status !== 'failed') {
    return {
      passed: false,
      explanation:
        `Repository check '${current.profile}' now fails but its pre-implementation ` +
        `baseline was '${baseline.status}'.`,
    }
  }

  const baselineFailures = new Map(
    baseline.results
      .filter((result) => !result.passed)
      .map((result) => [failedCommandKey(result), result]),
  )
  const currentFailures = current.results.filter((result) => !result.passed)

  for (const failure of currentFailures) {
    const prior = baselineFailures.get(failedCommandKey(failure))

    if (
      !prior ||
      !failureCoveredByBaseline(
        prior,
        failure,
        baseline.workspace_root,
        current.workspace_root,
      )
    ) {
      return {
        passed: false,
        explanation:
          `Repository check '${current.profile}' contains a new or changed ` +
          `failure in '${failure.command}'.`,
      }
    }
  }

  return {
    passed: true,
    explanation:
      `Repository check '${current.profile}' still reports only failures ` +
      'captured before implementation; no new diagnostics were introduced.',
  }
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

    const timeoutMs = optionalTimeout(
      rawProfile.timeout_ms,
      `${filePath}.profiles.${name}.timeout_ms`,
    )

    profiles[name] = {
      ...(typeof rawProfile.description === 'string'
        ? { description: rawProfile.description }
        : {}),
      ...(timeoutMs !== undefined ? { timeout_ms: timeoutMs } : {}),
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

  validateProfileSemantics(filePath, profiles)

  return {
    schema_version: 1,
    ...(typeof value.source_head === 'string'
      ? { source_head: value.source_head }
      : {}),
    profiles,
  }
}

function effectiveTimeout(
  profile: RepositoryCheckProfile | undefined,
  requested: number | undefined,
): number {
  const configured = profile?.timeout_ms

  if (configured !== undefined && requested !== undefined) {
    return Math.min(configured, requested)
  }

  return configured ?? requested ?? DEFAULT_TIMEOUT_MS
}

function appendCaptured(current: string, chunk: string): string {
  if (Buffer.byteLength(current) >= MAX_CAPTURE_BYTES) {
    return current
  }

  const combined = current + chunk

  if (Buffer.byteLength(combined) <= MAX_CAPTURE_BYTES) {
    return combined
  }

  const available = Math.max(0, MAX_CAPTURE_BYTES - Buffer.byteLength(current))
  const truncated = Buffer.from(chunk).subarray(0, available).toString('utf8')

  return `${current}${truncated}\n[output truncated by Pancreator]\n`
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
    maxBuffer: MAX_CAPTURE_BYTES,
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

function executeStreaming(
  kind: RepositoryCheckCommandResult['kind'],
  command: string,
  workspaceRoot: string,
  timeoutMs: number,
  options: RepositoryCheckStreamingOptions,
): Promise<RepositoryCheckCommandResult> {
  options.on_start?.(kind, command)

  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: workspaceRoot,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    let timeoutHandle: NodeJS.Timeout | undefined
    let killHandle: NodeJS.Timeout | undefined

    const finish = (
      exitCode: number | null,
      signal: NodeJS.Signals | null,
      error?: Error,
    ): void => {
      if (settled) {
        return
      }

      settled = true

      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }

      if (killHandle) {
        clearTimeout(killHandle)
      }

      const timeoutError = timedOut
        ? `Command timed out after ${timeoutMs}ms.`
        : undefined
      const errorText = error?.message ?? timeoutError

      resolve({
        kind,
        command,
        exit_code: exitCode,
        signal,
        stdout,
        stderr,
        passed: exitCode === 0 && !errorText,
        timed_out: timedOut,
        ...(errorText ? { error: errorText } : {}),
      })
    }

    child.stdout?.on('data', (value: Buffer | string) => {
      const chunk = value.toString()
      stdout = appendCaptured(stdout, chunk)
      options.on_stdout?.(chunk)
    })
    child.stderr?.on('data', (value: Buffer | string) => {
      const chunk = value.toString()
      stderr = appendCaptured(stderr, chunk)
      options.on_stderr?.(chunk)
    })
    child.on('error', (error) => finish(null, null, error))
    child.on('close', (exitCode, signal) => finish(exitCode, signal))

    timeoutHandle = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      killHandle = setTimeout(() => child.kill('SIGKILL'), 2_000)
      killHandle.unref()
    }, timeoutMs)
    timeoutHandle.unref()
  })
}

function baseResult(
  root: string,
  profileName: string,
  configPath: string,
  workspaceRoot: string,
  timeoutMs: number,
  profile: RepositoryCheckProfile | undefined,
  status: RepositoryCheckResult['status'],
  results: RepositoryCheckCommandResult[],
): RepositoryCheckResult {
  return {
    profile: profileName,
    status,
    config_path: path.relative(root, configPath).split(path.sep).join('/'),
    workspace_root: workspaceRoot,
    timeout_ms: timeoutMs,
    ...(profile?.description ? { description: profile.description } : {}),
    results,
  }
}

export function runRepositoryCheck(
  root: string,
  profileName: string,
  options: RepositoryCheckRunOptions = {},
): RepositoryCheckResult {
  const config = loadRepositoryChecks(root)
  const configPath = repositoryChecksSourcePath(root)
  const profile = config.profiles[profileName]
  const workspaceRoot = path.resolve(root, configuredWorkspaceRoot(root))
  const timeoutMs = effectiveTimeout(profile, options.timeout_ms)

  if (!profile || profile.commands.length === 0) {
    return baseResult(
      root,
      profileName,
      configPath,
      workspaceRoot,
      timeoutMs,
      profile,
      'not_configured',
      [],
    )
  }

  const results: RepositoryCheckCommandResult[] = []

  for (const command of profile.probes) {
    const result = execute('probe', command, workspaceRoot, timeoutMs)
    results.push(result)

    if (!result.passed) {
      return baseResult(
        root,
        profileName,
        configPath,
        workspaceRoot,
        timeoutMs,
        profile,
        'failed',
        results,
      )
    }
  }

  for (const command of profile.commands) {
    const result = execute('command', command, workspaceRoot, timeoutMs)
    results.push(result)

    if (!result.passed) {
      return baseResult(
        root,
        profileName,
        configPath,
        workspaceRoot,
        timeoutMs,
        profile,
        'failed',
        results,
      )
    }
  }

  return baseResult(
    root,
    profileName,
    configPath,
    workspaceRoot,
    timeoutMs,
    profile,
    'passed',
    results,
  )
}

export async function runRepositoryCheckStreaming(
  root: string,
  profileName: string,
  options: RepositoryCheckStreamingOptions = {},
): Promise<RepositoryCheckResult> {
  const config = loadRepositoryChecks(root)
  const configPath = repositoryChecksSourcePath(root)
  const profile = config.profiles[profileName]
  const workspaceRoot = path.resolve(root, configuredWorkspaceRoot(root))
  const timeoutMs = effectiveTimeout(profile, options.timeout_ms)

  if (!profile || profile.commands.length === 0) {
    return baseResult(
      root,
      profileName,
      configPath,
      workspaceRoot,
      timeoutMs,
      profile,
      'not_configured',
      [],
    )
  }

  const results: RepositoryCheckCommandResult[] = []

  for (const command of profile.probes) {
    const result = await executeStreaming(
      'probe',
      command,
      workspaceRoot,
      timeoutMs,
      options,
    )
    results.push(result)

    if (!result.passed) {
      return baseResult(
        root,
        profileName,
        configPath,
        workspaceRoot,
        timeoutMs,
        profile,
        'failed',
        results,
      )
    }
  }

  for (const command of profile.commands) {
    const result = await executeStreaming(
      'command',
      command,
      workspaceRoot,
      timeoutMs,
      options,
    )
    results.push(result)

    if (!result.passed) {
      return baseResult(
        root,
        profileName,
        configPath,
        workspaceRoot,
        timeoutMs,
        profile,
        'failed',
        results,
      )
    }
  }

  return baseResult(
    root,
    profileName,
    configPath,
    workspaceRoot,
    timeoutMs,
    profile,
    'passed',
    results,
  )
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

import { spawn, spawnSync, type SpawnSyncOptions } from 'node:child_process'
import {
  closeSync,
  fstatSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PROFILE_COMMAND_ENV } from '../check-output.js'
import { isPancreatorRoot } from '../io.js'
import { configuredWorkspaceRoot } from '../project-config.js'
import { TEST_PROFILE_ENV } from '../suite-profile.js'
import {
  commandSetIsSubset,
  loadRepositoryChecks,
  type RepositoryCheckCommandResult,
  type RepositoryCheckProfile,
  type RepositoryCheckResult,
  type RepositoryCheckRunOptions,
  type RepositoryChecksConfig,
  type RepositoryCheckStreamingOptions,
  type RepositorySetupResult,
} from './config.js'
import { repositoryChecksSourcePath } from './paths.js'

/** Set by `bin/run-built` for a process tree whose build is current. */
export const BUILD_READY_ENV = 'PANCREATOR_BUILD_READY'

/**
 * The environment a profile command runs in. The harness process environment
 * is the base. `PAN_TEST_PROFILE` never leaks from an outer test run: a gate
 * that does not set it runs with it removed, so only the profiled full gate
 * writes a suite profile.
 *
 * `PANCREATOR_ROOT` is rebound to the workspace whenever the workspace is a
 * Pancreator checkout of its own. `bin/pan` pins that variable to the
 * installation so run state, the worktree index, and the gate cache stay there
 * while `PANCREATOR_EXEC_ROOT` moves the executing build, and a profile command
 * that inherited the pin read its required files, registries, and projections
 * from the installation instead of the workspace the gate targets. A target
 * installation keeps the inherited value, because its workspace is the target
 * repository and the harness lives elsewhere by design.
 *
 * `PANCREATOR_BUILD_READY` never leaks in either. `bin/run-built` exports it
 * to assert that the build was current when the process tree started, and a
 * profile command exists to check the sources as they are now. A command that
 * changed sources before the profile ran (a land that merged and finalized a
 * release) would otherwise reach a wrapper that skips the compile and tests
 * the earlier `dist/`. A caller that names the variable in `env` keeps it.
 *
 * `PAN_REPOSITORY_CHECK_PROFILE` tells a wrapper command such as
 * `pan tests impacted` that this runner captures and logs its output, so the
 * wrapper passes its transcript through rather than summarizing it a second
 * time. Gate evidence and baseline diagnostics keep the full transcript.
 */
export function profileCommandEnv(
  workspaceRoot: string,
  env: Record<string, string>,
): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = {
    ...process.env,
    [PROFILE_COMMAND_ENV]: '1',
    ...env,
  }

  if (!(TEST_PROFILE_ENV in env)) {
    delete merged[TEST_PROFILE_ENV]
  }

  if (!(BUILD_READY_ENV in env)) {
    delete merged[BUILD_READY_ENV]
  }

  if (!('PANCREATOR_ROOT' in env) && isPancreatorRoot(workspaceRoot)) {
    merged.PANCREATOR_ROOT = workspaceRoot
  }

  return merged
}

const DEFAULT_TIMEOUT_MS = 600_000

/** Bytes of one captured stream kept in a command result before truncation. */
export const MAX_CAPTURE_BYTES = 10 * 1024 * 1024

const SLOW_PASS_ADVISORY_MS = 60_000

/**
 * Run the target-declared workspace setup commands (dependency install,
 * build) in the given workspace, stopping at the first failure.
 */
export function runRepositorySetup(
  root: string,
  options: RepositoryCheckRunOptions = {},
): RepositorySetupResult {
  const config = loadRepositoryChecks(root)
  const workspaceRoot = path.resolve(
    root,
    options.workspace ?? configuredWorkspaceRoot(root),
  )
  const commands = config.setup ?? []
  const timeoutMs = options.timeout_ms ?? DEFAULT_TIMEOUT_MS

  const results: RepositoryCheckCommandResult[] = []
  let status: RepositorySetupResult['status'] =
    commands.length > 0 ? 'passed' : 'not_configured'

  for (const command of commands) {
    const result = execute('command', command, workspaceRoot, timeoutMs)

    results.push(result)

    if (!result.passed) {
      status = 'failed'
      break
    }
  }

  return {
    status,
    workspace_root: workspaceRoot,
    results,
    total_duration_ms: results.reduce(
      (total, result) => total + result.duration_ms,
      0,
    ),
  }
}

function effectiveTimeout(
  config: RepositoryChecksConfig,
  profileName: string,
  profile: RepositoryCheckProfile | undefined,
  requested: number | undefined,
): number {
  if (requested !== undefined) {
    return requested
  }

  // The profile's own bound participates as its explicit timeout or the
  // default, so a shorter subset timeout can only raise the result, never
  // lower it below what the profile would get on its own.
  const candidates = [
    profile === undefined
      ? undefined
      : (profile.timeout_ms ?? DEFAULT_TIMEOUT_MS),
    ...Object.entries(config.profiles)
      .filter(
        ([name, candidate]) =>
          name !== profileName &&
          candidate.timeout_ms !== undefined &&
          profile !== undefined &&
          commandSetIsSubset(candidate.commands, profile.commands),
      )
      .map(([, candidate]) => candidate.timeout_ms),
  ].filter((value): value is number => value !== undefined)

  return candidates.length > 0 ? Math.max(...candidates) : DEFAULT_TIMEOUT_MS
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

/**
 * Read a captured stream through its open descriptor, bounded the same way the
 * streaming path is. The file is never read whole: a runaway command can write
 * far more than the cap, and buffering that before truncating it would cost
 * the memory the cap exists to bound.
 */
function readCapturedDescriptor(fd: number): string {
  try {
    const size = fstatSync(fd).size
    const length = Math.min(size, MAX_CAPTURE_BYTES)
    const buffer = Buffer.alloc(length)
    let offset = 0

    while (offset < length) {
      const read = readSync(fd, buffer, offset, length - offset, offset)

      if (read === 0) {
        break
      }

      offset += read
    }

    const text = buffer.subarray(0, offset).toString('utf8')

    return size > MAX_CAPTURE_BYTES
      ? `${text}\n[output truncated by Pancreator]\n`
      : text
  } catch {
    return ''
  }
}

function execute(
  kind: RepositoryCheckCommandResult['kind'],
  command: string,
  workspaceRoot: string,
  timeoutMs: number,
  env: Record<string, string> = {},
): RepositoryCheckCommandResult {
  const startedAt = Date.now()

  // Output goes to files, not pipes. `spawnSync` with pipes returns only when
  // every holder of the pipe has closed it, so a timed-out `npm test` whose
  // shell was killed still blocked the gate until the orphaned node processes
  // finished on their own: 916 s against a 600 s bound in the field. With
  // files the call returns when the shell exits, and the process group the
  // child leads is then killed as a whole.
  const captureDirectory = mkdtempSync(
    path.join(tmpdir(), 'pan-repository-check-'),
  )
  const stdoutPath = path.join(captureDirectory, 'stdout')
  const stderrPath = path.join(captureDirectory, 'stderr')

  // Read-write, because the same descriptors read the capture back once the
  // shell exits.
  const stdoutFd = openSync(stdoutPath, 'w+')
  const stderrFd = openSync(stderrPath, 'w+')
  const detached = process.platform !== 'win32'
  let closed = false

  try {
    // `detached` is honoured by spawnSync at runtime (the child leads its own
    // process group) but is absent from its typings.
    const spawnOptions: SpawnSyncOptions & { detached: boolean } = {
      cwd: workspaceRoot,
      shell: true,
      stdio: ['ignore', stdoutFd, stderrFd],
      timeout: timeoutMs,
      env: profileCommandEnv(workspaceRoot, env),
      detached,
    }
    const result = spawnSync(command, [], spawnOptions)

    const timedOut =
      result.error instanceof Error &&
      'code' in result.error &&
      result.error.code === 'ETIMEDOUT'
    const stdout = readCapturedDescriptor(stdoutFd)
    const stderr = readCapturedDescriptor(stderrFd)

    closeSync(stdoutFd)
    closeSync(stderrFd)
    closed = true

    if (timedOut) {
      // The orphaned tree holds its own descriptors to the capture files, so
      // the directory goes first: whatever outlives the signal writes to
      // unlinked files and leaves nothing behind on disk.
      rmSync(captureDirectory, { recursive: true, force: true })

      if (detached && typeof result.pid === 'number') {
        try {
          process.kill(-result.pid, 'SIGKILL')
        } catch {
          // The group already ended with the shell.
        }
      }
    }

    return {
      kind,
      command,
      exit_code: result.status,
      signal: result.signal,
      stdout,
      stderr,
      passed: result.status === 0 && !result.error,
      timed_out: timedOut,
      duration_ms: Date.now() - startedAt,
      ...(result.error ? { error: result.error.message } : {}),
    }
  } finally {
    if (!closed) {
      closeSync(stdoutFd)
      closeSync(stderrFd)
    }

    rmSync(captureDirectory, { recursive: true, force: true })
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
  const startedAt = Date.now()

  return new Promise((resolve) => {
    // The child leads its own process group, so a timeout can end the whole
    // tree (`npm -> run-built -> run-tests -> node`) at once. Killing the
    // shell alone orphaned the suite, which kept the pipes open and delayed
    // `close` until the tests finished on their own.
    const child = spawn(command, {
      cwd: workspaceRoot,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: profileCommandEnv(workspaceRoot, options.env ?? {}),
      detached: process.platform !== 'win32',
    })
    const killTree = (signal: NodeJS.Signals): void => {
      if (child.pid !== undefined && process.platform !== 'win32') {
        try {
          process.kill(-child.pid, signal)
          return
        } catch {
          // The group is already gone; fall through to the direct kill.
        }
      }

      child.kill(signal)
    }

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

      options.on_close?.()
      resolve({
        kind,
        command,
        exit_code: exitCode,
        signal,
        stdout,
        stderr,
        passed: exitCode === 0 && !errorText,
        timed_out: timedOut,
        duration_ms: Date.now() - startedAt,
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
      killTree('SIGTERM')
      killHandle = setTimeout(() => killTree('SIGKILL'), 2_000)
      killHandle.unref()
    }, timeoutMs)
    timeoutHandle.unref()
  })
}

/**
 * Hold one concurrent command's output until it finishes, then emit it whole.
 * Live interleaving of several suites is unreadable, and the caller's stream
 * is an operator's terminal.
 */
function bufferedStreamingOptions(
  options: RepositoryCheckStreamingOptions,
): RepositoryCheckStreamingOptions {
  if (!options.on_stdout && !options.on_stderr) {
    return options
  }

  let stdout = ''
  let stderr = ''
  let flushed = false
  const flush = (): void => {
    if (flushed) {
      return
    }

    flushed = true

    if (stdout.length > 0) {
      options.on_stdout?.(stdout)
    }

    if (stderr.length > 0) {
      options.on_stderr?.(stderr)
    }
  }

  return {
    ...options,
    on_start: (kind, command) => options.on_start?.(kind, command),
    on_stdout: (chunk) => {
      stdout = appendCaptured(stdout, chunk)
    },
    on_stderr: (chunk) => {
      stderr = appendCaptured(stderr, chunk)
    },
    on_close: flush,
  }
}

function profileTimeoutResult(
  kind: RepositoryCheckCommandResult['kind'],
  command: string,
  timeoutMs: number,
): RepositoryCheckCommandResult {
  return {
    kind,
    command,
    exit_code: null,
    signal: null,
    stdout: '',
    stderr: '',
    passed: false,
    timed_out: true,
    duration_ms: 0,
    error: `Profile timed out after ${timeoutMs}ms before this entry could start.`,
  }
}

function executeWithinProfileBudget(
  kind: RepositoryCheckCommandResult['kind'],
  command: string,
  workspaceRoot: string,
  deadlineMs: number,
  timeoutMs: number,
  env: Record<string, string> = {},
): RepositoryCheckCommandResult {
  const remainingMs = deadlineMs - Date.now()

  if (remainingMs <= 0) {
    return profileTimeoutResult(kind, command, timeoutMs)
  }

  return execute(kind, command, workspaceRoot, remainingMs, env)
}

async function executeStreamingWithinProfileBudget(
  kind: RepositoryCheckCommandResult['kind'],
  command: string,
  workspaceRoot: string,
  deadlineMs: number,
  timeoutMs: number,
  options: RepositoryCheckStreamingOptions,
): Promise<RepositoryCheckCommandResult> {
  const remainingMs = deadlineMs - Date.now()

  if (remainingMs <= 0) {
    options.on_start?.(kind, command)
    options.on_close?.()

    return profileTimeoutResult(kind, command, timeoutMs)
  }

  return executeStreaming(kind, command, workspaceRoot, remainingMs, options)
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
  const totalDurationMs = results.reduce(
    (total, result) => total + result.duration_ms,
    0,
  )
  const advisories =
    status === 'passed' && totalDurationMs >= SLOW_PASS_ADVISORY_MS
      ? [
          `FYI: repository check '${profileName}' passed but took ${totalDurationMs}ms. Clock time alone does not block the pipeline.`,
        ]
      : []

  return {
    profile: profileName,
    status,
    config_path: path.relative(root, configPath).split(path.sep).join('/'),
    workspace_root: workspaceRoot,
    timeout_ms: timeoutMs,
    ...(profile?.description ? { description: profile.description } : {}),
    results,
    total_duration_ms: totalDurationMs,
    advisories,
  }
}

/**
 * Directory a profile runs in. A caller that must observe the same workspace
 * the runner will use — to bracket a run with a fingerprint, for instance —
 * resolves it through this one definition.
 */
export function repositoryCheckWorkspaceRoot(
  root: string,
  workspace?: string,
): string {
  return path.resolve(root, workspace ?? configuredWorkspaceRoot(root))
}

export function runRepositoryCheck(
  root: string,
  profileName: string,
  options: RepositoryCheckRunOptions = {},
): RepositoryCheckResult {
  const config = loadRepositoryChecks(root)
  const configPath = repositoryChecksSourcePath(root)
  const profile = config.profiles[profileName]

  const workspaceRoot = repositoryCheckWorkspaceRoot(root, options.workspace)
  const timeoutMs = effectiveTimeout(
    config,
    profileName,
    profile,
    options.timeout_ms,
  )

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
  const deadlineMs = Date.now() + timeoutMs

  for (const command of [
    ...(profile.environment_probes ?? []),
    ...profile.probes,
  ]) {
    const result = executeWithinProfileBudget(
      'probe',
      command,
      workspaceRoot,
      deadlineMs,
      timeoutMs,
      options.env,
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

  // Probes are preconditions and stop the profile, but the commands are
  // independently meaningful partitions: an early backend failure MUST NOT
  // leave the frontend partition uncaptured, or the baseline would represent
  // surfaces it never observed.
  let commandsPassed = true

  for (const command of profile.commands) {
    const result = executeWithinProfileBudget(
      'command',
      command,
      workspaceRoot,
      deadlineMs,
      timeoutMs,
      options.env,
    )
    results.push(result)

    if (!result.passed) {
      commandsPassed = false
    }

    if (result.timed_out) {
      break
    }
  }

  return baseResult(
    root,
    profileName,
    configPath,
    workspaceRoot,
    timeoutMs,
    profile,
    commandsPassed ? 'passed' : 'failed',
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

  const workspaceRoot = repositoryCheckWorkspaceRoot(root, options.workspace)
  const timeoutMs = effectiveTimeout(
    config,
    profileName,
    profile,
    options.timeout_ms,
  )

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
  const deadlineMs = Date.now() + timeoutMs

  for (const command of [
    ...(profile.environment_probes ?? []),
    ...profile.probes,
  ]) {
    const result = await executeStreamingWithinProfileBudget(
      'probe',
      command,
      workspaceRoot,
      deadlineMs,
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

  // Same partition contract as the synchronous runner: every configured
  // command records its result even after an earlier command fails.
  let commandsPassed = true

  if (profile.concurrent) {
    // Independent commands share the one profile deadline, so each child gets
    // the remaining budget and ends its own process group when that budget
    // passes. Declared order is preserved because `Promise.all` resolves
    // positionally, and the whole partition is recorded: a concurrent profile
    // has no "stop at the first timeout" shortcut to take.
    results.push(
      ...(await Promise.all(
        profile.commands.map((command) =>
          executeStreamingWithinProfileBudget(
            'command',
            command,
            workspaceRoot,
            deadlineMs,
            timeoutMs,
            bufferedStreamingOptions(options),
          ),
        ),
      )),
    )
    commandsPassed = results.every(
      (result) => result.kind !== 'command' || result.passed,
    )
  } else {
    for (const command of profile.commands) {
      const result = await executeStreamingWithinProfileBudget(
        'command',
        command,
        workspaceRoot,
        deadlineMs,
        timeoutMs,
        options,
      )
      results.push(result)

      if (!result.passed) {
        commandsPassed = false
      }

      if (result.timed_out) {
        break
      }
    }
  }

  return baseResult(
    root,
    profileName,
    configPath,
    workspaceRoot,
    timeoutMs,
    profile,
    commandsPassed ? 'passed' : 'failed',
    results,
  )
}

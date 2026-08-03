import { spawnSync } from 'node:child_process'

/**
 * Process-level mechanics for the `claude-code` persona executor: preflight,
 * non-interactive invocation, and result parsing. Run-state orchestration
 * (audit authorship, session persistence, pause-on-preflight-failure) lives in
 * the engine; this module only moves bytes to and from the CLI.
 */

/** Oldest Claude Code CLI version the delegation contract was tested against. */
export const CLAUDE_CODE_MIN_VERSION = '2.0.0'

const VERSION_PATTERN = /(\d+)\.(\d+)\.(\d+)/u
const PREFLIGHT_TIMEOUT_MS = 120_000
const DEFAULT_INVOCATION_TIMEOUT_MS = 3_600_000
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

/** Binary the executor spawns. Overridable for tests and non-standard installs. */
export function claudeCodeBinary(): string {
  const override = process.env.PANCREATOR_CLAUDE_BIN?.trim()

  return override && override.length > 0 ? override : 'claude'
}

export interface ClaudeCodePreflightResult {
  ok: boolean
  binary: string
  version?: string
  error?: string
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] =>
    (VERSION_PATTERN.exec(value) ?? ['0', '0', '0', '0'])
      .slice(1, 4)
      .map(Number)
  const [lMajor = 0, lMinor = 0, lPatch = 0] = parse(left)
  const [rMajor = 0, rMinor = 0, rPatch = 0] = parse(right)

  return lMajor - rMajor || lMinor - rMinor || lPatch - rPatch
}

/** Verify the binary exists and meets the tested minimum version. */
export function claudeCodeVersionPreflight(): ClaudeCodePreflightResult {
  const binary = claudeCodeBinary()
  const spawned = spawnSync(binary, ['--version'], {
    encoding: 'utf8',
    timeout: PREFLIGHT_TIMEOUT_MS,
  })

  if (spawned.error) {
    return {
      ok: false,
      binary,
      error:
        `Claude Code CLI '${binary}' is not invocable: ` +
        `${spawned.error.message}. Install it and authenticate, or set ` +
        'PANCREATOR_CLAUDE_BIN to the binary path.',
    }
  }

  if (spawned.status !== 0) {
    return {
      ok: false,
      binary,
      error: `'${binary} --version' exited with status ${spawned.status}.`,
    }
  }

  const versionMatch = VERSION_PATTERN.exec(spawned.stdout ?? '')

  if (!versionMatch) {
    return {
      ok: false,
      binary,
      error: `'${binary} --version' did not report a parseable version.`,
    }
  }

  const version = versionMatch[0]

  if (compareVersions(version, CLAUDE_CODE_MIN_VERSION) < 0) {
    return {
      ok: false,
      binary,
      version,
      error:
        `Claude Code CLI ${version} is older than the tested minimum ` +
        `${CLAUDE_CODE_MIN_VERSION}.`,
    }
  }

  return { ok: true, binary, version }
}

/**
 * Verify the CLI is authenticated by running one no-op prompt. This spends a
 * real (tiny) invocation, so callers cache the result per run.
 */
export function claudeCodeCredentialPreflight(): ClaudeCodePreflightResult {
  const binary = claudeCodeBinary()
  const spawned = spawnSync(
    binary,
    ['-p', 'Reply with the single word: pong', '--output-format', 'json'],
    {
      encoding: 'utf8',
      timeout: PREFLIGHT_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
    },
  )

  if (spawned.error) {
    return {
      ok: false,
      binary,
      error: `Claude Code CLI '${binary}' is not invocable: ${spawned.error.message}.`,
    }
  }

  if (spawned.status !== 0) {
    const detail = (spawned.stderr ?? spawned.stdout ?? '').trim().slice(0, 400)

    return {
      ok: false,
      binary,
      error:
        `Claude Code credential preflight exited with status ${spawned.status}` +
        (detail.length > 0 ? `: ${detail}` : '.'),
    }
  }

  const parsed = parseClaudeCodeJson(spawned.stdout ?? '')

  if (!parsed || parsed.is_error === true) {
    return {
      ok: false,
      binary,
      error:
        'Claude Code credential preflight returned an error result. ' +
        'Authenticate the CLI on this machine before delegating.',
    }
  }

  return { ok: true, binary }
}

export interface ClaudeCodeResultPayload {
  session_id?: string
  is_error?: boolean
  subtype?: string
  result?: string
}

function parseClaudeCodeJson(stdout: string): ClaudeCodeResultPayload | null {
  const candidates = [stdout.trim(), stdout.trim().split('\n').at(-1) ?? '']

  for (const candidate of candidates) {
    if (candidate.length === 0) {
      continue
    }

    try {
      const value = JSON.parse(candidate) as Record<string, unknown>

      return {
        ...(typeof value.session_id === 'string'
          ? { session_id: value.session_id }
          : {}),
        ...(typeof value.is_error === 'boolean'
          ? { is_error: value.is_error }
          : {}),
        ...(typeof value.subtype === 'string'
          ? { subtype: value.subtype }
          : {}),
        ...(typeof value.result === 'string' ? { result: value.result } : {}),
      }
    } catch {
      continue
    }
  }

  return null
}

export interface ClaudeCodeInvocationRequest {
  /** Prompt body. Piped over stdin so the argument vector never carries it. */
  prompt: string
  cwd: string
  model?: string
  permissionMode?: string
  allowedTools?: string[]
  addDirs?: string[]
  resumeSessionId?: string
  timeoutMs?: number
}

export interface ClaudeCodeInvocationResult {
  ok: boolean
  binary: string
  /** Resolved argument vector, excluding the prompt body. */
  argv: string[]
  exit_code: number | null
  timed_out: boolean
  duration_ms: number
  stdout: string
  stderr: string
  parsed: ClaudeCodeResultPayload | null
  session_id?: string
  error?: string
}

/** Run one non-interactive Claude Code invocation and parse its JSON result. */
export function runClaudeCode(
  request: ClaudeCodeInvocationRequest,
): ClaudeCodeInvocationResult {
  const binary = claudeCodeBinary()
  const argv = ['-p', '--output-format', 'json']

  if (request.model) {
    argv.push('--model', request.model)
  }

  if (request.permissionMode) {
    argv.push('--permission-mode', request.permissionMode)
  }

  if (request.allowedTools && request.allowedTools.length > 0) {
    argv.push('--allowed-tools', ...request.allowedTools)
  }

  for (const directory of request.addDirs ?? []) {
    argv.push('--add-dir', directory)
  }

  if (request.resumeSessionId) {
    argv.push('--resume', request.resumeSessionId)
  }

  const startedAt = Date.now()
  const spawned = spawnSync(binary, argv, {
    cwd: request.cwd,
    encoding: 'utf8',
    input: request.prompt,
    timeout: request.timeoutMs ?? DEFAULT_INVOCATION_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
  })
  const durationMs = Date.now() - startedAt
  const timedOut =
    (spawned.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT'

  if (spawned.error && !timedOut) {
    return {
      ok: false,
      binary,
      argv,
      exit_code: spawned.status,
      timed_out: false,
      duration_ms: durationMs,
      stdout: spawned.stdout ?? '',
      stderr: spawned.stderr ?? '',
      parsed: null,
      error: `Failed to spawn '${binary}': ${spawned.error.message}`,
    }
  }

  const stdout = spawned.stdout ?? ''
  const stderr = spawned.stderr ?? ''
  const parsed = parseClaudeCodeJson(stdout)
  const sessionId = parsed?.session_id

  if (timedOut) {
    return {
      ok: false,
      binary,
      argv,
      exit_code: spawned.status,
      timed_out: true,
      duration_ms: durationMs,
      stdout,
      stderr,
      parsed,
      ...(sessionId ? { session_id: sessionId } : {}),
      error: `Claude Code invocation timed out after ${durationMs}ms.`,
    }
  }

  if (spawned.status !== 0) {
    return {
      ok: false,
      binary,
      argv,
      exit_code: spawned.status,
      timed_out: false,
      duration_ms: durationMs,
      stdout,
      stderr,
      parsed,
      ...(sessionId ? { session_id: sessionId } : {}),
      error: `Claude Code invocation exited with status ${spawned.status}.`,
    }
  }

  if (!parsed) {
    return {
      ok: false,
      binary,
      argv,
      exit_code: spawned.status,
      timed_out: false,
      duration_ms: durationMs,
      stdout,
      stderr,
      parsed,
      error:
        'Claude Code exited successfully but its stdout did not contain the ' +
        'expected JSON result payload.',
    }
  }

  if (parsed.is_error === true) {
    return {
      ok: false,
      binary,
      argv,
      exit_code: spawned.status,
      timed_out: false,
      duration_ms: durationMs,
      stdout,
      stderr,
      parsed,
      ...(sessionId ? { session_id: sessionId } : {}),
      error:
        `Claude Code reported an error result` +
        (parsed.subtype ? ` (${parsed.subtype})` : '') +
        '.',
    }
  }

  return {
    ok: true,
    binary,
    argv,
    exit_code: spawned.status,
    timed_out: false,
    duration_ms: durationMs,
    stdout,
    stderr,
    parsed,
    ...(sessionId ? { session_id: sessionId } : {}),
  }
}

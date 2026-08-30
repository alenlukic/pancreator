import { spawnSync } from 'node:child_process'

import { isRecord } from '../io.js'

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024

/** Binary used for bounded Cursor evaluations and session recovery. */
export function cursorAgentBinary(): string {
  return process.env.PANCREATOR_CURSOR_AGENT_BIN?.trim() || 'cursor-agent'
}

const HELP_TIMEOUT_MS = 10_000
/** Flags the installed CLI declares, cached per binary for the process. */
const declaredFlags = new Map<string, Set<string> | null>()

/**
 * Whether the installed `cursor-agent` accepts an optional flag.
 *
 * Cursor removes options between releases. Run 63310 genre-label lost every
 * worker model probe to `unknown option '--mode'`; the next run lost them to
 * `unknown option '--trust'` and took the away-mode evaluator down with them,
 * so an operator-owned ratification silently became a supervisor stand-in.
 * Every optional flag has to be asked for rather than assumed.
 *
 * An unreadable help output keeps the documented argument form: a capability
 * check that fails closed would strip flags a working CLI needs.
 */
export function cursorAgentSupportsFlag(
  flag: string,
  env?: NodeJS.ProcessEnv,
): boolean {
  const binary = cursorAgentBinary()

  if (!declaredFlags.has(binary)) {
    const help = spawnSync(binary, ['--help'], {
      encoding: 'utf8',
      input: '',
      timeout: HELP_TIMEOUT_MS,
      ...(env ? { env } : {}),
    })

    declaredFlags.set(
      binary,
      help.error || typeof help.stdout !== 'string'
        ? null
        : new Set(
            [...help.stdout.matchAll(/(--[a-z0-9][a-z0-9-]*)/gu)].map(
              (match) => match[1],
            ),
          ),
    )
  }

  const flags = declaredFlags.get(binary) ?? null

  return flags === null ? true : flags.has(flag)
}

/** Reset the cached capability read. Tests install different fake CLIs. */
export function resetCursorAgentCapabilities(): void {
  declaredFlags.clear()
}

/** Keep only the optional flags the installed CLI declares. */
export function withSupportedFlags(
  pairs: Array<[string, ...string[]]>,
  env?: NodeJS.ProcessEnv,
): string[] {
  return pairs.flatMap((pair) =>
    cursorAgentSupportsFlag(pair[0], env) ? pair : [],
  )
}

export interface CursorAgentRequest {
  prompt: string
  cwd: string
  model?: string
  sessionId?: string
  timeoutMs?: number
}

export interface CursorAgentResult {
  ok: boolean
  binary: string
  argv: string[]
  exit_code: number | null
  timed_out: boolean
  duration_ms: number
  stdout: string
  stderr: string
  session_id?: string
  value?: unknown
  error?: string
}

interface CursorAgentExecutionOptions {
  toolFree: boolean
  requireJson: boolean
}

function eventText(event: Record<string, unknown>): string | null {
  for (const key of ['result', 'text', 'message']) {
    const value = event[key]

    if (typeof value === 'string') {
      return value
    }

    if (isRecord(value) && typeof value.text === 'string') {
      return value.text
    }
  }

  return null
}

function parseJsonValue(text: string): unknown | undefined {
  const trimmed = text.trim()

  if (trimmed.length === 0) {
    return undefined
  }

  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(trimmed)?.[1]

    if (!fenced) {
      return undefined
    }

    try {
      return JSON.parse(fenced) as unknown
    } catch {
      return undefined
    }
  }
}

function parseStream(stdout: string): {
  sessionId?: string
  value?: unknown
} {
  let sessionId: string | undefined
  let value: unknown | undefined

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()

    if (trimmed.length === 0) {
      continue
    }

    let event: unknown

    try {
      event = JSON.parse(trimmed) as unknown
    } catch {
      continue
    }

    if (!isRecord(event)) {
      continue
    }

    if (typeof event.session_id === 'string') {
      sessionId = event.session_id
    }

    const text = eventText(event)
    const parsed = text ? parseJsonValue(text) : undefined

    if (parsed !== undefined) {
      value = parsed
    }
  }

  return {
    ...(sessionId ? { sessionId } : {}),
    ...(value !== undefined ? { value } : {}),
  }
}

function runCursorAgent(
  request: CursorAgentRequest,
  options: CursorAgentExecutionOptions,
): CursorAgentResult {
  const binary = cursorAgentBinary()
  const argv = ['-p', '--output-format', 'stream-json']

  if (options.toolFree) {
    argv.push(...withSupportedFlags([['--mode', 'ask']]))
  }

  argv.push(...withSupportedFlags([['--trust']]))

  if (request.model) {
    argv.push('--model', request.model)
  }

  if (request.sessionId) {
    argv.push('--resume', request.sessionId)
  }

  argv.push(request.prompt)

  const startedAt = Date.now()
  const spawned = spawnSync(binary, argv, {
    cwd: request.cwd,
    encoding: 'utf8',
    input: '',
    timeout: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
  })
  const durationMs = Date.now() - startedAt
  const timedOut =
    (spawned.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT'
  const stdout = spawned.stdout ?? ''
  const stderr = spawned.stderr ?? ''

  if (spawned.error && !timedOut) {
    return {
      ok: false,
      binary,
      argv,
      exit_code: spawned.status,
      timed_out: false,
      duration_ms: durationMs,
      stdout,
      stderr,
      error: `Failed to spawn '${binary}': ${spawned.error.message}`,
    }
  }

  if (timedOut || spawned.status !== 0) {
    return {
      ok: false,
      binary,
      argv,
      exit_code: spawned.status,
      timed_out: timedOut,
      duration_ms: durationMs,
      stdout,
      stderr,
      error: timedOut
        ? `Cursor agent timed out after ${request.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms.`
        : `Cursor agent exited with status ${String(spawned.status)}.`,
    }
  }

  const parsed = parseStream(stdout)

  if (options.requireJson && parsed.value === undefined) {
    return {
      ok: false,
      binary,
      argv,
      exit_code: spawned.status,
      timed_out: false,
      duration_ms: durationMs,
      stdout,
      stderr,
      ...(parsed.sessionId ? { session_id: parsed.sessionId } : {}),
      error: 'Cursor agent returned no parseable JSON value.',
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
    ...(parsed.sessionId ? { session_id: parsed.sessionId } : {}),
    ...(parsed.value !== undefined ? { value: parsed.value } : {}),
  }
}

/**
 * Run one tool-free Cursor evaluation. Ask mode prevents filesystem or shell
 * mutation while the evaluator ranks bounded options.
 */
export function runCursorAgentJson(
  request: CursorAgentRequest,
): CursorAgentResult {
  return runCursorAgent(request, { toolFree: true, requireJson: true })
}

/** Resume or redeliver an agent session with its normal tool permissions. */
export function runCursorAgentSession(
  request: CursorAgentRequest,
): CursorAgentResult {
  return runCursorAgent(request, { toolFree: false, requireJson: false })
}

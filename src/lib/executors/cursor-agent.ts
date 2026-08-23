import { spawnSync } from 'node:child_process'

import { isRecord } from '../io.js'

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024

/** Binary used for bounded Cursor evaluations and session recovery. */
export function cursorAgentBinary(): string {
  return process.env.PANCREATOR_CURSOR_AGENT_BIN?.trim() || 'cursor-agent'
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
    argv.push('--mode', 'ask')
  }

  argv.push('--trust')

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

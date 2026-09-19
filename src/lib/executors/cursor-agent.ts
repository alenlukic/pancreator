import { spawnSync } from 'node:child_process'
import path from 'node:path'

import { isRecord } from '../io.js'
import type {
  ExternalExecutorAdapter,
  ExternalModelVerification,
} from '../types.js'
import { probeEnvironment } from './cursor-auth.js'

// A failed spawn's ledger record used to say only "exited with status 1". The
// last stderr line is what names the cause, so it rides along, bounded.
const STDERR_SUMMARY_MAX = 300

function stderrSummary(stderr: string): string {
  const lastLine = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .at(-1)

  if (!lastLine) {
    return ''
  }

  return ` ${lastLine.slice(0, STDERR_SUMMARY_MAX)}`
}

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024

/** Binary used for bounded Cursor evaluations and session recovery. */
export function cursorAgentBinary(): string {
  return process.env.PANCREATOR_CURSOR_AGENT_BIN?.trim() || 'cursor-agent'
}

const HELP_TIMEOUT_MS = 10_000
/** Flags the installed CLI declares, cached per binary for the process. */
const declaredFlags = new Map<string, Set<string> | null>()

function declaredFlagsIn(help: string): Set<string> {
  return new Set(
    [...help.matchAll(/(--[a-z0-9][a-z0-9-]*)/gu)].map((match) => match[1]),
  )
}

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
        : declaredFlagsIn(help.stdout),
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

/**
 * Flags every headless stage delegation emits. A stage worker cannot degrade
 * to a shorter vector the way a probe can: it needs the trust grant and both
 * workspace grants. Preflight therefore asks the installed CLI for them
 * rather than discovering the gap at spawn time, once per stage.
 *
 * `--resume` is deliberately absent, because only a resumed delegation emits
 * it. Requiring it would pause a fresh delegation that never uses it, while a
 * resume the CLI cannot accept already degrades safely: the failed attempt is
 * recorded as `resume_attempt` and the delegation falls back to a fresh
 * full-card delivery.
 */
export const CURSOR_SESSION_REQUIRED_FLAGS = [
  '--output-format',
  '--trust',
  '--force',
  '--model',
  '--workspace',
  '--add-dir',
]

export interface CursorAgentRequest {
  prompt: string
  /** Working directory of the spawned agent. */
  cwd: string
  /** Workspace root granted to a headless stage worker. */
  workspaceRoot?: string
  /** Additional roots granted to a headless stage worker. */
  addDirs?: string[]
  /** The headless stage contract requires --trust instead of capability fallback. */
  requireTrust?: boolean
  /**
   * Harness installation root the credential search starts from. ASK-001
   * resolves `CURSOR_API_KEY` from the installation or its workspace `.env`,
   * which a worktree `cwd` does not carry, so the two roots stay separate.
   */
  installationRoot: string
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
  reported_model?: string
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
  reportedModel?: string
  value?: unknown
} {
  let sessionId: string | undefined
  let reportedModel: string | undefined
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

    if (
      event.type === 'system' &&
      event.subtype === 'init' &&
      typeof event.model === 'string'
    ) {
      reportedModel = event.model
    }

    const text = eventText(event)
    const parsed = text ? parseJsonValue(text) : undefined

    if (parsed !== undefined) {
      value = parsed
    }
  }

  return {
    ...(sessionId ? { sessionId } : {}),
    ...(reportedModel ? { reportedModel } : {}),
    ...(value !== undefined ? { value } : {}),
  }
}

type CursorArgumentRequest = Pick<
  CursorAgentRequest,
  'model' | 'sessionId' | 'workspaceRoot' | 'addDirs'
>

/**
 * The one argument vector every cursor-agent spawn is built from. `leading`
 * carries the mode and trust flags each caller resolves differently, and
 * `trailing` the workspace grants only a stage worker receives.
 */
function cursorAgentArguments(
  request: CursorArgumentRequest,
  leading: string[],
  trailing: string[] = [],
): string[] {
  return [
    '-p',
    '--output-format',
    'stream-json',
    ...leading,
    ...(request.model ? ['--model', request.model] : []),
    ...(request.sessionId ? ['--resume', request.sessionId] : []),
    ...trailing,
  ]
}

/**
 * Exact non-interactive argument vector used for a stage-worker session.
 *
 * `--force` is what lets a headless worker run a shell command at all. In
 * print mode the CLI otherwise rejects every command it does not classify as
 * read-only, and the first real headless stage worker was refused
 * `shasum && wc && cat` on its own contract. The operator's deny hooks still
 * apply: the flag allows commands "unless explicitly denied".
 */
export function cursorAgentSessionArguments(
  request: CursorArgumentRequest,
): string[] {
  return cursorAgentArguments(
    request,
    ['--trust', '--force'],
    [
      ...(request.workspaceRoot ? ['--workspace', request.workspaceRoot] : []),
      ...(request.addDirs ?? []).flatMap((directory) => [
        '--add-dir',
        directory,
      ]),
    ],
  )
}

function runCursorAgent(
  request: CursorAgentRequest,
  options: CursorAgentExecutionOptions,
): CursorAgentResult {
  const binary = cursorAgentBinary()
  const argv = options.toolFree
    ? cursorAgentArguments(
        request,
        withSupportedFlags([['--mode', 'ask'], ['--trust']]),
      )
    : request.requireTrust
      ? cursorAgentSessionArguments(request)
      : cursorAgentArguments(request, withSupportedFlags([['--trust']]))

  const startedAt = Date.now()
  const spawned = spawnSync(binary, argv, {
    cwd: request.cwd,
    // ASK-001: a CURSOR_API_KEY in the process environment wins, otherwise the
    // installation or workspace .env supplies it. Every cursor-agent spawn
    // authenticates the same way the model probe does, so an away evaluator
    // or an external-executor stage never fails auth that the probe passed.
    env: probeEnvironment(request.installationRoot),
    encoding: 'utf8',
    // The prompt travels over stdin, never as an argv element. Endpoint
    // security on an operator machine was observed to SIGKILL the cursor-agent
    // wrapper at exec time whenever one argument reached 1000 bytes, which
    // every real evaluator or delegation prompt does. `-p` reads the prompt
    // from stdin when no positional prompt is given, as claude-code.ts relies
    // on for the same reason.
    input: request.prompt,
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
        : spawned.signal
          ? `Cursor agent was killed by ${spawned.signal}.${stderrSummary(stderr)}`
          : `Cursor agent exited with status ${String(spawned.status)}.${stderrSummary(stderr)}`,
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
      ...(parsed.reportedModel ? { reported_model: parsed.reportedModel } : {}),
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
    ...(parsed.reportedModel ? { reported_model: parsed.reportedModel } : {}),
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

export interface CursorAgentAdapterOptions {
  workspaceDir: string
  installationRoot: string
  runtimeDir: string
  modelSpec: string
  /**
   * Whether the local catalog predicts a variant for `modelSpec`. An
   * `unverifiable` prediction still delegates, and its reason reaches the
   * delegation record, so a delegation that ran no drift check cannot be
   * mistaken for one that ran and matched.
   */
  modelVerification: ExternalModelVerification
  timeoutMs?: number
}

/**
 * Verify that the configured cursor-agent binary resolves locally and still
 * declares every flag a stage delegation emits.
 */
export function cursorAgentBinaryReadiness():
  | { ok: true; binary: string }
  | { ok: false; binary: string; error: string } {
  const binary = cursorAgentBinary()
  const result = spawnSync(binary, ['--help'], {
    encoding: 'utf8',
    input: '',
    timeout: HELP_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
  })

  if (result.error) {
    return {
      ok: false,
      binary,
      error: `Cursor agent CLI '${binary}' is not invocable: ${result.error.message}.`,
    }
  }

  if (result.status !== 0) {
    return {
      ok: false,
      binary,
      error: `Cursor agent CLI '${binary}' exited with status ${String(result.status)} during preflight.`,
    }
  }

  // Unreadable help keeps the documented argument form, for the reason
  // `cursorAgentSupportsFlag` states: a capability read that fails closed
  // would block a CLI that works.
  const help = `${result.stdout ?? ''}\n${result.stderr ?? ''}`

  if (help.trim().length === 0) {
    return { ok: true, binary }
  }

  const declared = declaredFlagsIn(help)
  const missing = CURSOR_SESSION_REQUIRED_FLAGS.filter(
    (flag) => !declared.has(flag),
  )

  if (missing.length > 0) {
    return {
      ok: false,
      binary,
      error:
        `Cursor agent CLI '${binary}' declares no ${missing.join(', ')} in ` +
        'its help output, and every headless stage delegation emits those ' +
        'flags.',
    }
  }

  return { ok: true, binary }
}

/**
 * Prefix a headless stage prompt with the path-resolution rule its author
 * assumed.
 *
 * Every delivery prompt and invocation card is written for a supervisor whose
 * working directory is the installation root, so harness paths appear as
 * `runtime/...`. A headless worker starts in the worktree instead, and the
 * first real one resolved its own contract path against that worktree and
 * reported it unreadable. The rule travels as transport context rather than
 * as part of the recorded delivered prompt, which the delegation validator
 * compares byte for byte against the delivery prompt on disk.
 */
export function withWorkspaceContext(
  prompt: string,
  options: Pick<CursorAgentAdapterOptions, 'workspaceDir' | 'installationRoot'>,
): string {
  const workspace = path.resolve(options.workspaceDir)
  const root = path.resolve(options.installationRoot)

  if (workspace === root) {
    return prompt
  }

  return [
    '## Execution context',
    '',
    `Your working directory and Cursor workspace are the managed worktree \`${workspace}\`.`,
    `The harness installation root is \`${root}\`, granted as an additional workspace root.`,
    'Every path in this prompt and in the contract it names that begins with',
    '`runtime/` is relative to the installation root, not to your working',
    `directory: read and write it as \`${root}/runtime/...\`. Repository source`,
    'paths are relative to the worktree. Run `./bin/pan` from the installation',
    'root when a path in the contract names it as the harness command.',
    '',
    prompt,
  ].join('\n')
}

/** Adapt the existing cursor-agent session spawn to harness delegation. */
export function createCursorAgentAdapter(
  options: CursorAgentAdapterOptions,
): ExternalExecutorAdapter {
  const grantedRoots = [options.workspaceDir, options.runtimeDir]
  const toolPolicy = {
    granted_roots: grantedRoots,
    per_path_write_policy: false,
    scope_gate: 'scope.no_unapproved_changes' as const,
  }
  // ASK-001 forbids persisting a secret value, and the child's streams become
  // durable run evidence. The CLI is not expected to echo its credential;
  // this is the layer that holds if a release ever starts to.
  const apiKey =
    process.env.CURSOR_API_KEY ??
    probeEnvironment(options.installationRoot)?.CURSOR_API_KEY
  const sanitize = (text: string): string =>
    apiKey ? text.split(apiKey).join('[redacted CURSOR_API_KEY]') : text

  return {
    kind: 'cursor',
    sanitize,
    run: (prompt, resumeSessionId) => {
      const result = runCursorAgentSession({
        prompt: withWorkspaceContext(prompt, options),
        cwd: options.workspaceDir,
        workspaceRoot: options.workspaceDir,
        addDirs: [options.runtimeDir],
        requireTrust: true,
        installationRoot: options.installationRoot,
        model: options.modelSpec,
        ...(resumeSessionId ? { sessionId: resumeSessionId } : {}),
        ...(options.timeoutMs !== undefined
          ? { timeoutMs: options.timeoutMs }
          : {}),
      })

      const verification = options.modelVerification
      const expected =
        verification.status === 'compared' ? verification.expected_model : null
      const reported = result.reported_model
      const modelError =
        result.ok && !reported
          ? 'Cursor agent returned no system/init model variant.'
          : result.ok && expected !== null && reported !== expected
            ? `Cursor agent reported model '${reported}' but the local catalog predicts '${expected}'.`
            : null

      return {
        ok: result.ok && modelError === null,
        binary: result.binary,
        argv: result.argv,
        exit_code: result.exit_code,
        timed_out: result.timed_out,
        duration_ms: result.duration_ms,
        stdout: sanitize(result.stdout),
        stderr: sanitize(result.stderr),
        ...(result.session_id ? { session_id: result.session_id } : {}),
        ...(reported ? { reported_model: reported } : {}),
        model_verification: verification,
        tool_policy: toolPolicy,
        ...(modelError !== null
          ? { error: modelError }
          : result.error
            ? { error: result.error }
            : {}),
      }
    },
  }
}

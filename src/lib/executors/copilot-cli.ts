import { spawnSync } from 'node:child_process'

import { resolveEnvironmentKey } from './openai-auth.js'

/**
 * Process-level mechanics for the `copilot` persona executor: preflight,
 * credential environment, argument vector, and JSONL result parsing.
 * Run-state orchestration lives in the engine; this module only moves bytes
 * to and from the GitHub Copilot CLI.
 */

/** Oldest Copilot CLI version the delegation contract was tested against. */
export const COPILOT_CLI_MIN_VERSION = '1.0.88'

/** Every flag the adapter passes. Preflight finds each one in `--help`. */
export const COPILOT_CLI_REQUIRED_FLAGS = [
  '-C',
  '--add-dir',
  '--agent',
  '--available-tools',
  '--disable-builtin-mcps',
  '--model',
  '--no-ask-user',
  '--no-auto-update',
  '--output-format',
  '--reasoning-effort',
  '--resume',
  '--secret-env-vars',
] as const

export const COPILOT_PROVIDERS = ['github', 'openai', 'anthropic'] as const

export type CopilotProvider = (typeof COPILOT_PROVIDERS)[number]

/**
 * Built-in tool names, by capability. OpenAI models search with `rg` and
 * write with `apply_patch`; Claude models search with `grep` and write with
 * `edit` and `create`. The allowlist names both families, and the CLI offers
 * only the names the serving model has.
 */
export const COPILOT_READ_TOOLS = ['view', 'glob', 'grep', 'rg'] as const
export const COPILOT_WRITE_TOOLS = ['apply_patch', 'edit', 'create'] as const
export const COPILOT_SHELL_TOOLS = [
  'bash',
  'read_bash',
  'write_bash',
  'stop_bash',
  'list_bash',
] as const

/**
 * Variables the CLI strips from its shell and MCP environments and redacts
 * from its output.
 */
export const COPILOT_SECRET_ENV_VARS = [
  'COPILOT_PROVIDER_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'CURSOR_API_KEY',
] as const

const VERSION_PATTERN = /(\d+)\.(\d+)\.(\d+)/u
const PREFLIGHT_TIMEOUT_MS = 30_000
const DEFAULT_INVOCATION_TIMEOUT_MS = 3_600_000
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

interface ByokProvider {
  key_variable: string
  environment: Record<string, string>
}

/** BYOK endpoint settings per provider. The key value joins them at launch. */
const BYOK_PROVIDERS: Record<
  Exclude<CopilotProvider, 'github'>,
  ByokProvider
> = {
  openai: {
    key_variable: 'OPENAI_API_KEY',
    environment: {
      COPILOT_PROVIDER_TYPE: 'openai',
      COPILOT_PROVIDER_BASE_URL: 'https://api.openai.com/v1',
      COPILOT_PROVIDER_WIRE_API: 'responses',
    },
  },
  anthropic: {
    key_variable: 'ANTHROPIC_API_KEY',
    environment: {
      COPILOT_PROVIDER_TYPE: 'anthropic',
      COPILOT_PROVIDER_BASE_URL: 'https://api.anthropic.com',
    },
  },
}

/** Binary the executor spawns. Overridable for tests and non-standard installs. */
export function copilotCliBinary(): string {
  const override = process.env.PANCREATOR_COPILOT_BIN?.trim()

  return override && override.length > 0 ? override : 'copilot'
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

function helpOffersFlag(help: string, flag: string): boolean {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

  return new RegExp(`(?:^|[\\s,])${escaped}(?=[\\s,=<\\[]|$)`, 'mu').test(help)
}

export interface CopilotCliPreflightResult {
  ok: boolean
  binary: string
  version?: string
  missing_flags?: string[]
  error?: string
}

/**
 * Verify the binary runs, meets the tested minimum version, and still offers
 * every flag the adapter passes. Both checks are local and spend no request.
 */
export function copilotCliPreflight(): CopilotCliPreflightResult {
  const binary = copilotCliBinary()
  const run = (args: string[]) =>
    spawnSync(binary, args, {
      encoding: 'utf8',
      timeout: PREFLIGHT_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    })
  const versionRun = run(['--version'])

  if (versionRun.error) {
    return {
      ok: false,
      binary,
      error:
        `Copilot CLI '${binary}' is not invocable: ${versionRun.error.message}. ` +
        'Install it, or set PANCREATOR_COPILOT_BIN to the binary path.',
    }
  }

  const version = VERSION_PATTERN.exec(versionRun.stdout ?? '')?.[0]

  if (versionRun.status !== 0 || version === undefined) {
    return {
      ok: false,
      binary,
      error: `'${binary} --version' did not report a parseable version.`,
    }
  }

  if (compareVersions(version, COPILOT_CLI_MIN_VERSION) < 0) {
    return {
      ok: false,
      binary,
      version,
      error:
        `Copilot CLI ${version} is older than the tested minimum ` +
        `${COPILOT_CLI_MIN_VERSION}.`,
    }
  }

  const helpRun = run(['--help'])
  const help = helpRun.status === 0 ? (helpRun.stdout ?? '') : ''
  const missing = COPILOT_CLI_REQUIRED_FLAGS.filter(
    (flag) => !helpOffersFlag(help, flag),
  )

  if (missing.length > 0) {
    return {
      ok: false,
      binary,
      version,
      missing_flags: missing,
      error:
        `Copilot CLI ${version} does not offer ${missing.join(', ')} in ` +
        `'${binary} --help', and the adapter passes each of them.`,
    }
  }

  return { ok: true, binary, version }
}

export type CopilotCredentialSource =
  | 'github_login'
  | 'process_environment'
  | 'dotenv'

/** Credential report that never carries the key value or its length. */
export interface CopilotCredentialReport {
  provider: CopilotProvider
  source: CopilotCredentialSource | null
  source_path: string | null
  key_variable: string | null
  error?: string
}

export interface CopilotCredential extends CopilotCredentialReport {
  source: CopilotCredentialSource
  /** Child environment additions. Holds the key; never record or print it. */
  environment: Record<string, string>
  /** The key value, for redaction only. */
  secret: string | null
}

/** Provider a mapping names, defaulting to the stored GitHub login. */
export function copilotProviderOf(
  options: Record<string, string>,
): CopilotProvider {
  const provider = options.provider ?? 'github'

  return (COPILOT_PROVIDERS as readonly string[]).includes(provider)
    ? (provider as CopilotProvider)
    : 'github'
}

/**
 * Derive the child environment for one provider. A BYOK provider reads its
 * key from the process environment or a repository-local `.env`. The GitHub
 * provider relies on the CLI's stored login, which no local check can prove
 * without spending a request.
 */
export function resolveCopilotCredential(
  cwd: string,
  provider: CopilotProvider,
):
  | { ok: true; credential: CopilotCredential }
  | {
      ok: false
      report: CopilotCredentialReport
    } {
  if (provider === 'github') {
    return {
      ok: true,
      credential: {
        provider,
        source: 'github_login',
        source_path: null,
        key_variable: null,
        environment: {},
        secret: null,
      },
    }
  }

  const byok = BYOK_PROVIDERS[provider]
  const resolved = resolveEnvironmentKey(cwd, byok.key_variable)

  if (resolved.key === null || resolved.source === null) {
    return {
      ok: false,
      report: {
        provider,
        source: null,
        source_path: null,
        key_variable: byok.key_variable,
        error:
          `No ${byok.key_variable} is available for the Copilot CLI ` +
          `${provider} provider. Export it, or add ${byok.key_variable}=<key> ` +
          'to the repository-local .env file.',
      },
    }
  }

  return {
    ok: true,
    credential: {
      provider,
      source: resolved.source,
      source_path: resolved.sourcePath,
      key_variable: byok.key_variable,
      environment: {
        ...byok.environment,
        COPILOT_PROVIDER_API_KEY: resolved.key,
      },
      secret: resolved.key,
    },
  }
}

/** The non-secret view of a credential, for evidence and diagnostics. */
export function copilotCredentialReport(
  credential: CopilotCredentialReport,
): CopilotCredentialReport {
  return {
    provider: credential.provider,
    source: credential.source,
    source_path: credential.source_path,
    key_variable: credential.key_variable,
    ...(credential.error ? { error: credential.error } : {}),
  }
}

export interface CopilotInvocationRequest {
  /** Prompt body. Piped over stdin so the argument vector never carries it. */
  prompt: string
  cwd: string
  model: string
  agent?: string
  effort?: string
  availableTools: readonly string[]
  addDirs: readonly string[]
  resumeSessionId?: string
  timeoutMs?: number
  /** Credential environment. Merged into the child environment only. */
  environment: Record<string, string>
}

/**
 * Argument vector for one non-interactive run. The prompt arrives on stdin,
 * and `COPILOT_ALLOW_ALL=true` in the child environment approves the allowed
 * tools and trusts the working directory, so the CLI loads its project hooks.
 */
export function copilotArgv(
  request: Omit<
    CopilotInvocationRequest,
    'prompt' | 'environment' | 'timeoutMs'
  >,
): string[] {
  return [
    '--output-format',
    'json',
    '-C',
    request.cwd,
    '--model',
    request.model,
    ...(request.agent ? ['--agent', request.agent] : []),
    ...(request.effort ? ['--reasoning-effort', request.effort] : []),
    `--available-tools=${request.availableTools.join(',')}`,
    '--disable-builtin-mcps',
    '--no-ask-user',
    '--no-auto-update',
    `--secret-env-vars=${COPILOT_SECRET_ENV_VARS.join(',')}`,
    ...request.addDirs.flatMap((directory) => ['--add-dir', directory]),
    ...(request.resumeSessionId ? [`--resume=${request.resumeSessionId}`] : []),
  ]
}

export interface CopilotResultPayload {
  session_id?: string
  exit_code?: number
  /** The last model any event named. */
  model?: string
  /** The last non-empty assistant message. */
  final_message?: string
}

/**
 * Read the JSONL event stream. Returns null when the stream holds no `result`
 * event, because only that event proves the CLI finished the run.
 */
export function parseCopilotJsonl(stdout: string): CopilotResultPayload | null {
  let result: CopilotResultPayload | null = null
  let model: string | undefined
  let finalMessage: string | undefined

  for (const line of stdout.split('\n')) {
    if (line.trim().length === 0) {
      continue
    }

    let event: unknown

    try {
      event = JSON.parse(line)
    } catch {
      continue
    }

    if (typeof event !== 'object' || event === null) {
      continue
    }

    const record = event as Record<string, unknown>
    const data =
      typeof record.data === 'object' && record.data !== null
        ? (record.data as Record<string, unknown>)
        : {}

    if (typeof data.model === 'string' && data.model.length > 0) {
      model = data.model
    }

    if (
      record.type === 'assistant.message' &&
      typeof data.content === 'string' &&
      data.content.trim().length > 0
    ) {
      finalMessage = data.content
    }

    if (record.type === 'result') {
      result = {
        ...(typeof record.sessionId === 'string'
          ? { session_id: record.sessionId }
          : {}),
        ...(typeof record.exitCode === 'number'
          ? { exit_code: record.exitCode }
          : {}),
      }
    }
  }

  if (result === null) {
    return null
  }

  return {
    ...result,
    ...(model ? { model } : {}),
    ...(finalMessage ? { final_message: finalMessage } : {}),
  }
}

export interface CopilotInvocationResult {
  ok: boolean
  binary: string
  /** Resolved argument vector, excluding the prompt body and every credential. */
  argv: string[]
  exit_code: number | null
  timed_out: boolean
  duration_ms: number
  stdout: string
  stderr: string
  parsed: CopilotResultPayload | null
  session_id?: string
  error?: string
}

/**
 * The worker's environment. `COPILOT_ALLOW_ALL` approves tools and trusts the
 * workspace so project hooks load. `PAN_HOST` labels the worker's `bin/pan-run`
 * records, and the supervisor's Cursor conversation id is withheld so those
 * records never name a session the worker does not run in.
 */
export function copilotEnvironment(
  credentialEnvironment: Record<string, string>,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    ...credentialEnvironment,
    COPILOT_ALLOW_ALL: 'true',
    PAN_HOST: 'copilot-cli',
  }

  delete environment.CURSOR_CONVERSATION_ID
  delete environment.PAN_HOST_SESSION_ID
  return environment
}

/** Run one non-interactive Copilot CLI invocation and parse its JSONL stream. */
export function runCopilotCli(
  request: CopilotInvocationRequest,
): CopilotInvocationResult {
  const binary = copilotCliBinary()
  const argv = copilotArgv(request)
  const startedAt = Date.now()
  const spawned = spawnSync(binary, argv, {
    cwd: request.cwd,
    encoding: 'utf8',
    input: request.prompt,
    timeout: request.timeoutMs ?? DEFAULT_INVOCATION_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
    env: copilotEnvironment(request.environment),
  })
  const durationMs = Date.now() - startedAt
  const timedOut =
    (spawned.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT'
  const stdout = spawned.stdout ?? ''
  const stderr = spawned.stderr ?? ''
  const parsed = parseCopilotJsonl(stdout)
  const base = {
    binary,
    argv,
    exit_code: spawned.status,
    timed_out: timedOut,
    duration_ms: durationMs,
    stdout,
    stderr,
    parsed,
    ...(parsed?.session_id ? { session_id: parsed.session_id } : {}),
  }

  if (spawned.error && !timedOut) {
    return {
      ...base,
      ok: false,
      error: `Failed to spawn '${binary}': ${spawned.error.message}`,
    }
  }

  if (timedOut) {
    return {
      ...base,
      ok: false,
      error: `Copilot CLI invocation timed out after ${durationMs}ms.`,
    }
  }

  if (parsed === null) {
    return {
      ...base,
      ok: false,
      error:
        `Copilot CLI exited with status ${spawned.status} and its stdout ` +
        'held no JSONL result event.',
    }
  }

  if (spawned.status !== 0 || (parsed.exit_code ?? 0) !== 0) {
    return {
      ...base,
      ok: false,
      error:
        `Copilot CLI exited with status ${spawned.status}` +
        (parsed.exit_code !== undefined
          ? ` and reported exit code ${parsed.exit_code}.`
          : '.'),
    }
  }

  return { ...base, ok: true }
}

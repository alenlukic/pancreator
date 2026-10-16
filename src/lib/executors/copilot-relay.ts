import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '../errors.js'
import { appendJsonLine, isRecord } from '../io.js'
import { processStartIdentity } from '../watch/process-evidence.js'
import {
  COPILOT_MAX_OUTPUT_BYTES,
  COPILOT_SECRET_ENV_VARS,
  DEFAULT_INVOCATION_TIMEOUT_MS,
  copilotArgv,
  copilotCliBinary,
  parseCopilotJsonl,
  type CopilotInvocationRequest,
  type CopilotInvocationResult,
} from './copilot-cli.js'
import {
  delegationLivePaths,
  updateDelegationLiveRecord,
  writeDelegationLiveLaunch,
  type DelegationLiveEvent,
  type DelegationLiveRecord,
} from './delegation-live.js'

type RelayRequest = Omit<CopilotInvocationRequest, 'environment'> & {
  adapterParentPid: number
}

export const COPILOT_RELAY_LIMITS = Object.freeze({
  frameCharacters: 4 * 1024 * 1024,
  eventFileBytes: COPILOT_MAX_OUTPUT_BYTES,
})

/**
 * Hold only a possible secret prefix between writes. Redaction precedes line
 * framing, so a key split across chunks (or lines) never reaches any sink.
 */
export class CopilotStreamRedactor {
  private pending = ''
  private readonly secrets: Array<{ text: string; prefixes: number[] }>

  constructor(secrets: readonly string[]) {
    this.secrets = [...new Set(secrets.filter((secret) => secret.length > 0))]
      .sort((left, right) => right.length - left.length)
      .map((text) => {
        const prefixes = new Array<number>(text.length).fill(0)
        let matched = 0

        for (let index = 1; index < text.length; index++) {
          while (matched > 0 && text[index] !== text[matched]) {
            matched = prefixes[matched - 1] ?? 0
          }

          if (text[index] === text[matched]) {
            matched++
          }

          prefixes[index] = matched
        }

        return { text, prefixes }
      })
  }

  write(text: string, final = false): string {
    this.pending += text
    let output = ''

    while (this.pending.length > 0) {
      let first = -1
      let matched = ''

      for (const secret of this.secrets) {
        const index = this.pending.indexOf(secret.text)

        if (index >= 0 && (first < 0 || index < first)) {
          first = index
          matched = secret.text
        }
      }

      let held = 0

      if (!final) {
        for (const secret of this.secrets) {
          let matched = 0

          for (
            let index = Math.max(
              0,
              this.pending.length - secret.text.length + 1,
            );
            index < this.pending.length;
            index++
          ) {
            while (
              matched > 0 &&
              this.pending[index] !== secret.text[matched]
            ) {
              matched = secret.prefixes[matched - 1] ?? 0
            }

            if (this.pending[index] === secret.text[matched]) {
              matched++
            }

            if (matched === secret.text.length) {
              matched = secret.prefixes[matched - 1] ?? 0
            }
          }

          held = Math.max(held, matched)
        }
      }

      if (first >= 0) {
        let end = first + matched.length
        let previousEnd = 0

        // Mask the union of intersecting matches before consuming their input.
        while (end !== previousEnd) {
          previousEnd = end

          for (const secret of this.secrets) {
            let index = this.pending.indexOf(secret.text, first)

            while (index >= 0 && index < end) {
              end = Math.max(end, index + secret.text.length)
              index = this.pending.indexOf(secret.text, index + 1)
            }
          }
        }

        const prefixStart = this.pending.length - held

        if (held > 0 && prefixStart < end) {
          const safeEnd = Math.min(first, prefixStart)
          output += this.pending.slice(0, safeEnd)
          this.pending = this.pending.slice(safeEnd)
          break
        }

        output += this.pending.slice(0, first) + '[REDACTED]'
        this.pending = this.pending.slice(end)
        continue
      }

      output += this.pending.slice(0, this.pending.length - held)
      this.pending = this.pending.slice(this.pending.length - held)
      break
    }

    return output
  }
}

/** Full strings and JSON-escaped echoes share the same sanitization policy. */
export function copilotRedactionSecrets(
  env: NodeJS.ProcessEnv,
  prompt = '',
): string[] {
  const values = [
    prompt,
    ...COPILOT_SECRET_ENV_VARS.map((key) => env[key] ?? ''),
    env.GH_TOKEN ?? '',
    env.GITHUB_TOKEN ?? '',
    env.COPILOT_GITHUB_TOKEN ?? '',
  ].filter((value) => value.length > 0)

  return values.flatMap((value) => [value, JSON.stringify(value).slice(1, -1)])
}

function parseRelayRequest(raw: string): RelayRequest {
  const value: unknown = JSON.parse(raw)

  if (
    !isRecord(value) ||
    typeof value.prompt !== 'string' ||
    typeof value.cwd !== 'string' ||
    typeof value.model !== 'string' ||
    !Array.isArray(value.availableTools) ||
    !value.availableTools.every((item) => typeof item === 'string') ||
    !Array.isArray(value.addDirs) ||
    !value.addDirs.every((item) => typeof item === 'string') ||
    value.environment !== undefined
  ) {
    throw new Error('Invalid Copilot relay request.')
  }

  if (
    !Number.isSafeInteger(value.adapterParentPid) ||
    Number(value.adapterParentPid) < 1
  ) {
    throw new Error('Invalid Copilot relay adapter parent PID.')
  }

  for (const key of ['agent', 'effort', 'resumeSessionId']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      throw new Error(`Invalid Copilot relay ${key}.`)
    }
  }

  for (const key of ['timeoutMs', 'maxOutputBytes']) {
    if (
      value[key] !== undefined &&
      (!Number.isSafeInteger(value[key]) || Number(value[key]) < 1)
    ) {
      throw new Error(`Invalid Copilot relay ${key}.`)
    }
  }

  if (
    value.live !== undefined &&
    (!isRecord(value.live) ||
      typeof value.live.root !== 'string' ||
      !isRecord(value.live.identity))
  ) {
    throw new Error('Invalid Copilot live evidence request.')
  }

  // The nested identity is checked by delegationLivePaths before any launch.
  return value as RelayRequest
}

function eventDetails(text: string): {
  kind: DelegationLiveEvent['kind']
  session?: string
} {
  let value: unknown

  try {
    value = JSON.parse(text)
  } catch {
    return { kind: 'diagnostic' }
  }

  if (!isRecord(value)) {
    return { kind: 'diagnostic' }
  }

  const type = typeof value.type === 'string' ? value.type : ''
  const data = isRecord(value.data) ? value.data : {}
  const session =
    value.sessionId ?? value.session_id ?? data.sessionId ?? data.session_id
  const kind =
    type === 'result'
      ? 'completion'
      : type.startsWith('assistant.')
        ? 'assistant'
        : type.startsWith('tool.')
          ? 'tool'
          : type.startsWith('session.')
            ? 'session'
            : 'diagnostic'

  return {
    kind,
    ...(typeof session === 'string' && session.length > 0 ? { session } : {}),
  }
}

/**
 * Async child pump behind the synchronous engine boundary. stdout belongs to
 * the final envelope; progress is emitted once, on inherited stderr.
 * The internal limits argument permits small deterministic saturation fixtures;
 * wire requests cannot override the frame or event-file ceilings.
 */
export async function runCopilotRelay(
  rawRequest: string,
  env: NodeJS.ProcessEnv,
  writeProgress: (text: string) => void,
  limits: Readonly<typeof COPILOT_RELAY_LIMITS> = COPILOT_RELAY_LIMITS,
): Promise<CopilotInvocationResult> {
  const request = parseRelayRequest(rawRequest)
  const parentPid = request.adapterParentPid
  const binary = copilotCliBinary()
  const sessionId = request.resumeSessionId || randomUUID()
  const argv = copilotArgv(request, sessionId)
  const started = Date.now()

  const secrets = copilotRedactionSecrets(env, request.prompt)
  const sanitize = (text: string): string =>
    new CopilotStreamRedactor(secrets).write(text, true)
  const live = request.live
  const timestamp = new Date().toISOString()
  const record: DelegationLiveRecord | undefined = live
    ? {
        ...live.identity,
        schema_version: 1,
        executor: 'copilot',
        launched_at: timestamp,
        heartbeat_at: timestamp,
        relay_pid: process.pid,
        relay_start_identity: processStartIdentity(process.pid),
        requested_session_id: sanitize(sessionId),
        ...(env.PAN_RUN_RECORD
          ? { wrapper_record_path: sanitize(env.PAN_RUN_RECORD) }
          : {}),
        ...(request.resumeSessionId
          ? { resumed_from_session_id: sanitize(request.resumeSessionId) }
          : {}),
        sequence: 0,
        stream_sequences: { stdout: 0, stderr: 0 },
        truncated: false,
      }
    : undefined

  if (live && record) {
    writeDelegationLiveLaunch(live.root, record)
  }

  let stdout = ''
  let stderr = ''
  let failure: string | undefined
  let timedOut = false
  let interrupted: string | undefined
  let truncated = false
  let outputBytes = 0
  let eventBytes = 0

  const persist = (): void => {
    if (live && record) {
      record.heartbeat_at = new Date().toISOString()
      updateDelegationLiveRecord(live.root, record)
    }
  }
  const emit = (stream: DelegationLiveEvent['stream'], text: string): void => {
    const details =
      stream === 'stdout' ? eventDetails(text) : { kind: 'diagnostic' as const }

    if (record) {
      record.sequence++

      if (stream !== 'relay') {
        record.stream_sequences[stream]++
      }

      const event: DelegationLiveEvent = {
        schema_version: 1,
        launch_id: record.launch_id,
        sequence: record.sequence,
        stream,
        stream_sequence:
          stream === 'relay' ? 0 : record.stream_sequences[stream],
        received_at: new Date().toISOString(),
        kind: details.kind,
        text,
      }

      if (live) {
        const nextEventBytes =
          eventBytes + Buffer.byteLength(JSON.stringify(event)) + 1

        if (nextEventBytes > limits.eventFileBytes) {
          truncated = true
          record.truncated = true
          throw new Error(
            `Copilot event file limit exceeded: stream=${stream}, observed=${nextEventBytes} bytes, limit=${limits.eventFileBytes} bytes, accepted=${eventBytes} bytes, raw_output=${outputBytes} bytes.`,
          )
        }

        appendJsonLine(delegationLivePaths(live.root, record).events, event)
        eventBytes = nextEventBytes
        if ('session' in details && details.session) {
          record.session_id = details.session
        }
        persist()
      }
    }

    writeProgress(`${text}\n`)
  }
  let childPid: number | undefined
  let killTimer: ReturnType<typeof setTimeout> | undefined
  const killGroup = (signal: NodeJS.Signals): void => {
    if (childPid === undefined) {
      return
    }

    try {
      process.kill(-childPid, signal)
    } catch (error) {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
      ) {
        throw error
      }
    }
  }
  const stop = (): void => {
    killGroup('SIGTERM')
    killTimer ??= setTimeout(() => {
      killGroup('SIGKILL')
    }, 500)
  }
  const fault = (message: string): void => {
    failure ??= sanitize(message)
    stop()
  }
  const onSignal = (signal: NodeJS.Signals): void => {
    interrupted = signal
    fault(`Copilot CLI interrupted by ${signal}.`)
  }
  const onInt = (): void => {
    onSignal('SIGINT')
  }
  const onTerm = (): void => {
    onSignal('SIGTERM')
  }
  if (process.ppid !== parentPid) {
    const error = 'Copilot relay parent exited before CLI launch.'

    if (record) {
      record.ended_at = new Date().toISOString()
      record.exit_code = null
      record.error = error
      persist()
    }

    return {
      ok: false,
      binary: sanitize(binary),
      argv: argv.map(sanitize),
      exit_code: null,
      timed_out: false,
      duration_ms: Date.now() - started,
      stdout: '',
      stderr: '',
      parsed: null,
      error,
      truncated: false,
    }
  }

  process.on('SIGINT', onInt)
  process.on('SIGTERM', onTerm)

  const child = spawn(binary, argv, {
    cwd: request.cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  })
  childPid = child.pid
  const safeEmit = (
    stream: DelegationLiveEvent['stream'],
    text: string,
  ): void => {
    try {
      emit(stream, text)
    } catch (error) {
      fault(`Copilot live evidence failed: ${errorMessage(error)}`)
    }
  }
  const limit = Math.min(
    request.maxOutputBytes ?? COPILOT_MAX_OUTPUT_BYTES,
    COPILOT_MAX_OUTPUT_BYTES,
  )
  const streams = (['stdout', 'stderr'] as const).map((stream) => {
    const decoder = new StringDecoder('utf8')
    const redactor = new CopilotStreamRedactor(secrets)
    let pending = ''
    let discarding = false
    const accept = (text: string): void => {
      pending += text
      let newline = pending.indexOf('\n')

      while (newline >= 0) {
        const line = pending.slice(0, newline)
        pending = pending.slice(newline + 1)

        if (
          !discarding &&
          line.length <= limits.frameCharacters &&
          !truncated
        ) {
          if (stream === 'stdout') {
            stdout += `${line}\n`
          } else {
            stderr += `${line}\n`
          }

          safeEmit(stream, line)
        } else if (!discarding && !truncated) {
          bound('frame', line.length, limits.frameCharacters)
        }

        discarding = false
        newline = pending.indexOf('\n')
      }

      if (pending.length > limits.frameCharacters) {
        const observed = pending.length
        pending = ''
        discarding = true
        bound('frame', observed, limits.frameCharacters)
      }
    }
    const bound = (
      kind: 'frame' | 'aggregate output',
      observed: number,
      maximum: number,
    ): void => {
      if (!truncated) {
        truncated = true

        if (record) {
          record.truncated = true
        }

        const unit = kind === 'frame' ? 'characters' : 'bytes'
        const diagnostic =
          `Copilot ${kind} limit exceeded: stream=${stream}, observed=${observed} ${unit}, ` +
          `limit=${maximum} ${unit}, raw_output=${outputBytes} bytes, event_file=${eventBytes} bytes.`
        // Preserve the originating bound even if the diagnostic fills the event file.
        failure ??= diagnostic
        safeEmit('relay', `[${diagnostic}]`)
        fault(diagnostic)
      }
    }

    child[stream].on('data', (chunk: Buffer) => {
      outputBytes += chunk.length

      if (outputBytes > limit) {
        bound('aggregate output', outputBytes, limit)
        return
      }

      accept(redactor.write(decoder.write(chunk)))
    })

    return {
      finish: (): void => {
        accept(redactor.write(decoder.end(), true))

        if (pending.length > 0 && !discarding && !truncated) {
          accept('\n')
        }
      },
    }
  })

  if (record && child.pid !== undefined) {
    record.child_pid = child.pid

    try {
      record.child_start_identity = processStartIdentity(child.pid)
      persist()
    } catch (error) {
      fault(`Copilot child identity failed: ${errorMessage(error)}`)
    }
  }

  const timeout = setTimeout(() => {
    timedOut = true
    fault(
      `Copilot CLI invocation timed out after ${request.timeoutMs ?? DEFAULT_INVOCATION_TIMEOUT_MS}ms.`,
    )
  }, request.timeoutMs ?? DEFAULT_INVOCATION_TIMEOUT_MS)
  const heartbeat = setInterval(() => {
    try {
      persist()
    } catch (error) {
      fault(`Copilot heartbeat failed: ${errorMessage(error)}`)
    }
  }, 30_000)
  const checkParent = (): void => {
    if (process.ppid !== parentPid) {
      fault('Copilot relay parent exited.')
    }
  }
  checkParent()
  const parentCheck = setInterval(checkParent, 1_000)

  child.stdin.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') {
      fault(`Copilot stdin failed: ${error.message}`)
    }
  })
  child.stdin.end(request.prompt)

  const exit = await new Promise<{
    code: number | null
    signal: NodeJS.Signals | null
  }>((resolve) => {
    child.on('error', (error) => {
      fault(`Failed to spawn Copilot CLI: ${error.message}`)
    })
    child.on('exit', () => {
      // Descendants can inherit the pipes and otherwise delay close forever.
      killGroup('SIGKILL')
    })
    child.on('close', (code, signal) => {
      resolve({ code, signal })
    })
  })

  clearTimeout(timeout)
  clearInterval(heartbeat)
  clearInterval(parentCheck)

  if (killTimer) {
    clearTimeout(killTimer)
  }

  killGroup('SIGKILL')
  process.off('SIGINT', onInt)
  process.off('SIGTERM', onTerm)

  for (const stream of streams) {
    stream.finish()
  }

  const parsed = parseCopilotJsonl(stdout)

  if (!failure) {
    if (exit.signal) {
      failure = `Copilot CLI exited on signal ${exit.signal}.`
    } else if (parsed === null) {
      failure = `Copilot CLI exited with status ${exit.code} and its stdout held no JSONL result event.`
    } else if (exit.code !== 0 || (parsed.exit_code ?? 0) !== 0) {
      failure = `Copilot CLI exited with status ${exit.code} and reported exit code ${parsed.exit_code ?? 'unknown'}.`
    } else if (parsed.model !== undefined && parsed.model !== request.model) {
      failure = `Copilot CLI reported model '${parsed.model}' but the mapping requested '${sanitize(request.model)}'.`
    } else if (!parsed.session_id) {
      failure = 'Copilot CLI result did not identify the bound session.'
    } else if (parsed.session_id !== sanitize(sessionId)) {
      failure =
        'Copilot CLI result session did not match the requested session.'
    }
  }

  const signal = interrupted ?? exit.signal ?? undefined

  if (record) {
    record.ended_at = new Date().toISOString()
    record.exit_code = exit.code

    if (signal) {
      record.signal = signal
    }

    if (failure) {
      record.error = failure
    }

    try {
      persist()
    } catch (error) {
      failure = sanitize(
        `Copilot terminal evidence failed: ${errorMessage(error)}`,
      )
    }
  }

  return {
    ok: failure === undefined,
    binary: sanitize(binary),
    argv: argv.map(sanitize),
    exit_code: exit.code,
    timed_out: timedOut,
    duration_ms: Date.now() - started,
    stdout,
    stderr,
    parsed,
    ...(parsed?.session_id ? { session_id: parsed.session_id } : {}),
    ...(signal ? { signal } : {}),
    ...(failure ? { error: failure } : {}),
    truncated,
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runCopilotRelay(readFileSync(0, 'utf8'), process.env, (text) => {
    process.stderr.write(text)
  })
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`)
    })
    .catch(() => {
      // Request/parser failures must never echo the request or a credential.
      process.stderr.write(
        'Copilot relay failed before a result could be written.\n',
      )
      process.exitCode = 1
    })
}

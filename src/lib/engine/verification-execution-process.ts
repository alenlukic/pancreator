import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { isRecord } from '../io.js'

interface ProcessObservation {
  status: number | null
  signal: string | null
  timed_out: boolean
  stdout: string
  stderr: string
  error?: string
}

interface ProcessRequest {
  binary: string
  argv: string[]
  timeout_ms: number
  max_bytes: number
}

function isObservation(value: unknown): value is ProcessObservation {
  return (
    isRecord(value) &&
    (value.status === null || Number.isInteger(value.status)) &&
    (value.signal === null || typeof value.signal === 'string') &&
    typeof value.timed_out === 'boolean' &&
    typeof value.stdout === 'string' &&
    typeof value.stderr === 'string' &&
    (value.error === undefined || typeof value.error === 'string')
  )
}

/**
 * A child event loop owns the process group and deadline while synchronous
 * workflow preparation waits for its bounded result.
 */
export function runVerificationExecutionProcess(
  request: ProcessRequest,
  cwd: string,
  env: NodeJS.ProcessEnv,
): ProcessObservation {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), '--collect'],
    {
      cwd,
      env,
      input: JSON.stringify(request),
      encoding: 'utf8',
      shell: false,
      timeout: request.timeout_ms + 5000,
      killSignal: 'SIGTERM',
      maxBuffer: request.max_bytes * 12 + 65536,
    },
  )
  if (result.error || result.status !== 0) {
    return {
      status: null,
      signal: result.signal,
      timed_out: false,
      stdout: '',
      stderr: result.stderr ?? '',
      error:
        result.error?.message ??
        `Execution supervisor exited ${result.status}.`,
    }
  }
  const value: unknown = JSON.parse(result.stdout)
  if (!isObservation(value)) {
    throw new Error('Malformed bounded execution result.')
  }
  return value
}

function collect(request: ProcessRequest): void {
  const observation: ProcessObservation = {
    status: null,
    signal: null,
    timed_out: false,
    stdout: '',
    stderr: '',
  }
  const child = spawn(request.binary, request.argv, {
    shell: false,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const terminate = () => {
    if (!child.pid) return
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch (error) {
      if (!isRecord(error) || error.code !== 'ESRCH') throw error
    }
  }
  const timeout = setTimeout(() => {
    observation.timed_out = true
    terminate()
  }, request.timeout_ms)
  const interrupted = () => {
    observation.error = 'Execution supervisor interrupted.'
    terminate()
  }
  process.once('SIGTERM', interrupted)
  process.once('SIGINT', interrupted)
  for (const stream of ['stdout', 'stderr'] as const) {
    const chunks: Buffer[] = []
    let bytes = 0
    child[stream].on('data', (chunk: Buffer) => {
      const remaining = Math.max(0, request.max_bytes - bytes)
      if (remaining > 0) chunks.push(chunk.subarray(0, remaining))
      bytes += chunk.length
      if (bytes > request.max_bytes) {
        observation.error = `${stream} exceeded the output bound.`
        terminate()
      }
    })
    child[stream].once('end', () => {
      observation[stream] = Buffer.concat(chunks).toString('utf8')
    })
  }
  child.once('error', (error) => {
    observation.error = error.message
  })
  child.once('close', (status, signal) => {
    clearTimeout(timeout)
    terminate()
    observation.status = status
    observation.signal = signal
    process.removeListener('SIGTERM', interrupted)
    process.removeListener('SIGINT', interrupted)
    process.stdout.write(JSON.stringify(observation))
  })
}

if (
  process.argv[1] === fileURLToPath(import.meta.url) &&
  process.argv[2] === '--collect'
) {
  collect(JSON.parse(readFileSync(0, 'utf8')) as ProcessRequest)
}

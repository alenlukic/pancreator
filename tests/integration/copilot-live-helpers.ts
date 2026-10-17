import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { delegationLivePaths } from '../../src/lib/executors/delegation-live.js'
import type { CopilotInvocationResult } from '../../src/lib/executors/copilot-cli.js'
import type { setup } from './copilot-live-fixture.js'

export const KEY = 'sk-fake-stream-secret-0123456789'
const LONG_KEY = `${KEY}-credential-tail`
const PROMPT = 'private prompt never persisted'
export const RELAY = fileURLToPath(
  new URL('../../src/lib/executors/copilot-relay.js', import.meta.url),
)

/** Launches the relay or delegation runner with isolated stub settings. */
export function launch(
  fixture: ReturnType<typeof setup>,
  options: {
    mode?: string
    timeoutMs?: number
    maxOutputBytes?: number
    socket?: string
    binary?: string
    runner?: string
    path?: string
    identityGate?: string
    parentSignal?: boolean
    resumeSessionId?: string
  } = {},
): {
  child: ChildProcess
  result: Promise<CopilotInvocationResult>
  progress: () => string
  observed: Promise<void>
} {
  const child = spawn(
    process.execPath,
    options.runner
      ? ['--input-type=module', '--eval', options.runner]
      : [RELAY],
    {
      env: {
        ...process.env,
        PANCREATOR_COPILOT_BIN: options.binary ?? fixture.binary,
        OPENAI_API_KEY: KEY,
        GITHUB_TOKEN: LONG_KEY,
        ...(options.path ? { PATH: options.path } : {}),
        IDENTITY_GATE: options.identityGate ?? '',
        PAN_RUN_RECORD: '/wrapper/record',
        STUB_MODE: options.mode ?? 'handshake',
        HANDSHAKE: options.socket ?? '',
        DESCENDANT: path.join(fixture.root, 'descendant.pid'),
        CLI_STARTED: path.join(fixture.root, 'cli-started.pid'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  let stdout = ''
  let stderr = ''
  let observed: () => void = () => {}
  const progressObserved = new Promise<void>((resolve) => {
    observed = resolve
  })
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString()
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
    if (
      stderr.includes('malformed [REDACTED]\n') &&
      stderr.includes('diagnostic [REDACTED]\n') &&
      stderr.split('\n').includes('[REDACTED]')
    ) {
      observed()
    }
  })
  child.stdin?.end(
    JSON.stringify({
      prompt: PROMPT,
      cwd: fixture.root,
      model: 'test-model',
      availableTools: ['view'],
      addDirs: [],
      adapterParentPid: process.pid,
      timeoutMs: options.timeoutMs ?? 10_000,
      ...(options.resumeSessionId !== undefined
        ? { resumeSessionId: options.resumeSessionId }
        : {}),
      ...(options.maxOutputBytes
        ? { maxOutputBytes: options.maxOutputBytes }
        : {}),
      live: { root: fixture.root, identity: fixture.identity },
    }),
  )

  return {
    child,
    progress: () => stderr,
    observed: progressObserved,
    result: once(child, 'close').then(([code, signal]) => {
      if (options.parentSignal) {
        assert.equal(signal, 'SIGTERM')
      } else {
        assert.equal(code, 0, stderr)
      }
      return JSON.parse(stdout) as CopilotInvocationResult
    }),
  }
}

/** Checks every persisted and displayed sink for seeded secrets and prompt text. */
export function assertSinksSafe(
  fixture: ReturnType<typeof setup>,
  progress: string,
  result: unknown,
): void {
  const paths = delegationLivePaths(fixture.root, fixture.identity)
  const sinks = [
    readFileSync(paths.record, 'utf8'),
    readFileSync(paths.events, 'utf8'),
    progress,
    JSON.stringify(result),
  ]

  for (const sink of sinks) {
    assert.ok(!sink.includes(KEY), sink)
    assert.ok(!sink.includes('-credential-tail'), sink)
    assert.ok(!sink.includes(PROMPT), sink)
  }
}

/** Requires an observation before relay completion, retaining the caller's abort guard. */
export async function beforeExit<T>(
  running: ReturnType<typeof launch>,
  observation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted()
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })

  try {
    return await Promise.race([
      observation,
      aborted,
      running.result.then((result) => {
        throw new Error(
          `CLI returned before the required observation: ${JSON.stringify(result)}`,
        )
      }),
    ])
  } finally {
    if (onAbort) {
      signal?.removeEventListener('abort', onAbort)
    }
  }
}

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createTestTempDirectory } from '../helpers.js'

import type { FakeScript } from './fake-openai-server.js'

export type {
  FakeScript,
  FakeTurn,
  FakeToolCall,
} from './fake-openai-server.js'

/** Recognizable credential the redaction assertions search for. */
export const OPENAI_SENTINEL_KEY = 'sk-test-SENTINEL-DO-NOT-LEAK'

export interface FakeOpenAiEndpoint {
  url: string
  /** Every request body the endpoint received, in order. */
  requests: () => { index: number; body: Record<string, unknown> }[]
  close: () => void
}

const SERVER_ENTRYPOINT = 'fake-openai-server.js'
const STARTUP_TIMEOUT_MS = 20_000

function serverEntrypoint(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    SERVER_ENTRYPOINT,
  )
}

function firstLine(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffered = ''
    const timer = setTimeout(() => {
      reject(new Error('the fake OpenAI endpoint did not report a URL'))
    }, STARTUP_TIMEOUT_MS)

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      buffered += chunk

      const newline = buffered.indexOf('\n')

      if (newline !== -1) {
        clearTimeout(timer)
        resolve(buffered.slice(0, newline).trim())
      }
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

/**
 * Start the scripted endpoint and return its URL. The caller sets
 * `PANCREATOR_OPENAI_ENDPOINT` to that URL so the executor child process
 * reaches it instead of the real API.
 */
export async function startFakeOpenAi(
  script: FakeScript,
): Promise<FakeOpenAiEndpoint> {
  const directory = createTestTempDirectory('fake-openai-')
  const scriptPath = path.join(directory, 'script.json')
  const recordPath = path.join(directory, 'requests.jsonl')

  writeFileSync(scriptPath, JSON.stringify(script))
  writeFileSync(recordPath, '')

  const child = spawn(process.execPath, [serverEntrypoint()], {
    env: {
      ...process.env,
      FAKE_OPENAI_SCRIPT: scriptPath,
      FAKE_OPENAI_RECORD: recordPath,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const url = await firstLine(child)

  return {
    url,
    requests: () =>
      existsSync(recordPath)
        ? readFileSync(recordPath, 'utf8')
            .split('\n')
            .filter((line) => line.trim().length > 0)
            .map(
              (line) =>
                JSON.parse(line) as {
                  index: number
                  body: Record<string, unknown>
                },
            )
        : [],
    close: () => {
      child.kill('SIGKILL')
    },
  }
}

/**
 * Point the executor at `endpoint` with the sentinel credential for the
 * duration of `body`, and restore the ambient environment afterwards.
 */
export function withFakeOpenAi<T>(endpointUrl: string, body: () => T): T {
  const previousEndpoint = process.env.PANCREATOR_OPENAI_ENDPOINT
  const previousKey = process.env.OPENAI_API_KEY

  process.env.PANCREATOR_OPENAI_ENDPOINT = endpointUrl
  process.env.OPENAI_API_KEY = OPENAI_SENTINEL_KEY

  try {
    return body()
  } finally {
    if (previousEndpoint === undefined) {
      delete process.env.PANCREATOR_OPENAI_ENDPOINT
    } else {
      process.env.PANCREATOR_OPENAI_ENDPOINT = previousEndpoint
    }

    if (previousKey === undefined) {
      delete process.env.OPENAI_API_KEY
    } else {
      process.env.OPENAI_API_KEY = previousKey
    }
  }
}

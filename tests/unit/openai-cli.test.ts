import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  parseOpenAiArgs,
  readStdin,
  runOpenAiCli,
} from '../../src/openai-cli.js'
import { createTestTempDirectory } from '../temp.js'

async function withOpenAiApiKey<T>(
  value: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const original = process.env.OPENAI_API_KEY

  if (value === undefined) {
    delete process.env.OPENAI_API_KEY
  } else {
    process.env.OPENAI_API_KEY = value
  }

  try {
    return await run()
  } finally {
    if (original === undefined) {
      delete process.env.OPENAI_API_KEY
    } else {
      process.env.OPENAI_API_KEY = original
    }
  }
}

function captureLines(): { write: (line: string) => void; lines: string[] } {
  const lines: string[] = []

  return { write: (line: string) => lines.push(line), lines }
}

test('readStdin never blocks on an interactive terminal', () => {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')

  Object.defineProperty(process.stdin, 'isTTY', {
    value: true,
    configurable: true,
  })

  try {
    assert.equal(readStdin(), '')
  } finally {
    if (descriptor) {
      Object.defineProperty(process.stdin, 'isTTY', descriptor)
    } else {
      delete (process.stdin as { isTTY?: boolean }).isTTY
    }
  }
})

test('parseOpenAiArgs requires --model for an invocation', () => {
  assert.throws(
    () => parseOpenAiArgs(['--prompt', 'hi']),
    /--model is required/u,
  )
})

test('parseOpenAiArgs accepts all request controls', () => {
  assert.deepEqual(
    parseOpenAiArgs([
      '--model',
      'gpt-6-astra',
      '--prompt',
      'Say hello.',
      '--instructions',
      'Be terse.',
      '--effort',
      'minimal',
      '--max-output-tokens',
      '64',
      '--timeout-ms',
      '5000',
      '--json',
    ]),
    {
      model: 'gpt-6-astra',
      prompt: 'Say hello.',
      instructions: 'Be terse.',
      reasoningEffort: 'minimal',
      maxOutputTokens: 64,
      timeoutMs: 5000,
      json: true,
      doctor: false,
      help: false,
    },
  )
})

test('parseOpenAiArgs rejects invalid effort and numeric options', () => {
  assert.throws(
    () => parseOpenAiArgs(['--model', 'gpt-6-astra', '--effort', 'unbounded']),
    /--effort must be one of/u,
  )
  assert.throws(
    () => parseOpenAiArgs(['--model', 'gpt-6-astra', '--timeout-ms', '0.5']),
    /positive integer/u,
  )
  assert.throws(
    () =>
      parseOpenAiArgs(['--model', 'gpt-6-astra', '--max-output-tokens', '0']),
    /positive integer/u,
  )
})

test('help and doctor do not require a model', () => {
  assert.equal(parseOpenAiArgs(['--help']).help, true)
  assert.equal(parseOpenAiArgs(['--doctor']).doctor, true)
})

test('--help exits successfully before credential checks', async () => {
  const out = captureLines()
  const err = captureLines()

  const exitCode = await runOpenAiCli(
    ['--help'],
    createTestTempDirectory('openai-cli-'),
    out.write,
    err.write,
  )

  assert.equal(exitCode, 0)
  assert.match(out.lines[0] ?? '', /Usage: openai/u)
  assert.deepEqual(err.lines, [])
})

test('--doctor reports repository-local credential readiness', async () => {
  const root = createTestTempDirectory('openai-cli-')
  const out = captureLines()

  writeFileSync(path.join(root, '.env'), 'OPENAI_API_KEY=sk-test\n')

  const exitCode = await withOpenAiApiKey(undefined, () =>
    runOpenAiCli(['--doctor'], root, out.write),
  )
  const report = JSON.parse(out.lines[0] ?? '{}') as {
    key_available?: boolean
    source_path?: string
  }

  assert.equal(exitCode, 0)
  assert.equal(report.key_available, true)
  assert.equal(report.source_path, path.join(root, '.env'))
})

test('a blank prompt fails before credential or network checks', async () => {
  const err = captureLines()

  const exitCode = await runOpenAiCli(
    ['--model', 'gpt-6-astra', '--prompt', '   '],
    createTestTempDirectory('openai-cli-'),
    () => {},
    err.write,
  )

  assert.equal(exitCode, 1)
  assert.match(err.lines[0] ?? '', /no prompt given/u)
})

test('a missing API key returns readiness guidance', async () => {
  const err = captureLines()

  const exitCode = await withOpenAiApiKey(undefined, () =>
    runOpenAiCli(
      ['--model', 'gpt-6-astra', '--prompt', 'hi'],
      createTestTempDirectory('openai-cli-'),
      () => {},
      err.write,
    ),
  )

  assert.equal(exitCode, 1)
  assert.match(err.lines[0] ?? '', /OPENAI_MISSING_API_KEY/u)
  assert.ok(err.lines.some((line) => line.includes('No .env file exists at')))
})

test('plain-text mode prints the extracted model reply', async () => {
  const out = captureLines()
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'hi back' }],
          },
        ],
      }),
      { status: 200 },
    )) as typeof fetch

  const exitCode = await withOpenAiApiKey('sk-test', () =>
    runOpenAiCli(
      ['--model', 'gpt-6-astra', '--prompt', 'hi'],
      createTestTempDirectory('openai-cli-'),
      out.write,
      () => {},
      fetchImpl,
    ),
  )

  assert.equal(exitCode, 0)
  assert.deepEqual(out.lines, ['hi back'])
})

test('--json prints the raw response body', async () => {
  const out = captureLines()
  const raw = {
    id: 'resp_1',
    output_text: 'hi back',
  }
  const fetchImpl = (async () =>
    new Response(JSON.stringify(raw), { status: 200 })) as typeof fetch

  const exitCode = await withOpenAiApiKey('sk-test', () =>
    runOpenAiCli(
      ['--model', 'gpt-6-astra', '--prompt', 'hi', '--json'],
      createTestTempDirectory('openai-cli-'),
      out.write,
      () => {},
      fetchImpl,
    ),
  )

  assert.equal(exitCode, 0)
  assert.deepEqual(JSON.parse(out.lines[0] ?? '{}'), raw)
})

test('an API failure prints its stable error code', async () => {
  const err = captureLines()
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({ error: { message: 'No credits remaining.' } }),
      { status: 429 },
    )) as typeof fetch

  const exitCode = await withOpenAiApiKey('sk-test', () =>
    runOpenAiCli(
      ['--model', 'gpt-6-astra', '--prompt', 'hi'],
      createTestTempDirectory('openai-cli-'),
      () => {},
      err.write,
      fetchImpl,
    ),
  )

  assert.equal(exitCode, 1)
  assert.match(err.lines[0] ?? '', /OPENAI_HTTP_ERROR/u)
  assert.match(err.lines[0] ?? '', /No credits remaining/u)
})

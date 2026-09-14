#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { errorMessage, PanError } from './lib/errors.js'
import {
  createOpenAiResponse,
  type OpenAiReasoningEffort,
} from './lib/executors/openai-client.js'
import {
  openAiAuthenticationReadiness,
  resolveOpenAiApiKey,
} from './lib/executors/openai-auth.js'

const REASONING_EFFORTS: readonly OpenAiReasoningEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

export interface ParsedOpenAiArgs {
  model: string
  prompt?: string
  instructions?: string
  reasoningEffort?: OpenAiReasoningEffort
  maxOutputTokens?: number
  timeoutMs?: number
  json: boolean
  doctor: boolean
  help: boolean
}

const USAGE = `Usage: openai --model <id> [--prompt <text>] [options]
       openai --doctor

Call an OpenAI model through the Responses API.

  --model <id>             Model id, e.g. gpt-6-astra
  --prompt <text>          Prompt text. Reads stdin when omitted.
  --instructions <text>    Optional system-level instructions.
  --effort <level>         Reasoning effort: ${REASONING_EFFORTS.join(', ')}
  --max-output-tokens <n>  Maximum generated tokens.
  --timeout-ms <n>         Request timeout in milliseconds (default 120000).
  --json                   Print the raw response body instead of plain text.
  --doctor                 Report authentication readiness without a request.
  --help                   Show this message.

Reads OPENAI_API_KEY from the process environment or a repository-local .env.
Prefer stdin for sensitive prompts because process arguments can be inspected.`

function badArgs(message: string): PanError {
  return new PanError(message, { code: 'OPENAI_CLI_BAD_ARGS' })
}

function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw badArgs(`${flag} must be a positive integer, got '${value}'.`)
  }

  return parsed
}

/** Pure argument parser, exported for unit tests. */
export function parseOpenAiArgs(argv: string[]): ParsedOpenAiArgs {
  let model: string | undefined
  let prompt: string | undefined
  let instructions: string | undefined
  let reasoningEffort: OpenAiReasoningEffort | undefined
  let maxOutputTokens: number | undefined
  let timeoutMs: number | undefined
  let json = false
  let doctor = false
  let help = false

  const next = (flag: string, index: number): string => {
    const value = argv[index + 1]

    if (value === undefined) {
      throw badArgs(`${flag} requires a value.`)
    }

    return value
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    switch (arg) {
      case '--help':
      case '-h':
        help = true
        break
      case '--doctor':
        doctor = true
        break
      case '--model':
        model = next(arg, index)
        index += 1
        break
      case '--prompt':
        prompt = next(arg, index)
        index += 1
        break
      case '--instructions':
        instructions = next(arg, index)
        index += 1
        break
      case '--effort': {
        const value = next(arg, index)
        index += 1

        if (!REASONING_EFFORTS.includes(value as OpenAiReasoningEffort)) {
          throw badArgs(
            `--effort must be one of ${REASONING_EFFORTS.join(', ')}, got '${value}'.`,
          )
        }

        reasoningEffort = value as OpenAiReasoningEffort
        break
      }
      case '--max-output-tokens':
        maxOutputTokens = positiveInteger(next(arg, index), arg)
        index += 1
        break
      case '--timeout-ms':
        timeoutMs = positiveInteger(next(arg, index), arg)
        index += 1
        break
      case '--json':
        json = true
        break
      default:
        throw badArgs(`Unrecognized argument: ${arg}`)
    }
  }

  if (help || doctor) {
    return {
      model: model ?? '',
      json,
      doctor,
      help,
    }
  }

  if (!model) {
    throw badArgs('--model is required.')
  }

  return {
    model,
    ...(prompt !== undefined ? { prompt } : {}),
    ...(instructions !== undefined ? { instructions } : {}),
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    json,
    doctor,
    help,
  }
}

/** Piped stdin content, or an empty string for an interactive terminal. */
export function readStdin(): string {
  if (process.stdin.isTTY) {
    return ''
  }

  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

export async function runOpenAiCli(
  argv: string[],
  cwd: string,
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  writeError: (line: string) => void = (line) =>
    process.stderr.write(`${line}\n`),
  fetchImpl?: typeof fetch,
): Promise<number> {
  let args: ParsedOpenAiArgs

  try {
    args = parseOpenAiArgs(argv)
  } catch (error) {
    writeError(`Error: ${errorMessage(error)}`)
    return 1
  }

  if (args.help) {
    write(USAGE)
    return 0
  }

  if (args.doctor) {
    const readiness = openAiAuthenticationReadiness(cwd)

    write(JSON.stringify(readiness, null, 2))
    return readiness.key_available ? 0 : 1
  }

  const prompt = args.prompt ?? readStdin()

  if (prompt.trim().length === 0) {
    writeError(
      'Error: no prompt given. Pass --prompt or pipe text over stdin. (OPENAI_CLI_BAD_ARGS)',
    )
    return 1
  }

  const credential = resolveOpenAiApiKey(cwd)

  if (!credential.key) {
    const readiness = openAiAuthenticationReadiness(cwd)

    writeError('Error: no OPENAI_API_KEY available. (OPENAI_MISSING_API_KEY)')

    for (const advisory of readiness.advisories) {
      writeError(`  ${advisory}`)
    }

    return 1
  }

  const result = await createOpenAiResponse({
    apiKey: credential.key,
    model: args.model,
    input: prompt,
    ...(args.instructions !== undefined
      ? { instructions: args.instructions }
      : {}),
    ...(args.reasoningEffort !== undefined
      ? { reasoningEffort: args.reasoningEffort }
      : {}),
    ...(args.maxOutputTokens !== undefined
      ? { maxOutputTokens: args.maxOutputTokens }
      : {}),
    ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
    ...(fetchImpl !== undefined ? { fetchImpl } : {}),
  })

  if (!result.ok) {
    writeError(
      `Error: ${result.error ?? 'the request failed.'} (${result.code ?? 'OPENAI_UNKNOWN_ERROR'})`,
    )
    return 1
  }

  write(
    args.json ? JSON.stringify(result.raw, null, 2) : (result.outputText ?? ''),
  )
  return 0
}

async function main(): Promise<void> {
  process.exitCode = await runOpenAiCli(process.argv.slice(2), process.cwd())
}

function invokedDirectly(): boolean {
  if (process.argv[1] === undefined) {
    return false
  }

  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  main().catch((error: unknown) => {
    process.stderr.write(`Error: ${errorMessage(error)} (OPENAI_CLI_FATAL)\n`)
    process.exitCode = 1
  })
}

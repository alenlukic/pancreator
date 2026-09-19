import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { errorMessage } from './lib/errors.js'
import type {
  OpenAiReasoningContext,
  OpenAiReasoningEffort,
  OpenAiReasoningMode,
  OpenAiReasoningSummary,
  OpenAiTextVerbosity,
} from './lib/executors/openai-client.js'
import {
  readOpenAiTranscript,
  redactOpenAiKey,
  runOpenAiSession,
  type OpenAiSessionResult,
} from './lib/executors/openai-session.js'
import type { OpenAiToolPolicy } from './lib/executors/openai-tools.js'

/**
 * Internal child-process entrypoint for the `openai` persona executor. Not an
 * operator command: the engine spawns it because `delegateInvocation` holds a
 * synchronous run mutex that cannot host an awaited Responses loop.
 *
 * One JSON request arrives on stdin, one JSON result leaves on stdout, and the
 * API key travels only in this process's environment so the recorded argument
 * vector never carries it.
 */

export const OPENAI_AGENT_ENDPOINT_ENV = 'PANCREATOR_OPENAI_ENDPOINT'

export interface OpenAiAgentRequest {
  model: string
  prompt: string
  invocation_id: string
  stage: string
  session_id: string
  reasoning_effort?: OpenAiReasoningEffort
  reasoning_mode?: OpenAiReasoningMode
  reasoning_context?: OpenAiReasoningContext
  reasoning_summary?: OpenAiReasoningSummary
  text_verbosity?: OpenAiTextVerbosity
  max_output_tokens?: number
  max_tool_rounds: number
  request_timeout_ms: number
  session_timeout_ms: number
  transcript_path: string
  transcript_max_bytes: number
  /** Transcript a revision round continues from, when one was recorded. */
  resume_transcript_path?: string
  tool_policy: OpenAiToolPolicy
}

export interface OpenAiAgentResponse {
  ok: boolean
  session_id: string
  rounds: number
  response_ids: string[]
  tool_summary: Record<string, number>
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number }
  final_message?: string
  transcript_path: string
  error?: string
  failure_reason?: string
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function parseRequest(raw: string): OpenAiAgentRequest {
  const parsed: unknown = JSON.parse(raw)

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('The agent request MUST be a JSON object.')
  }

  const candidate = parsed as Partial<OpenAiAgentRequest>

  if (
    typeof candidate.model !== 'string' ||
    typeof candidate.prompt !== 'string' ||
    typeof candidate.session_id !== 'string' ||
    typeof candidate.transcript_path !== 'string' ||
    typeof candidate.tool_policy !== 'object' ||
    candidate.tool_policy === null
  ) {
    throw new Error(
      'The agent request is missing a required field (model, prompt, session_id, transcript_path, tool_policy).',
    )
  }

  return candidate as OpenAiAgentRequest
}

function toResponse(
  result: OpenAiSessionResult,
  apiKey: string,
): OpenAiAgentResponse {
  return {
    ok: result.ok,
    session_id: result.sessionId,
    rounds: result.rounds,
    response_ids: result.responseIds,
    tool_summary: result.toolSummary,
    ...(result.usage !== undefined ? { usage: result.usage } : {}),
    ...(result.finalMessage !== undefined
      ? { final_message: redactOpenAiKey(result.finalMessage, apiKey) }
      : {}),
    transcript_path: result.transcriptPath,
    ...(result.error !== undefined
      ? { error: redactOpenAiKey(result.error, apiKey) }
      : {}),
    ...(result.failureReason !== undefined
      ? { failure_reason: result.failureReason }
      : {}),
  }
}

/** Run one session. Returns the process exit code. */
export async function runOpenAiAgentCli(
  rawRequest: string,
  env: NodeJS.ProcessEnv,
  write: (text: string) => void,
  writeError: (text: string) => void,
): Promise<number> {
  const apiKey = env.OPENAI_API_KEY ?? ''

  if (apiKey.length === 0) {
    writeError('Error: no OPENAI_API_KEY in the executor environment.\n')
    return 1
  }

  let request: OpenAiAgentRequest

  try {
    request = parseRequest(rawRequest)
  } catch (error) {
    writeError(`Error: ${errorMessage(error)}\n`)
    return 1
  }

  const resumeTranscript = request.resume_transcript_path
    ? readOpenAiTranscript(request.resume_transcript_path)
    : null

  if (request.resume_transcript_path && resumeTranscript === null) {
    writeError(
      `Error: continuation transcript ${request.resume_transcript_path} is missing or unreadable.\n`,
    )
    return 1
  }

  const endpoint = env[OPENAI_AGENT_ENDPOINT_ENV]
  const result = await runOpenAiSession({
    apiKey,
    model: request.model,
    prompt: request.prompt,
    invocationId: request.invocation_id,
    stage: request.stage,
    sessionId: request.session_id,
    maxToolRounds: request.max_tool_rounds,
    requestTimeoutMs: request.request_timeout_ms,
    sessionTimeoutMs: request.session_timeout_ms,
    transcriptPath: request.transcript_path,
    transcriptMaxBytes: request.transcript_max_bytes,
    toolPolicy: request.tool_policy,
    ...(request.reasoning_effort !== undefined
      ? { reasoningEffort: request.reasoning_effort }
      : {}),
    ...(request.reasoning_mode !== undefined
      ? { reasoningMode: request.reasoning_mode }
      : {}),
    ...(request.reasoning_context !== undefined
      ? { reasoningContext: request.reasoning_context }
      : {}),
    ...(request.reasoning_summary !== undefined
      ? { reasoningSummary: request.reasoning_summary }
      : {}),
    ...(request.text_verbosity !== undefined
      ? { textVerbosity: request.text_verbosity }
      : {}),
    ...(request.max_output_tokens !== undefined
      ? { maxOutputTokens: request.max_output_tokens }
      : {}),
    ...(resumeTranscript !== null
      ? { resumeItems: resumeTranscript.items }
      : {}),
    ...(endpoint ? { endpoint } : {}),
  })
  const response = toResponse(result, apiKey)

  write(`${JSON.stringify(response)}\n`)

  if (!response.ok) {
    writeError(`${response.error ?? 'the session failed.'}\n`)
  }

  return response.ok ? 0 : 1
}

async function main(): Promise<void> {
  process.exitCode = await runOpenAiAgentCli(
    readStdin(),
    process.env,
    (text) => process.stdout.write(text),
    (text) => process.stderr.write(text),
  )
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
    process.stderr.write(`Error: ${errorMessage(error)}\n`)
    process.exitCode = 1
  })
}

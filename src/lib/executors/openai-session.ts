import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  createOpenAiResponse,
  type OpenAiInputItem,
  type OpenAiReasoningContext,
  type OpenAiReasoningEffort,
  type OpenAiReasoningMode,
  type OpenAiReasoningSummary,
  type OpenAiTextVerbosity,
  type OpenAiUsage,
} from './openai-client.js'
import {
  executeOpenAiTool,
  openAiToolDefinitions,
  type OpenAiToolPolicy,
} from './openai-tools.js'

/**
 * The bounded Responses tool loop.
 *
 * Server-side retention stays off, so the whole conversation is resent each
 * round and continuation state is local. The loop is bounded four ways: tool
 * rounds, one request timeout, an overall wall clock, and a per-result byte
 * cap. Exceeding a bound ends the delegation with a named reason; it never
 * degrades into a partial success.
 */

/** Marker that replaces the resolved API key anywhere text is captured. */
export const OPENAI_REDACTION_MARKER = '[redacted:OPENAI_API_KEY]'

export const OPENAI_TRANSCRIPT_SCHEMA_VERSION = 1

/** Executor defaults an operator overrides through the mapping options. */
export const OPENAI_SESSION_DEFAULTS = {
  maxToolRounds: 60,
  /** Matches the Claude Code adapter's default invocation bound. */
  sessionTimeoutMs: 3_600_000,
  maxToolResultBytes: 256 * 1024,
  shellTimeoutMs: 600_000,
  transcriptMaxBytes: 4 * 1024 * 1024,
} as const

export type OpenAiSessionFailureReason =
  | 'round_limit'
  | 'timeout'
  | 'result_cap'
  | 'request_failed'

export interface OpenAiTranscript {
  schema_version: number
  session_id: string
  invocation_id: string
  stage: string
  recorded_at: string
  /** True when the oldest items were dropped to stay inside the byte cap. */
  truncated: boolean
  items: OpenAiInputItem[]
}

export interface OpenAiSessionRequest {
  apiKey: string
  model: string
  /** First conversation item. The canonical card, byte for byte. */
  prompt: string
  invocationId: string
  stage: string
  sessionId: string
  reasoningEffort?: OpenAiReasoningEffort
  reasoningMode?: OpenAiReasoningMode
  reasoningContext?: OpenAiReasoningContext
  reasoningSummary?: OpenAiReasoningSummary
  textVerbosity?: OpenAiTextVerbosity
  maxOutputTokens?: number
  maxToolRounds: number
  /** Ceiling for one Responses request. Clamped to the remaining wall clock. */
  requestTimeoutMs: number
  /** Bound for the whole loop, including tool execution. */
  sessionTimeoutMs: number
  /** Absolute path of the local continuation transcript. */
  transcriptPath: string
  transcriptMaxBytes: number
  /** Prior conversation items a revision round continues from. */
  resumeItems?: OpenAiInputItem[]
  toolPolicy: OpenAiToolPolicy
  /** Injected for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
  /** Injected for tests. Overrides the Responses endpoint. */
  endpoint?: string
}

export interface OpenAiSessionResult {
  ok: boolean
  rounds: number
  responseIds: string[]
  toolSummary: Record<string, number>
  usage?: OpenAiUsage
  finalMessage?: string
  sessionId: string
  transcriptPath: string
  error?: string
  failureReason?: OpenAiSessionFailureReason
}

/**
 * Remove every occurrence of the resolved key from captured text. Applied
 * before anything is written or returned, because an API error body can echo
 * the credential the harness sent.
 */
export function redactOpenAiKey(text: string, apiKey: string): string {
  if (apiKey.length === 0) {
    return text
  }

  return text.split(apiKey).join(OPENAI_REDACTION_MARKER)
}

function addUsage(
  total: OpenAiUsage | undefined,
  next: OpenAiUsage | undefined,
): OpenAiUsage | undefined {
  if (next === undefined) {
    return total
  }

  if (total === undefined) {
    return { ...next }
  }

  return {
    input_tokens: total.input_tokens + next.input_tokens,
    output_tokens: total.output_tokens + next.output_tokens,
    total_tokens: total.total_tokens + next.total_tokens,
  }
}

/**
 * Persist the conversation so an operator revision can continue it. Oldest
 * items are dropped before the file exceeds its cap, and the drop is recorded
 * rather than hidden. The first item — the canonical card — is always kept,
 * because a continuation without it has no contract.
 */
export function writeOpenAiTranscript(
  transcriptPath: string,
  transcript: OpenAiTranscript,
  maxBytes: number,
): OpenAiTranscript {
  const items = [...transcript.items]
  const serialize = (value: OpenAiTranscript): string =>
    `${JSON.stringify(value, null, 2)}\n`
  let candidate: OpenAiTranscript = { ...transcript, items }
  let serialized = serialize(candidate)

  while (items.length > 1 && Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    items.splice(1, 1)
    candidate = { ...transcript, truncated: true, items }
    serialized = serialize(candidate)
  }

  mkdirSync(path.dirname(transcriptPath), { recursive: true })
  writeFileSync(transcriptPath, serialized)

  return candidate
}

/** Read a persisted transcript, returning null when it cannot be continued. */
export function readOpenAiTranscript(
  transcriptPath: string,
): OpenAiTranscript | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(readFileSync(transcriptPath, 'utf8'))
  } catch {
    return null
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as OpenAiTranscript).items) ||
    (parsed as OpenAiTranscript).items.length === 0
  ) {
    return null
  }

  return parsed as OpenAiTranscript
}

interface RoundBounds {
  deadline: number
  maxRounds: number
}

function boundFailure(
  reason: OpenAiSessionFailureReason,
  error: string,
  state: {
    rounds: number
    responseIds: string[]
    toolSummary: Record<string, number>
    usage?: OpenAiUsage
  },
  request: OpenAiSessionRequest,
): OpenAiSessionResult {
  return {
    ok: false,
    rounds: state.rounds,
    responseIds: state.responseIds,
    toolSummary: state.toolSummary,
    ...(state.usage !== undefined ? { usage: state.usage } : {}),
    sessionId: request.sessionId,
    transcriptPath: request.transcriptPath,
    error: redactOpenAiKey(error, request.apiKey),
    failureReason: reason,
  }
}

/**
 * Run the loop until the model returns a final message or a bound is reached.
 */
export async function runOpenAiSession(
  request: OpenAiSessionRequest,
): Promise<OpenAiSessionResult> {
  const items: OpenAiInputItem[] = [
    ...(request.resumeItems ?? []),
    { role: 'user', content: request.prompt },
  ]
  const bounds: RoundBounds = {
    deadline: Date.now() + request.sessionTimeoutMs,
    maxRounds: request.maxToolRounds,
  }

  const responseIds: string[] = []
  const toolSummary: Record<string, number> = {}
  let usage: OpenAiUsage | undefined
  let rounds = 0

  const persist = (): void => {
    writeOpenAiTranscript(
      request.transcriptPath,
      {
        schema_version: OPENAI_TRANSCRIPT_SCHEMA_VERSION,
        session_id: request.sessionId,
        invocation_id: request.invocationId,
        stage: request.stage,
        recorded_at: new Date().toISOString(),
        truncated: false,
        items,
      },
      request.transcriptMaxBytes,
    )
  }

  for (;;) {
    if (Date.now() >= bounds.deadline) {
      persist()
      return boundFailure(
        'timeout',
        `OpenAI session exceeded its ${request.sessionTimeoutMs}ms wall clock after ${rounds} tool round(s).`,
        { rounds, responseIds, toolSummary, ...(usage ? { usage } : {}) },
        request,
      )
    }

    const response = await createOpenAiResponse({
      apiKey: request.apiKey,
      model: request.model,
      input: items,
      tools: openAiToolDefinitions(request.toolPolicy),
      // Never let one request outlive the session budget: a slow endpoint
      // must fail as a timeout rather than hang past the operator's bound.
      timeoutMs: Math.max(
        1,
        Math.min(request.requestTimeoutMs, bounds.deadline - Date.now()),
      ),
      ...(request.reasoningEffort
        ? { reasoningEffort: request.reasoningEffort }
        : {}),
      ...(request.reasoningMode
        ? { reasoningMode: request.reasoningMode }
        : {}),
      ...(request.reasoningContext
        ? { reasoningContext: request.reasoningContext }
        : {}),
      ...(request.reasoningSummary
        ? { reasoningSummary: request.reasoningSummary }
        : {}),
      ...(request.textVerbosity
        ? { textVerbosity: request.textVerbosity }
        : {}),
      ...(request.maxOutputTokens !== undefined
        ? { maxOutputTokens: request.maxOutputTokens }
        : {}),
      ...(request.fetchImpl ? { fetchImpl: request.fetchImpl } : {}),
      ...(request.endpoint ? { endpoint: request.endpoint } : {}),
    })

    if (response.responseId) {
      responseIds.push(response.responseId)
    }

    usage = addUsage(usage, response.usage)

    if (!response.ok) {
      persist()
      return boundFailure(
        response.code === 'OPENAI_TIMEOUT' ? 'timeout' : 'request_failed',
        `OpenAI request failed (${response.code ?? 'unknown'}): ${response.error ?? 'no detail'}`,
        { rounds, responseIds, toolSummary, ...(usage ? { usage } : {}) },
        request,
      )
    }

    if (response.functionCalls.length === 0) {
      items.push({
        role: 'assistant',
        content: response.outputText ?? '',
      })
      persist()

      return {
        ok: true,
        rounds,
        responseIds,
        toolSummary,
        ...(usage !== undefined ? { usage } : {}),
        ...(response.outputText !== undefined
          ? { finalMessage: response.outputText }
          : {}),
        sessionId: request.sessionId,
        transcriptPath: request.transcriptPath,
      }
    }

    if (rounds >= bounds.maxRounds) {
      persist()
      return boundFailure(
        'round_limit',
        `OpenAI session reached its round limit of ${bounds.maxRounds} without a final answer.`,
        { rounds, responseIds, toolSummary, ...(usage ? { usage } : {}) },
        request,
      )
    }

    rounds += 1

    for (const call of response.functionCalls) {
      // An oversized argument payload is a hard stop, not a truncation: the
      // harness cannot know which part of a write the model meant to keep.
      const argumentBytes = Buffer.byteLength(call.arguments, 'utf8')

      if (argumentBytes > request.toolPolicy.maxResultBytes) {
        persist()
        return boundFailure(
          'result_cap',
          `Tool call '${call.name}' supplied ${argumentBytes} bytes of arguments, ` +
            `over the ${request.toolPolicy.maxResultBytes}-byte cap.`,
          { rounds, responseIds, toolSummary, ...(usage ? { usage } : {}) },
          request,
        )
      }

      const executed = executeOpenAiTool(
        call.name,
        call.arguments,
        request.toolPolicy,
      )

      toolSummary[call.name] = (toolSummary[call.name] ?? 0) + 1

      items.push({
        type: 'function_call',
        call_id: call.call_id,
        name: call.name,
        arguments: call.arguments,
      })
      items.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: redactOpenAiKey(executed.output, request.apiKey),
      })
    }

    persist()
  }
}

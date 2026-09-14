import { isRecord } from '../io.js'

export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'

export type OpenAiReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

export interface OpenAiResponseRequest {
  apiKey: string
  model: string
  input: string
  instructions?: string
  reasoningEffort?: OpenAiReasoningEffort
  maxOutputTokens?: number
  timeoutMs?: number
  /** Injected for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
}

export interface OpenAiUsage {
  input_tokens: number
  output_tokens: number
  total_tokens: number
}

export interface OpenAiResponseResult {
  ok: boolean
  model: string
  httpStatus: number | null
  responseId?: string
  outputText?: string
  usage?: OpenAiUsage
  raw?: unknown
  error?: string
  code?: string
}

const DEFAULT_TIMEOUT_MS = 120_000

function extractOutputText(body: Record<string, unknown>): string | undefined {
  if (typeof body.output_text === 'string') {
    return body.output_text
  }

  if (!Array.isArray(body.output)) {
    return undefined
  }

  const parts: string[] = []

  for (const item of body.output) {
    if (
      !isRecord(item) ||
      item.type !== 'message' ||
      !Array.isArray(item.content)
    ) {
      continue
    }

    for (const block of item.content) {
      if (
        isRecord(block) &&
        block.type === 'output_text' &&
        typeof block.text === 'string'
      ) {
        parts.push(block.text)
      }
    }
  }

  return parts.length > 0 ? parts.join('') : undefined
}

function extractUsage(usage: unknown): OpenAiUsage | undefined {
  if (
    !isRecord(usage) ||
    typeof usage.input_tokens !== 'number' ||
    typeof usage.output_tokens !== 'number' ||
    typeof usage.total_tokens !== 'number'
  ) {
    return undefined
  }

  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens,
  }
}

function apiErrorMessage(body: unknown): string | undefined {
  if (!isRecord(body) || !isRecord(body.error)) {
    return undefined
  }

  return typeof body.error.message === 'string' ? body.error.message : undefined
}

/** Call the OpenAI Responses API once and normalize operational failures. */
export async function createOpenAiResponse(
  request: OpenAiResponseRequest,
): Promise<OpenAiResponseResult> {
  const fetchImpl = request.fetchImpl ?? fetch
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response

  try {
    response = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        input: request.input,
        store: false,
        ...(request.instructions ? { instructions: request.instructions } : {}),
        ...(request.reasoningEffort
          ? { reasoning: { effort: request.reasoningEffort } }
          : {}),
        ...(request.maxOutputTokens !== undefined
          ? { max_output_tokens: request.maxOutputTokens }
          : {}),
      }),
      signal: controller.signal,
    })
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'

    clearTimeout(timer)
    return {
      ok: false,
      model: request.model,
      httpStatus: null,
      error: aborted
        ? `Request to ${OPENAI_RESPONSES_URL} timed out after ${timeoutMs}ms.`
        : `Request to ${OPENAI_RESPONSES_URL} failed: ${error instanceof Error ? error.message : String(error)}.`,
      code: aborted ? 'OPENAI_TIMEOUT' : 'OPENAI_REQUEST_FAILED',
    }
  }

  let parsedBody: unknown

  try {
    parsedBody = await response.json()
  } catch (error) {
    const aborted =
      controller.signal.aborted ||
      (error instanceof Error && error.name === 'AbortError')

    return {
      ok: false,
      model: request.model,
      httpStatus: response.status,
      error: aborted
        ? `Request to ${OPENAI_RESPONSES_URL} timed out after ${timeoutMs}ms.`
        : `Response from ${OPENAI_RESPONSES_URL} was not valid JSON (status ${response.status}).`,
      code: aborted ? 'OPENAI_TIMEOUT' : 'OPENAI_INVALID_RESPONSE',
    }
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    return {
      ok: false,
      model: request.model,
      httpStatus: response.status,
      raw: parsedBody,
      error:
        apiErrorMessage(parsedBody) ??
        `Request failed with HTTP status ${response.status}.`,
      code: 'OPENAI_HTTP_ERROR',
    }
  }

  if (!isRecord(parsedBody)) {
    return {
      ok: false,
      model: request.model,
      httpStatus: response.status,
      raw: parsedBody,
      error: 'Response body was valid JSON but not an object.',
      code: 'OPENAI_INVALID_RESPONSE',
    }
  }

  const responseError = apiErrorMessage(parsedBody)
  const responseStatus = parsedBody.status

  if (responseStatus === 'incomplete') {
    const reason = isRecord(parsedBody.incomplete_details)
      ? parsedBody.incomplete_details.reason
      : undefined

    return {
      ok: false,
      model: request.model,
      httpStatus: response.status,
      raw: parsedBody,
      error:
        'OpenAI returned an incomplete response' +
        (typeof reason === 'string' ? `: ${reason}.` : '.'),
      code: 'OPENAI_INCOMPLETE_RESPONSE',
    }
  }

  if (typeof responseStatus === 'string' && responseStatus !== 'completed') {
    return {
      ok: false,
      model: request.model,
      httpStatus: response.status,
      raw: parsedBody,
      error:
        responseError ?? `OpenAI returned response status '${responseStatus}'.`,
      code: 'OPENAI_RESPONSE_NOT_COMPLETED',
    }
  }

  if (responseError !== undefined) {
    return {
      ok: false,
      model: request.model,
      httpStatus: response.status,
      raw: parsedBody,
      error: responseError,
      code: 'OPENAI_RESPONSE_ERROR',
    }
  }

  const outputText = extractOutputText(parsedBody)
  const usage = extractUsage(parsedBody.usage)

  if (outputText === undefined) {
    return {
      ok: false,
      model: request.model,
      httpStatus: response.status,
      raw: parsedBody,
      error: 'OpenAI returned a successful response without output text.',
      code: 'OPENAI_NO_OUTPUT',
    }
  }

  return {
    ok: true,
    model:
      typeof parsedBody.model === 'string' ? parsedBody.model : request.model,
    httpStatus: response.status,
    ...(typeof parsedBody.id === 'string' ? { responseId: parsedBody.id } : {}),
    outputText,
    ...(usage !== undefined ? { usage } : {}),
    raw: parsedBody,
  }
}

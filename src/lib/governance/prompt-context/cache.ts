/** Cache boundaries at the final, opt-in OpenAI Responses transport. */

import { PanError } from '../../errors.js'
import { isRecord, sha256 } from '../../io.js'

export type PromptCacheTtl = '30m' | '12h'

interface TextBlock {
  message: Record<string, unknown>
  index: number
  part: Record<string, unknown>
  parts: unknown[]
  partIndex: number
}

export interface ReminderCacheEvidence {
  status:
    | 'configured'
    | 'unsupported_transport'
    | 'unsupported_model'
    | 'missing_developer_prefix'
    | 'disabled'
  model: string | null
  request_mode?: 'implicit'
  request_ttl?: PromptCacheTtl
  foundation_ttl?: PromptCacheTtl
  history_ttl?: PromptCacheTtl
  prefix_sha256?: string
  cache_hit: 'unverified'
}

/** Only GPT-5.6 and later have the Responses two-lifetime capability. */
export function supportsPromptCacheTtl(model: unknown): model is string {
  if (typeof model !== 'string') {
    return false
  }

  const version = /^gpt-(\d+)(?:\.(\d+))?(?:-[a-z0-9-]+)?$/u.exec(model)

  if (!version) {
    return false
  }

  const major = Number(version[1])
  const minor = Number(version[2] ?? '0')
  return major > 5 || (major === 5 && minor >= 6)
}

function validateCacheOptions(
  value: unknown,
  kind: 'request' | 'breakpoint' = 'request',
): void {
  if (value === undefined) {
    return
  }

  if (
    !isRecord(value) ||
    (value.ttl !== undefined && value.ttl !== '30m' && value.ttl !== '12h') ||
    (kind === 'breakpoint'
      ? value.mode !== 'explicit'
      : value.mode !== undefined &&
        value.mode !== 'explicit' &&
        value.mode !== 'implicit')
  ) {
    throw new PanError(
      kind === 'breakpoint'
        ? 'Cache breakpoints require explicit mode and a 30m or 12h TTL.'
        : 'Use a 30m or 12h TTL and an explicit or implicit cache mode.',
      {
        code: 'INVALID_PROMPT_CACHE_OPTIONS',
      },
    )
  }
}

function textBlocks(input: unknown[]): TextBlock[] {
  const blocks: TextBlock[] = []

  for (const [index, message] of input.entries()) {
    if (
      !isRecord(message) ||
      !['system', 'developer', 'user'].includes(String(message.role))
    ) {
      continue
    }

    const parts: unknown[] =
      typeof message.content === 'string'
        ? [{ type: 'input_text', text: message.content }]
        : Array.isArray(message.content)
          ? message.content
          : []

    for (const [partIndex, part] of parts.entries()) {
      if (
        isRecord(part) &&
        part.type === 'input_text' &&
        typeof part.text === 'string'
      ) {
        blocks.push({ message, index, part, parts, partIndex })
      }
    }
  }

  return blocks
}

function mark(block: TextBlock, ttl: PromptCacheTtl): void {
  block.part.prompt_cache_breakpoint = { mode: 'explicit', ttl }
  block.message.content = block.parts
}

/**
 * Keep roles and text in order, mark the initial developer prefix for 12 hours,
 * and retain implicit 30-minute caching of user messages and tool results.
 * Explicit-only mode would leave growing tool-loop history uncached.
 * The fingerprint describes local prefix bytes, never a confirmed cache write.
 */
export function applyReminderCache(
  value: Record<string, unknown>,
  route: string,
  enabled = true,
  foundations: readonly string[] = [],
): { request: Record<string, unknown>; evidence: ReminderCacheEvidence } {
  const request = structuredClone(value)
  const evidence: ReminderCacheEvidence = {
    status: 'disabled',
    model: supportsPromptCacheTtl(request.model) ? request.model : null,
    cache_hit: 'unverified',
  }

  if (!enabled) {
    return { request, evidence }
  }

  if (route !== '/v1/responses') {
    evidence.status = 'unsupported_transport'
    return { request, evidence }
  }

  if (!supportsPromptCacheTtl(request.model)) {
    evidence.status = 'unsupported_model'
    return { request, evidence }
  }

  validateCacheOptions(request.prompt_cache_options)
  const input: unknown[] = Array.isArray(request.input) ? request.input : []

  for (const message of input) {
    if (!isRecord(message) || !Array.isArray(message.content)) {
      continue
    }

    for (const part of message.content) {
      if (isRecord(part)) {
        validateCacheOptions(part.prompt_cache_breakpoint, 'breakpoint')
      }
    }
  }

  // Keep automatic user/tool-result writes and earlier message-end lookups.
  request.prompt_cache_options = {
    ...(isRecord(request.prompt_cache_options)
      ? request.prompt_cache_options
      : {}),
    mode: 'implicit',
    ttl: '30m',
  }
  evidence.request_mode = 'implicit'
  evidence.request_ttl = '30m'

  const firstNonDeveloper = input.findIndex(
    (message) =>
      !isRecord(message) ||
      !['system', 'developer'].includes(String(message.role)),
  )
  const prefixEnd = firstNonDeveloper === -1 ? input.length : firstNonDeveloper
  const blocks = textBlocks(input)
  const initial = blocks.filter((block) => block.index < prefixEnd)
  let foundation = initial.at(-1)

  // A registered reminder ends before fired clauses and other live hook text.
  for (const block of initial) {
    const text = String(block.part.text)
    const ends = foundations.flatMap((body) => {
      const start = text.indexOf(body)
      return start < 0 ? [] : [start + body.length]
    })

    if (ends.length === 0) {
      continue
    }

    const end = Math.max(...ends)

    if (end < text.length) {
      const tail: Record<string, unknown> = {
        ...block.part,
        text: text.slice(end),
      }
      delete tail.prompt_cache_breakpoint
      delete block.part.prompt_cache_breakpoint
      block.part.text = text.slice(0, end)
      block.parts.splice(block.partIndex + 1, 0, tail)
    }
    foundation = block
    break
  }

  if (!foundation) {
    evidence.status = 'missing_developer_prefix'
    return { request, evidence }
  }

  mark(foundation, '12h')
  const latestUser = input
    .map((message) => isRecord(message) && message.role === 'user')
    .lastIndexOf(true)
  const foundationIndex = foundation.index
  const history = blocks
    .filter(
      (block) => block.index > foundationIndex && block.index < latestUser,
    )
    .at(-1)

  if (history) {
    mark(history, '30m')
    evidence.history_ttl = '30m'
  }

  const prefix = input.slice(0, foundation.index + 1)
  prefix[foundation.index] = {
    ...foundation.message,
    content: foundation.parts.slice(0, foundation.partIndex + 1),
  }
  evidence.status = 'configured'
  evidence.request_ttl = '30m'
  evidence.foundation_ttl = '12h'
  evidence.prefix_sha256 = sha256({
    model: request.model,
    tools: request.tools,
    instructions: request.instructions,
    reasoning: request.reasoning,
    text: request.text,
    input: prefix,
  })
  return { request, evidence }
}

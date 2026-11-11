/** Bounded, content-free observation alongside unmodified OpenAI response bytes. */

import { StringDecoder } from 'node:string_decoder'

import { isRecord } from '../../io.js'
import {
  isResponseId,
  promptCacheDiagnostics,
  type PromptCacheDiagnostics,
} from './cache-diagnostics.js'

export interface PromptCacheUsage {
  response_id?: string
  input_tokens?: number
  cached_tokens?: number
  cache_write_tokens?: number
  ttl_30m_tokens?: number
  ttl_12h_tokens?: number
  ordinary_input_tokens?: number
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined
}

/** Select only numeric billing counters and a bounded provider response ID. */
export function promptCacheUsage(value: unknown): PromptCacheUsage | undefined {
  if (!isRecord(value) || !isRecord(value.usage)) {
    return undefined
  }

  const usage = value.usage
  const details = isRecord(usage.input_tokens_details)
    ? usage.input_tokens_details
    : {}
  const writes = isRecord(details.cache_write_tokens_details)
    ? details.cache_write_tokens_details
    : {}
  const result: PromptCacheUsage = {
    input_tokens: count(usage.input_tokens),
    cached_tokens: count(details.cached_tokens),
    cache_write_tokens: count(details.cache_write_tokens),
    ttl_30m_tokens: count(writes.ttl_30m_tokens),
    ttl_12h_tokens: count(writes.ttl_12h_tokens),
  }

  if (Object.values(result).every((value) => value === undefined)) {
    return undefined
  }

  if (
    typeof value.id === 'string' &&
    /^resp_[a-zA-Z0-9_-]{1,200}$/u.test(value.id)
  ) {
    result.response_id = value.id
  }

  if (
    result.input_tokens !== undefined &&
    result.cached_tokens !== undefined &&
    result.cache_write_tokens !== undefined
  ) {
    const ordinary =
      result.input_tokens - result.cached_tokens - result.cache_write_tokens

    if (ordinary >= 0) {
      result.ordinary_input_tokens = ordinary
    }
  }

  return result
}

/**
 * Parse JSON or SSE without modifying the forwarded stream. Incomplete, missing,
 * or oversized evidence stays unavailable, rather than becoming a zero-token hit.
 */
export class PromptCacheUsageObserver {
  private readonly decoder = new StringDecoder('utf8')
  private pending = ''
  private data = ''
  private discardedLine = false
  private discardedEvent = false
  private observed = false

  constructor(
    private readonly streaming: boolean,
    private readonly emit: (
      usage: PromptCacheUsage | undefined,
      diagnostics?: PromptCacheDiagnostics,
      completedResponseId?: string,
    ) => void,
    private readonly limit = 1024 * 1024,
  ) {}

  write(chunk: Buffer): void {
    const text = this.decoder.write(chunk)

    if (!this.streaming) {
      if (this.pending.length + text.length > this.limit) {
        this.discardedEvent = true
        this.pending = ''
      } else if (!this.discardedEvent) {
        this.pending += text
      }
      return
    }

    // Process lines incrementally, including an oversized event split over chunks.
    for (const part of text.split(/(?<=\n)/u)) {
      if (this.pending.length + part.length > this.limit) {
        this.discardedLine = true
        this.discardedEvent = true
        this.pending = ''
      }

      if (!this.discardedLine) {
        this.pending += part
      }

      if (!part.endsWith('\n')) {
        continue
      }

      const line = this.pending.replace(/\r?\n$/u, '')
      this.pending = ''

      if (this.discardedLine) {
        this.discardedLine = false
        continue
      }

      if (line === '') {
        if (!this.discardedEvent) {
          this.read(this.data)
        }
        this.data = ''
        this.discardedEvent = false
      } else if (line.startsWith('data:')) {
        this.data += `${line.slice(5).trimStart()}\n`

        if (this.data.length > this.limit) {
          this.data = ''
          this.discardedEvent = true
        }
      }
    }
  }

  finish(): void {
    if (!this.streaming && !this.discardedEvent) {
      this.read(this.pending + this.decoder.end())
    }

    if (!this.observed) {
      this.emit(undefined)
      this.observed = true
    }
  }

  private read(text: string): void {
    if (this.observed || text.trim() === '[DONE]' || !text.trim()) {
      return
    }

    let value: unknown

    try {
      value = JSON.parse(text)
    } catch {
      return // Response content and malformed events are never audit records.
    }

    const response =
      isRecord(value) &&
      ['response.completed', 'response.incomplete', 'response.failed'].includes(
        String(value.type),
      )
        ? value.response
        : this.streaming
          ? undefined
          : value
    const usage = promptCacheUsage(response)
    const diagnostics = promptCacheDiagnostics(response)
    const completed =
      isRecord(response) &&
      (this.streaming
        ? isRecord(value) && value.type === 'response.completed'
        : response.status === 'completed')
    const completedResponseId =
      completed && isRecord(response) && isResponseId(response.id)
        ? response.id
        : undefined

    if (usage || diagnostics || completedResponseId) {
      this.emit(usage, diagnostics, completedResponseId)
      this.observed = true
    }
  }
}

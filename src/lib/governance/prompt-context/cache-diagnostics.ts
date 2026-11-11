/** Content-free, bounded consecutive-response cache comparisons. */

import { isRecord, sha256 } from '../../io.js'

const TYPES = [
  'cache_hit',
  'cache_miss',
  'comparison_response_not_found',
  'unavailable',
] as const
const REASONS = [
  'model_changed',
  'prompt_cache_key_changed',
  'service_tier_changed',
  'tools_changed',
  'text_format_changed',
  'reasoning_effort_changed',
  'verbosity_changed',
  'context_compacted',
  'input_changed',
] as const

export interface PromptCacheDiagnostics {
  type: (typeof TYPES)[number]
  reason?: (typeof REASONS)[number]
  comparison_reusable_tokens?: number
  cache_missed_tokens?: number
}

export interface CacheComparison {
  conversation?: string
  sequence: number
  comparison_response_id?: string
}

export function isResponseId(value: unknown): value is string {
  return typeof value === 'string' && /^resp_[a-zA-Z0-9_-]{1,200}$/u.test(value)
}

/** Never retain arbitrary provider strings, prompts, or unknown diagnostic fields. */
export function promptCacheDiagnostics(
  value: unknown,
): PromptCacheDiagnostics | undefined {
  if (!isRecord(value) || !isRecord(value.prompt_cache_diagnostics)) {
    return undefined
  }

  const source = value.prompt_cache_diagnostics
  const type = TYPES.find((type) => type === source.type)

  if (!type) {
    return undefined
  }

  const result: PromptCacheDiagnostics = { type }
  const reason = REASONS.find((reason) => reason === source.reason)

  if (type === 'cache_miss' && reason) {
    result.reason = reason
  }

  for (const name of [
    'comparison_reusable_tokens',
    'cache_missed_tokens',
  ] as const) {
    const count = source[name]

    if (
      typeof count === 'number' &&
      Number.isSafeInteger(count) &&
      count >= 0
    ) {
      result[name] = count
    }
  }

  return result
}

/** In-memory baselines expire; comparisons never add a model request or replay content. */
export class PromptCacheComparisons {
  private readonly baselines = new Map<
    string,
    { id: string; at: number; sequence: number }
  >()
  private sequence = 0

  constructor(
    private readonly now: () => number = Date.now,
    private readonly limit = 128,
    private readonly lifetimeMs = 10 * 60 * 1000,
  ) {}

  prepare(
    request: Record<string, unknown>,
    partition: string,
  ): CacheComparison {
    const now = this.now()

    for (const [key, baseline] of this.baselines) {
      if (now - baseline.at >= this.lifetimeMs) {
        this.baselines.delete(key)
      }
    }

    const input: unknown[] = Array.isArray(request.input) ? request.input : []
    const firstUser = input.find(
      (item) => isRecord(item) && item.role === 'user',
    )
    const content = isRecord(firstUser)
      ? firstUser.content
      : typeof request.input === 'string'
        ? request.input
        : undefined
    const userIdentity =
      typeof content === 'string'
        ? [{ type: 'input_text', text: content }]
        : Array.isArray(content)
          ? content.map((part: unknown) => {
              if (!isRecord(part)) {
                return part
              }

              const normalized = { ...part }
              delete normalized.prompt_cache_breakpoint
              return normalized
            })
          : undefined
    const identity =
      request.conversation ?? request.prompt_cache_key ?? userIdentity
    const comparison: CacheComparison = { sequence: ++this.sequence }

    if (identity !== undefined) {
      comparison.conversation = sha256({ partition, identity })
    }

    const options = isRecord(request.prompt_cache_options)
      ? request.prompt_cache_options
      : {}
    const previous = comparison.conversation
      ? this.baselines.get(comparison.conversation)?.id
      : undefined
    const baseline =
      options.comparison_response_id ?? request.previous_response_id ?? previous

    // Caller comparisons, including intentional nulls, always take precedence.
    if (
      options.comparison_response_id === undefined &&
      isResponseId(baseline)
    ) {
      options.comparison_response_id = baseline
      request.prompt_cache_options = options
    }

    if (isResponseId(options.comparison_response_id)) {
      comparison.comparison_response_id = options.comparison_response_id
    }

    return comparison
  }

  complete(comparison: CacheComparison, id: unknown): void {
    if (!comparison.conversation || !isResponseId(id)) {
      return
    }

    const prior = this.baselines.get(comparison.conversation)

    if (prior && prior.sequence > comparison.sequence) {
      return
    }

    this.baselines.delete(comparison.conversation)
    this.baselines.set(comparison.conversation, {
      id,
      at: this.now(),
      sequence: comparison.sequence,
    })

    while (this.baselines.size > this.limit) {
      const oldest = this.baselines.keys().next().value

      if (oldest === undefined) {
        break
      }
      this.baselines.delete(oldest)
    }
  }
}

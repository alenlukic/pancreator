import { invariant } from '../errors.js'
import type { ParsedPersonaMapping } from './mapping.js'

const CURSOR_MODEL_BASES = new Set([
  'auto',
  'claude-fable-5',
  'claude-opus-5',
  'composer-2.5',
  'gpt-5.3-codex',
  'gpt-5.4',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'grok-4.5',
  'kimi-k3',
])

const CURSOR_EFFORTS = new Set(['low', 'medium', 'high'])

/** Resolve one Pancreator Cursor mapping to the executor-native model slug. */
export function resolveCursorModelSlug(
  mapping: ParsedPersonaMapping,
  source = 'persona mapping',
): string {
  invariant(
    mapping.executor === 'cursor',
    `${source} MUST use the cursor executor before model resolution.`,
    { code: 'INVALID_PIPELINE_CONFIG' },
  )
  invariant(
    CURSOR_MODEL_BASES.has(mapping.model),
    `${source} names Cursor model '${mapping.model}', which is not in the Cursor model catalog.`,
    { code: 'UNRESOLVED_CURSOR_MODEL' },
  )

  const effort = mapping.options.effort

  invariant(
    effort === undefined || CURSOR_EFFORTS.has(effort),
    `${source} effort '${effort}' is not supported. Supported values: low, medium, high.`,
    { code: 'UNRESOLVED_CURSOR_MODEL' },
  )

  if (mapping.model === 'auto') {
    invariant(
      Object.keys(mapping.options).length === 0,
      `${source} cannot apply Cursor options to model 'auto'.`,
      { code: 'UNRESOLVED_CURSOR_MODEL' },
    )

    return 'auto'
  }

  return effort ? `${mapping.model}-${effort}` : mapping.model
}

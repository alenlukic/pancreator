import { invariant } from '../errors.js'
import type { PersonaExecutorKind } from '../types.js'

/**
 * Closed set of persona executors. The seam is generic — one interface, one
 * registry — but only these two are registered; other CLIs are out of scope.
 */
export const PERSONA_EXECUTOR_KINDS: readonly PersonaExecutorKind[] = [
  'cursor',
  'claude-code',
]

export const DEFAULT_PERSONA_EXECUTOR: PersonaExecutorKind = 'cursor'

export interface ParsedPersonaMapping {
  /** The mapping string exactly as configured, executor prefix included. */
  raw: string
  executor: PersonaExecutorKind
  /** Model string without the executor prefix, bracket options included. */
  model_spec: string
  /** Model identifier without bracket options, e.g. `claude-opus-5`. */
  model: string
  /** Parsed bracket options, e.g. `{ 'permission-mode': 'default' }`. */
  options: Record<string, string>
}

const EXECUTOR_PREFIX_PATTERN = /^([a-z][a-z0-9-]*):(.*)$/u
const MODEL_SPEC_PATTERN = /^(?<model>[^[\]]+)(?:\[(?<options>[^\]]*)\])?$/u

const CLAUDE_CODE_PERMISSION_MODES = new Set([
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
])
const CLAUDE_CODE_OPTION_KEYS = new Set([
  'permission-mode',
  'session-resume',
  'timeout-ms',
])
const CURSOR_OPTION_KEYS = new Set(['context', 'effort', 'fast'])

/** Superseded Cursor option keys, mapped to the key that replaced them. */
const LEGACY_CURSOR_OPTION_ALIASES = new Map([['reasoning', 'effort']])

/** Superseded Cursor option keys that carry no current equivalent. */
const LEGACY_CURSOR_OPTION_DROPS = new Set(['thinking'])

function parseBracketOptions(
  optionsText: string | undefined,
  source: string,
): Record<string, string> {
  const options: Record<string, string> = {}

  if (!optionsText || optionsText.trim().length === 0) {
    return options
  }

  for (const entry of optionsText.split(',')) {
    const separator = entry.indexOf('=')

    invariant(
      separator > 0,
      `${source} option '${entry}' MUST use key=value syntax.`,
      { code: 'INVALID_PIPELINE_CONFIG' },
    )

    const key = entry.slice(0, separator).trim()
    const value = entry.slice(separator + 1).trim()

    invariant(
      key.length > 0 && value.length > 0,
      `${source} option '${entry}' MUST use key=value syntax.`,
      { code: 'INVALID_PIPELINE_CONFIG' },
    )

    // A repeated key has no defined winner: rejecting it keeps parse and
    // canonicalization from resolving the same spec to different models.
    invariant(!(key in options), `${source} option '${key}' MUST NOT repeat.`, {
      code: 'INVALID_PIPELINE_CONFIG',
    })

    options[key] = value
  }

  return options
}

function validateClaudeCodeOptions(
  options: Record<string, string>,
  source: string,
): void {
  for (const [key, value] of Object.entries(options)) {
    invariant(
      CLAUDE_CODE_OPTION_KEYS.has(key),
      `${source} uses unknown claude-code option '${key}'. ` +
        `Supported options: ${[...CLAUDE_CODE_OPTION_KEYS].join(', ')}.`,
      { code: 'INVALID_PIPELINE_CONFIG' },
    )

    if (key === 'permission-mode') {
      invariant(
        CLAUDE_CODE_PERMISSION_MODES.has(value),
        `${source} permission-mode '${value}' is not supported. ` +
          `Supported modes: ${[...CLAUDE_CODE_PERMISSION_MODES].join(', ')}.`,
        { code: 'INVALID_PIPELINE_CONFIG' },
      )
    }

    if (key === 'session-resume') {
      invariant(
        value === 'true' || value === 'false',
        `${source} session-resume MUST be true or false.`,
        { code: 'INVALID_PIPELINE_CONFIG' },
      )
    }

    if (key === 'timeout-ms') {
      const parsed = Number(value)

      invariant(
        Number.isInteger(parsed) && parsed >= 1_000,
        `${source} timeout-ms MUST be an integer of at least 1000.`,
        { code: 'INVALID_PIPELINE_CONFIG' },
      )
    }
  }
}

function validateCursorOptions(
  options: Record<string, string>,
  source: string,
): void {
  for (const [key, value] of Object.entries(options)) {
    invariant(
      CURSOR_OPTION_KEYS.has(key),
      key === 'reasoning'
        ? `${source} uses obsolete Cursor option 'reasoning'. Use 'effort' instead.`
        : key === 'thinking'
          ? `${source} uses obsolete Cursor option 'thinking'. Remove it; no current option replaces it.`
          : `${source} uses unknown Cursor option '${key}'. Supported options: context, effort, fast.`,
      { code: 'INVALID_PIPELINE_CONFIG' },
    )

    if (key === 'context') {
      invariant(
        /^\d+k$/u.test(value),
        `${source} context MUST use a positive '<kilotokens>k' value.`,
        { code: 'INVALID_PIPELINE_CONFIG' },
      )
    } else if (key === 'fast') {
      invariant(
        value === 'true' || value === 'false',
        `${source} fast MUST be true or false.`,
        { code: 'INVALID_PIPELINE_CONFIG' },
      )
    } else if (key === 'effort') {
      invariant(
        value === 'low' || value === 'medium' || value === 'high',
        `${source} effort MUST be low, medium, or high.`,
        { code: 'INVALID_PIPELINE_CONFIG' },
      )
    }
  }
}

/**
 * Parse one persona mapping string into its executor, model, and options.
 *
 * The executor prefix is optional and defaults to `cursor`, so every existing
 * configuration parses unchanged. The harness validates Cursor options before
 * projection and validates claude-code options before delegation.
 */
export function parsePersonaMapping(
  raw: string,
  source = 'persona mapping',
): ParsedPersonaMapping {
  invariant(raw.length > 0, `${source} MUST be a non-empty model string.`, {
    code: 'INVALID_PIPELINE_CONFIG',
  })

  const prefixMatch = EXECUTOR_PREFIX_PATTERN.exec(raw)
  let executor: PersonaExecutorKind = DEFAULT_PERSONA_EXECUTOR
  let modelSpec = raw

  if (prefixMatch) {
    const prefix = prefixMatch[1]

    invariant(
      PERSONA_EXECUTOR_KINDS.includes(prefix as PersonaExecutorKind),
      `${source} names unknown executor '${prefix}'. ` +
        `Supported executors: ${PERSONA_EXECUTOR_KINDS.join(', ')}.`,
      { code: 'INVALID_PIPELINE_CONFIG' },
    )

    executor = prefix as PersonaExecutorKind
    modelSpec = prefixMatch[2]
  }

  const specMatch = MODEL_SPEC_PATTERN.exec(modelSpec)

  invariant(
    specMatch?.groups?.model !== undefined &&
      specMatch.groups.model.trim().length > 0,
    `${source} MUST name a model, optionally followed by [key=value,...] options.`,
    { code: 'INVALID_PIPELINE_CONFIG' },
  )

  const model = specMatch.groups.model.trim()
  const options = parseBracketOptions(specMatch.groups.options, source)

  if (executor === 'claude-code') {
    validateClaudeCodeOptions(options, source)
  } else {
    validateCursorOptions(options, source)
  }

  return {
    raw,
    executor,
    model_spec: modelSpec,
    model,
    options,
  }
}

/**
 * Comparable form of a mapping string, tolerant of superseded option grammar.
 *
 * A run's pipeline snapshot keeps the exact text it was created with, so a later
 * option-grammar change would otherwise make an in-flight run permanently
 * undeliverable: the snapshot cannot be edited, and restoring the retired
 * spelling in `config.json` fails current validation. Comparison therefore
 * normalizes both sides instead of matching raw text. Authoring surfaces keep
 * using `parsePersonaMapping`, which still rejects a retired key outright.
 */
export function canonicalPersonaMapping(raw: string): string {
  const trimmed = raw.trim()
  const prefixMatch = EXECUTOR_PREFIX_PATTERN.exec(trimmed)
  let executor: PersonaExecutorKind = DEFAULT_PERSONA_EXECUTOR
  let modelSpec = trimmed

  if (
    prefixMatch &&
    PERSONA_EXECUTOR_KINDS.includes(prefixMatch[1] as PersonaExecutorKind)
  ) {
    executor = prefixMatch[1] as PersonaExecutorKind
    modelSpec = prefixMatch[2]
  }

  const specMatch = MODEL_SPEC_PATTERN.exec(modelSpec)

  if (
    specMatch?.groups?.model === undefined ||
    specMatch.groups.model.trim().length === 0
  ) {
    return `${executor}:${modelSpec.trim()}`
  }

  const model = specMatch.groups.model.trim()
  const parsed = new Map<string, string>()
  const optionsText = specMatch.groups.options

  if (optionsText !== undefined && optionsText.trim().length > 0) {
    for (const entry of optionsText.split(',')) {
      const separator = entry.indexOf('=')

      if (separator <= 0) {
        continue
      }

      const key = entry.slice(0, separator).trim()
      const value = entry.slice(separator + 1).trim()

      if (key.length > 0 && value.length > 0 && !parsed.has(key)) {
        parsed.set(key, value)
      }
    }
  }

  const options = new Map<string, string>()

  for (const [key, value] of parsed) {
    if (executor !== 'cursor') {
      options.set(key, value)
      continue
    }

    if (LEGACY_CURSOR_OPTION_DROPS.has(key)) {
      continue
    }

    const canonicalKey = LEGACY_CURSOR_OPTION_ALIASES.get(key) ?? key

    // A current key always wins over the retired key that aliases onto it.
    if (canonicalKey !== key && parsed.has(canonicalKey)) {
      continue
    }

    options.set(canonicalKey, value)
  }

  const rendered = [...options.keys()]
    .sort()
    .map((key) => `${key}=${options.get(key)}`)
    .join(',')

  return rendered.length > 0
    ? `${executor}:${model}[${rendered}]`
    : `${executor}:${model}`
}

/** Executor a raw mapping string resolves to, without full validation. */
export function personaExecutorOf(raw: string): PersonaExecutorKind {
  const prefixMatch = EXECUTOR_PREFIX_PATTERN.exec(raw)

  if (
    prefixMatch &&
    PERSONA_EXECUTOR_KINDS.includes(prefixMatch[1] as PersonaExecutorKind)
  ) {
    return prefixMatch[1] as PersonaExecutorKind
  }

  return DEFAULT_PERSONA_EXECUTOR
}

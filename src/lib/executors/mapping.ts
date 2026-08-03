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

/**
 * Parse one persona mapping string into its executor, model, and options.
 *
 * The executor prefix is optional and defaults to `cursor`, so every existing
 * configuration parses unchanged. Cursor bracket options stay opaque — Cursor
 * consumes them — while claude-code options are validated here because the
 * harness itself consumes them at delegation time.
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
  }

  return {
    raw,
    executor,
    model_spec: modelSpec,
    model,
    options,
  }
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

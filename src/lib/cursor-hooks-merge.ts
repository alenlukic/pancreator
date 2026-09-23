import { isRecord } from './io.js'
import { errorMessage, invariant, PanError } from './errors.js'

export const PANCREATOR_HOOK_COMMAND_MARKER = 'pan-hook-'

interface CursorHooksDocument {
  version?: unknown
  hooks: Record<string, unknown[]>
  [key: string]: unknown
}

function cursorHooksDocument(
  value: unknown,
  label: string,
): CursorHooksDocument {
  invariant(isRecord(value), `${label} MUST contain a JSON object.`, {
    code: 'INVALID_CURSOR_HOOKS',
  })

  const hooks = value.hooks ?? {}

  invariant(isRecord(hooks), `${label}.hooks MUST contain a JSON object.`, {
    code: 'INVALID_CURSOR_HOOKS',
  })

  const normalizedHooks: Record<string, unknown[]> = {}

  for (const [event, entries] of Object.entries(hooks)) {
    invariant(
      Array.isArray(entries),
      `${label}.hooks.${event} MUST contain an array.`,
      { code: 'INVALID_CURSOR_HOOKS' },
    )
    normalizedHooks[event] = entries
  }

  return { ...value, hooks: normalizedHooks }
}

function isPancreatorHookEntry(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.command === 'string' &&
    value.command.includes(PANCREATOR_HOOK_COMMAND_MARKER)
  )
}

/**
 * Replace Pancreator-owned hooks while retaining every target-owned field,
 * event, and entry.
 */
export function mergeCursorHooks(
  existingValue: unknown,
  pancreatorValue: unknown,
  existingLabel = 'Existing hooks file',
): CursorHooksDocument {
  const existing = cursorHooksDocument(existingValue, existingLabel)
  const pancreator = cursorHooksDocument(
    pancreatorValue,
    'Pancreator hooks source',
  )
  const hooks = Object.fromEntries(
    Object.entries(existing.hooks).map(([event, entries]) => [
      event,
      entries.filter((entry) => !isPancreatorHookEntry(entry)),
    ]),
  )

  for (const [event, entries] of Object.entries(pancreator.hooks)) {
    hooks[event] = [
      ...(hooks[event] ?? []),
      ...entries.filter((entry) => !isPancreatorHookEntry(entry)),
      ...entries.filter(isPancreatorHookEntry),
    ]
  }

  return {
    ...pancreator,
    ...existing,
    hooks,
  }
}

function parseCursorHooksText(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new PanError(`${label} is not valid JSON: ${errorMessage(error)}`, {
      code: 'INVALID_CURSOR_HOOKS',
    })
  }
}

/**
 * Parse, merge, and serialize a Cursor hooks file deterministically. An
 * existing file that is absent or holds only whitespace carries no target
 * state, so it merges as an empty document.
 */
export function mergeCursorHooksText(
  existingText: string | null,
  pancreatorText: string,
  existingLabel = 'Existing hooks file',
): string {
  const existingValue: unknown =
    existingText === null || existingText.trim().length === 0
      ? {}
      : parseCursorHooksText(existingText, existingLabel)
  const pancreatorValue: unknown = parseCursorHooksText(
    pancreatorText,
    'Pancreator hooks source',
  )

  return `${JSON.stringify(
    mergeCursorHooks(existingValue, pancreatorValue, existingLabel),
    null,
    2,
  )}\n`
}

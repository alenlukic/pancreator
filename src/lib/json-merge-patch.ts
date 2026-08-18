import { isRecord } from './io.js'

/**
 * Apply an RFC 7386 JSON merge patch: objects merge recursively, `null`
 * deletes the key, and every other value — arrays included — replaces the
 * target wholesale.
 *
 * This is the revision format for stage outputs. A retry that fixes two
 * sentences in a 20 KB document patches those fields instead of re-emitting
 * the whole artifact; the harness applies the patch and validates the merged
 * document exactly as it would a full submission.
 */
export function applyJsonMergePatch(target: unknown, patch: unknown): unknown {
  if (!isRecord(patch)) {
    return structuredClone(patch)
  }

  const merged: Record<string, unknown> = isRecord(target) ? { ...target } : {}

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete merged[key]
      continue
    }

    merged[key] = applyJsonMergePatch(merged[key], value)
  }

  return merged
}

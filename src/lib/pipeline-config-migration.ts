import { invariant } from './errors.js'
import { isRecord } from './io.js'
import { mergeConfigValues } from './project-config.js'

/** One persona mapping the migration carried forward into the overrides. */
export interface PreservedPersonaMapping {
  /** Overrides location, `defaults` or `configs.<name>.personas`. */
  location: string
  persona: string
  model: string
}

export interface PipelineOverridesMigration {
  /** The overrides object after preservation. Unchanged when nothing moved. */
  overrides: Record<string, unknown>
  preserved: PreservedPersonaMapping[]
  /** `<location>.<persona>` entries still empty after preservation. */
  missing: string[]
  changed: boolean
}

interface PersonaLocation {
  /** Dotted location, `defaults` or `configs.<name>.personas`. */
  location: string
  /** Path segments from the file root to the persona map. */
  segments: string[]
}

function personaLocations(file: Record<string, unknown>): PersonaLocation[] {
  const locations: PersonaLocation[] = [
    { location: 'defaults', segments: ['defaults'] },
  ]
  const configs = isRecord(file.configs) ? file.configs : {}

  for (const name of Object.keys(configs).sort()) {
    locations.push({
      location: `configs.${name}.personas`,
      segments: ['configs', name, 'personas'],
    })
  }

  return locations
}

function personaMapAt(
  file: Record<string, unknown>,
  segments: string[],
): Record<string, unknown> {
  let current: unknown = file

  for (const segment of segments) {
    if (!isRecord(current)) {
      return {}
    }

    current = current[segment]
  }

  return isRecord(current) ? current : {}
}

function ensurePersonaMapAt(
  overrides: Record<string, unknown>,
  segments: string[],
): Record<string, unknown> {
  let current = overrides

  for (const segment of segments) {
    if (!isRecord(current[segment])) {
      current[segment] = {}
    }

    current = current[segment] as Record<string, unknown>
  }

  return current
}

function isEmptyMapping(value: unknown): boolean {
  return typeof value !== 'string' || value.length === 0
}

/**
 * Carry a pre-change effective model map across a tracked `config.json`
 * replacement.
 *
 * The new tracked file owns the shape. For every persona whose merged new
 * value is empty, the migration preserves the merged old value at the same
 * location into the operator overrides. A persona that stays empty after
 * preservation is reported in `missing`, and the caller MUST NOT apply the
 * replacement — the pre-change effective map is unrecoverable for it, so
 * proceeding would strand the configuration exactly the way an incomplete
 * hand-copy does.
 *
 * The migration is deterministic and does not validate model grammar: grammar
 * belongs to `parsePipelineConfig`, which the caller runs on the merged result
 * before any file mutation.
 */
export function migratePipelineOverrides(options: {
  previous: unknown
  next: unknown
  overrides: unknown
}): PipelineOverridesMigration {
  invariant(isRecord(options.next), 'The new config.json MUST be an object.', {
    code: 'INVALID_PIPELINE_CONFIG',
  })
  invariant(
    isRecord(options.previous),
    'The previous config.json MUST be an object.',
    { code: 'INVALID_PIPELINE_CONFIG' },
  )
  invariant(
    options.overrides === null ||
      options.overrides === undefined ||
      isRecord(options.overrides),
    'The overrides file MUST contain an object when present.',
    { code: 'INVALID_PIPELINE_CONFIG' },
  )

  const overrides = structuredClone(
    isRecord(options.overrides) ? options.overrides : {},
  )
  const previousMerged = mergeConfigValues(options.previous, overrides)
  const preserved: PreservedPersonaMapping[] = []
  const missing: string[] = []

  invariant(
    isRecord(previousMerged),
    'The previous effective configuration MUST be an object.',
    { code: 'INVALID_PIPELINE_CONFIG' },
  )

  for (const { location, segments } of personaLocations(options.next)) {
    const nextMap = personaMapAt(options.next, segments)
    const overrideMap = personaMapAt(overrides, segments)
    const previousMap = personaMapAt(previousMerged, segments)

    for (const persona of Object.keys(nextMap).sort()) {
      if (!isEmptyMapping(nextMap[persona]) || persona in overrideMap) {
        continue
      }

      const candidate = previousMap[persona]

      if (isEmptyMapping(candidate)) {
        missing.push(`${location}.${persona}`)
        continue
      }

      ensurePersonaMapAt(overrides, segments)[persona] = candidate
      preserved.push({ location, persona, model: candidate as string })
    }
  }

  // Preservation can only fill holes the previous map covered. Anything still
  // empty in the re-merged result — including an empty override the operator
  // wrote by hand — fails the migration before any mutation.
  const nextMerged = mergeConfigValues(options.next, overrides)

  if (isRecord(nextMerged)) {
    for (const { location, segments } of personaLocations(nextMerged)) {
      const map = personaMapAt(nextMerged, segments)

      for (const persona of Object.keys(map).sort()) {
        const entry = `${location}.${persona}`

        if (isEmptyMapping(map[persona]) && !missing.includes(entry)) {
          missing.push(entry)
        }
      }
    }
  }

  return {
    overrides,
    preserved,
    missing: missing.sort(),
    changed: preserved.length > 0,
  }
}

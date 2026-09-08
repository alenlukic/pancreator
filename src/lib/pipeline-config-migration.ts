import { invariant } from './errors.js'
import { isRecord } from './io.js'
import { mergeConfigValues } from './project-config.js'

/** One persona mapping the migration carried forward into the overrides. */
export interface PreservedPersonaMapping {
  /** Overrides location, `defaults` or `configs.<name>`. */
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
  /** Dotted location, `defaults` or `configs.<name>`. */
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
      location: `configs.${name}`,
      segments: ['configs', name],
    })
  }

  return locations
}

function personaMapFromNamedConfig(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {}
  }

  const direct: Record<string, unknown> = {}

  for (const [key, entry] of Object.entries(value)) {
    if (key === 'summary' || key === 'personas') {
      continue
    }

    direct[key] = entry
  }

  const legacy = isRecord(value.personas) ? value.personas : {}

  return { ...direct, ...legacy }
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

  if (segments.length === 1 && segments[0] === 'defaults') {
    return isRecord(current) ? current : {}
  }

  return personaMapFromNamedConfig(current)
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

function normalizeLegacyOverrides(overrides: Record<string, unknown>): void {
  const configs = overrides.configs

  if (!isRecord(configs)) {
    return
  }

  for (const [name, config] of Object.entries(configs)) {
    if (!isRecord(config)) {
      continue
    }

    const legacy = config.personas

    if (!isRecord(legacy)) {
      continue
    }

    for (const [persona, model] of Object.entries(legacy)) {
      config[persona] = model
    }

    delete config.personas
    configs[name] = config
  }

  overrides.configs = configs
}

function isEmptyMapping(value: unknown): boolean {
  return typeof value !== 'string' || value.length === 0
}

/**
 * An empty slot in a named config inherits the default for that persona, so
 * it is a hole only when the merged `defaults` map leaves it empty too.
 */
function inheritsDefault(
  merged: Record<string, unknown>,
  location: string,
  persona: string,
): boolean {
  return (
    location !== 'defaults' &&
    !isEmptyMapping(personaMapAt(merged, ['defaults'])[persona])
  )
}

/**
 * Carry a pre-change effective model map across a tracked `config.json`
 * replacement.
 *
 * The new tracked file owns the shape. For every persona whose merged new
 * value is empty, the migration preserves the merged old value at the same
 * location into the operator overrides. A persona that stays empty after
 * preservation, and that `defaults` does not fill, is reported in `missing`,
 * and the caller MUST NOT apply the
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
  normalizeLegacyOverrides(overrides)
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
        const nextMerged = mergeConfigValues(options.next, overrides)

        invariant(
          isRecord(nextMerged),
          'The new effective configuration MUST be an object.',
          { code: 'INVALID_PIPELINE_CONFIG' },
        )

        if (!inheritsDefault(nextMerged, location, persona)) {
          missing.push(`${location}.${persona}`)
        }
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

        if (
          isEmptyMapping(map[persona]) &&
          !inheritsDefault(nextMerged, location, persona) &&
          !missing.includes(entry)
        ) {
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

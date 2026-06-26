import path from 'node:path'

import { invariant } from '../errors.js'
import { isRecord, readJson } from '../io.js'
import type { RegistryEntry } from './types.js'

export interface RegistryCatalog {
  schema_version: 1
  entries: Map<string, RegistryEntry>
  hash: string
}

const registryCache = new Map<string, RegistryCatalog>()

/** Clear the in-process registry cache (primarily for tests). */
export function clearRegistryCache(): void {
  registryCache.clear()
}

const VALID_KINDS = new Set(['automation', 'validator'])

function parseEntry(value: unknown, source: string): RegistryEntry {
  invariant(isRecord(value), `${source}: entry MUST be an object.`, {
    code: 'INVALID_REGISTRY',
  })
  invariant(
    typeof value.id === 'string' && value.id.length > 0,
    `${source}: id MUST be a non-empty string.`,
    { code: 'INVALID_REGISTRY' },
  )
  invariant(
    VALID_KINDS.has(String(value.kind)),
    `${source}: kind MUST be automation or validator.`,
    { code: 'INVALID_REGISTRY' },
  )
  invariant(
    typeof value.version === 'string' && value.version.length > 0,
    `${source}: version MUST be a non-empty string.`,
    { code: 'INVALID_REGISTRY' },
  )
  invariant(
    typeof value.handler === 'string' && value.handler.length > 0,
    `${source}: handler MUST be a non-empty string.`,
    { code: 'INVALID_REGISTRY' },
  )
  invariant(
    typeof value.result_schema === 'string',
    `${source}: result_schema MUST be a string.`,
    { code: 'INVALID_REGISTRY' },
  )
  invariant(
    Array.isArray(value.target_types) &&
      value.target_types.every((item) => typeof item === 'string'),
    `${source}: target_types MUST be a string array.`,
    { code: 'INVALID_REGISTRY' },
  )
  invariant(
    typeof value.default_timeout_ms === 'number' &&
      value.default_timeout_ms > 0,
    `${source}: default_timeout_ms MUST be a positive number.`,
    { code: 'INVALID_REGISTRY' },
  )
  invariant(
    typeof value.deterministic === 'boolean',
    `${source}: deterministic MUST be a boolean.`,
    { code: 'INVALID_REGISTRY' },
  )
  invariant(
    typeof value.side_effect_free === 'boolean',
    `${source}: side_effect_free MUST be a boolean.`,
    { code: 'INVALID_REGISTRY' },
  )

  return {
    id: value.id,
    kind: value.kind as RegistryEntry['kind'],
    version: value.version,
    handler: value.handler,
    input_contract:
      typeof value.input_contract === 'string' ? value.input_contract : '',
    result_schema: value.result_schema,
    target_types: value.target_types as string[],
    default_timeout_ms: value.default_timeout_ms,
    deterministic: value.deterministic,
    side_effect_free: value.side_effect_free,
  }
}

/** Load the canonical validation registry from governance/validation_registry.json. */
export function loadRegistry(root: string): RegistryCatalog {
  const cached = registryCache.get(root)

  if (cached) {
    return cached
  }

  const source = 'governance/validation_registry.json'
  const value = readJson(path.join(root, source))

  invariant(isRecord(value), `${source} MUST contain an object.`, {
    code: 'INVALID_REGISTRY',
  })
  invariant(value.schema_version === 1, `${source} schema_version MUST be 1.`, {
    code: 'INVALID_REGISTRY',
  })
  invariant(Array.isArray(value.entries), `${source} MUST contain entries[].`, {
    code: 'INVALID_REGISTRY',
  })

  const entries = new Map<string, RegistryEntry>()

  for (const [index, entry] of value.entries.entries()) {
    const parsed = parseEntry(entry, `${source}:entries[${index}]`)

    invariant(!entries.has(parsed.id), `Duplicate registry id: ${parsed.id}`, {
      code: 'DUPLICATE_REGISTRY_ID',
    })

    entries.set(parsed.id, parsed)
  }

  const catalog: RegistryCatalog = {
    schema_version: 1,
    entries,
    hash: [...entries.keys()].sort().join(','),
  }

  registryCache.set(root, catalog)

  return catalog
}

export function validateRegistry(
  catalog: RegistryCatalog,
  knownHandlers: Set<string>,
): string[] {
  const errors: string[] = []
  const referencedHandlers = new Set<string>()

  for (const entry of catalog.entries.values()) {
    referencedHandlers.add(entry.handler)

    if (!knownHandlers.has(entry.handler)) {
      errors.push(
        `registry entry ${entry.id} references unknown handler: ${entry.handler}`,
      )
    }

    if (entry.kind === 'validator' && !entry.side_effect_free) {
      errors.push(`validator ${entry.id} MUST declare side_effect_free: true`)
    }
  }

  for (const handler of knownHandlers) {
    if (!referencedHandlers.has(handler)) {
      errors.push(
        `handler '${handler}' is registered but not referenced by any registry entry`,
      )
    }
  }

  return errors
}

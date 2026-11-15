import { isRecord } from './io.js'

/** One named signature in an interface schema or a claimed skeleton. */
export interface NamedSignature {
  name: string
  signature: string
}

/** Parsed schema file: named interfaces plus usage notes. */
export interface InterfaceSchema {
  interfaces: NamedSignature[]
  notes: string
}

/** One mismatch between claimed signatures and a schema file. */
export interface InterfaceDrift {
  name: string
  kind: 'missing_in_schema' | 'missing_in_claimed' | 'signature'
  schemaSignature?: string
  claimedSignature?: string
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Reads `{ interfaces: [{ name, signature }], notes }` from a schema file
 * body. Returns an error string when the body is not that shape.
 */
export function parseInterfaceSchema(
  value: unknown,
): { schema: InterfaceSchema } | { error: string } {
  if (!isRecord(value)) {
    return { error: 'Interface schema MUST be an object' }
  }

  if (!nonEmptyString(value.notes)) {
    return { error: 'Interface schema notes MUST be a non-empty string' }
  }

  if (!Array.isArray(value.interfaces) || value.interfaces.length === 0) {
    return {
      error: 'Interface schema interfaces MUST be a non-empty array',
    }
  }

  const interfaces: NamedSignature[] = []
  const seen = new Set<string>()

  for (const [index, entry] of value.interfaces.entries()) {
    if (!isRecord(entry) || !nonEmptyString(entry.name)) {
      return {
        error: `interfaces[${index}].name MUST be a non-empty string`,
      }
    }

    if (!nonEmptyString(entry.signature)) {
      return {
        error: `interfaces[${index}].signature MUST be a non-empty string`,
      }
    }

    if (seen.has(entry.name)) {
      return { error: `interfaces repeats name ${entry.name}` }
    }

    seen.add(entry.name)
    interfaces.push({ name: entry.name, signature: entry.signature })
  }

  return { schema: { interfaces, notes: value.notes } }
}

/**
 * Drift between claimed signatures and a schema. Empty when names and
 * signatures match. A missing schema interface, a claimed name the schema
 * does not carry, and a signature mismatch are each one finding.
 */
export function findInterfaceDrift(
  schema: readonly NamedSignature[],
  claimed: readonly NamedSignature[],
): InterfaceDrift[] {
  const schemaByName = new Map(
    schema.map((entry) => [entry.name, entry.signature]),
  )
  const claimedByName = new Map(
    claimed.map((entry) => [entry.name, entry.signature]),
  )
  const names = new Set([...schemaByName.keys(), ...claimedByName.keys()])
  const findings: InterfaceDrift[] = []

  for (const name of names) {
    const schemaSignature = schemaByName.get(name)
    const claimedSignature = claimedByName.get(name)

    if (schemaSignature === undefined) {
      findings.push({
        name,
        kind: 'missing_in_schema',
        claimedSignature,
      })
      continue
    }

    if (claimedSignature === undefined) {
      findings.push({
        name,
        kind: 'missing_in_claimed',
        schemaSignature,
      })
      continue
    }

    if (schemaSignature !== claimedSignature) {
      findings.push({
        name,
        kind: 'signature',
        schemaSignature,
        claimedSignature,
      })
    }
  }

  return findings
}

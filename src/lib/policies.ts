import { readdirSync } from 'node:fs'
import path from 'node:path'

import { invariant } from './errors.js'
import { isRecord, readJson } from './io.js'
import type {
  Policy,
  PolicyLookupRow,
  PolicyLookupTable,
  PolicyRequirement,
} from './types.js'
import { isValidPolicyRequirement } from './requirements/types.js'

interface PolicyContext {
  persona: string
  workflow: string
  stage: string
}

function matches(pattern: string, value: string): boolean {
  return pattern === '*' || pattern === value
}

function parsePolicy(value: unknown, source: string): Policy {
  invariant(isRecord(value), `${source}: policy MUST be an object.`, {
    code: 'INVALID_POLICY',
  })
  invariant(
    typeof value.id === 'string' && value.id.length > 0,
    `${source}: policy id MUST be a non-empty string.`,
    { code: 'INVALID_POLICY' },
  )
  invariant(
    typeof value.title === 'string' && value.title.length > 0,
    `${source}: policy title MUST be a non-empty string.`,
    { code: 'INVALID_POLICY' },
  )
  invariant(
    value.severity === 'hard' || value.severity === 'soft',
    `${source}: policy severity MUST be hard or soft.`,
    { code: 'INVALID_POLICY' },
  )
  invariant(
    typeof value.summary === 'string' && value.summary.length > 0,
    `${source}: policy summary MUST be a non-empty string.`,
    { code: 'INVALID_POLICY' },
  )
  invariant(
    Array.isArray(value.instructions) &&
      value.instructions.every((item) => typeof item === 'string'),
    `${source}: policy instructions MUST be a string array.`,
    { code: 'INVALID_POLICY' },
  )

  let requirements: PolicyRequirement[] | undefined

  if (value.requirements !== undefined) {
    invariant(
      Array.isArray(value.requirements),
      `${source}: requirements MUST be an array when present.`,
      { code: 'INVALID_POLICY' },
    )

    requirements = []

    for (const [index, item] of value.requirements.entries()) {
      invariant(
        isValidPolicyRequirement(item),
        `${source}: requirements[${index}] is invalid.`,
        { code: 'INVALID_POLICY' },
      )
      requirements.push(item)
    }
  }

  return {
    ...(value as unknown as Policy),
    requirements,
  }
}

function parseLookupRow(value: unknown, source: string): PolicyLookupRow {
  invariant(isRecord(value), `${source}: row MUST be an object.`, {
    code: 'INVALID_POLICY_LOOKUP',
  })

  for (const key of ['persona', 'workflow', 'stage'] as const) {
    invariant(
      typeof value[key] === 'string' && value[key].length > 0,
      `${source}: ${key} MUST be a non-empty string.`,
      { code: 'INVALID_POLICY_LOOKUP' },
    )
  }

  invariant(
    Array.isArray(value.policies) &&
      value.policies.every((item) => typeof item === 'string'),
    `${source}: policies MUST be a string array.`,
    { code: 'INVALID_POLICY_LOOKUP' },
  )

  return value as unknown as PolicyLookupRow
}

function loadLookupTable(root: string): PolicyLookupTable {
  const source = 'governance/registries/policy_lookup_table.json'
  const value = readJson(path.join(root, source))

  invariant(isRecord(value), `${source} MUST contain an object.`, {
    code: 'INVALID_POLICY_LOOKUP',
  })
  invariant(value.schema_version === 1, `${source} schema_version MUST be 1.`, {
    code: 'INVALID_POLICY_LOOKUP',
  })
  invariant(Array.isArray(value.rows), `${source} MUST contain rows[].`, {
    code: 'INVALID_POLICY_LOOKUP',
  })

  return {
    schema_version: 1,
    rows: value.rows.map((row, index) =>
      parseLookupRow(row, `${source}:rows[${index}]`),
    ),
  }
}

/** Load every policy JSON under governance/policies, keyed by unique id. */
export function loadPolicyCatalog(root: string): Map<string, Policy> {
  const dir = path.join(root, 'governance', 'policies')
  const catalog = new Map<string, Policy>()
  const names = readdirSync(dir)
    .filter((entry) => entry.endsWith('.json'))
    .sort()

  for (const name of names) {
    const policy = parsePolicy(readJson(path.join(dir, name)), name)

    invariant(!catalog.has(policy.id), `Duplicate policy id: ${policy.id}`, {
      code: 'DUPLICATE_POLICY',
    })

    catalog.set(policy.id, policy)
  }

  return catalog
}

/**
 * Resolve the policies for one invocation context by unioning every matching
 * lookup row and returning the policy objects sorted by id.
 */
export function resolvePolicies(
  root: string,
  context: PolicyContext,
): Policy[] {
  const lookup = loadLookupTable(root)
  const catalog = loadPolicyCatalog(root)
  const policyIds = new Set<string>()

  for (const row of lookup.rows) {
    const applies =
      matches(row.persona, context.persona) &&
      matches(row.workflow, context.workflow) &&
      matches(row.stage, context.stage)

    if (!applies) {
      continue
    }

    for (const policyId of row.policies) {
      policyIds.add(policyId)
    }
  }

  return [...policyIds].sort().map((policyId) => {
    const policy = catalog.get(policyId)

    invariant(policy, `Policy lookup references missing policy: ${policyId}`, {
      code: 'MISSING_POLICY',
    })

    return policy
  })
}

export function readPolicyLookupTable(root: string): PolicyLookupTable {
  return loadLookupTable(root)
}

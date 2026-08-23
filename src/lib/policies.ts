import { readdirSync } from 'node:fs'
import path from 'node:path'

import { invariant } from './errors.js'
import {
  isDirectory,
  isRecord,
  readJson,
  readText,
  resolveInside,
  sha256,
} from './io.js'
import type {
  Policy,
  PolicyGuidance,
  PolicyLookupRow,
  PolicyLookupTable,
  PolicyRequirement,
  ReviewMode,
  RunContract,
} from './types.js'
import {
  isSelfDevelopmentInstallation,
  resolveReviewMode,
} from './project-config.js'
import { isValidPolicyRequirement } from './requirements/types.js'
import {
  detectWorkspaceTechnologies as detectTechnologies,
  supportedTechnologyIds,
} from './technologies.js'

/** Run contracts a policy lookup row MAY require. */
export const RUN_CONTRACT_IDS = new Set<RunContract>(['technical_director'])

/** Review methods a policy lookup row MAY require. */
export const REVIEW_MODE_IDS = new Set<ReviewMode>(['default', 'squad'])

interface PolicyContext {
  persona: string
  workflow: string
  stage: string
  technologies?: string[]
  /**
   * Contracts the active run abides by. Absent or empty means no
   * contract-scoped row applies, which is the case for every standalone
   * non-workflow invocation.
   */
  contracts?: RunContract[]
  /**
   * Review method the active run resolved. Absent falls back to the configured
   * default, which is what every standalone non-workflow invocation uses.
   */
  review_mode?: ReviewMode
  operator_artifacts?: 'requested' | 'suppressed'
}

export function detectWorkspaceTechnologies(root: string): Set<string> {
  return new Set(
    detectTechnologies(root).languages.map((language) => language.id),
  )
}

interface PolicyGuidanceSource {
  path: string
  start_heading?: string
  end_heading?: string
  read_trigger?: string
}

function matches(pattern: string, value: string): boolean {
  return pattern === '*' || pattern === value
}

/**
 * Trigger used when a policy declares no `read_trigger`. A generated
 * target-repository policy has no author to write one, so the fallback keeps the
 * reference readable instead of failing resolution.
 */
function defaultReadTrigger(policyId: string): string {
  return `Read this guidance before work that ${policyId} governs.`
}

function parseGuidanceSource(
  root: string,
  policyId: string,
  value: unknown,
  source: string,
): PolicyGuidance {
  invariant(isRecord(value), `${source} MUST be an object.`, {
    code: 'INVALID_POLICY',
  })
  invariant(
    typeof value.path === 'string' && value.path.length > 0,
    `${source}.path MUST be a non-empty string.`,
    { code: 'INVALID_POLICY' },
  )
  invariant(
    value.start_heading === undefined ||
      (typeof value.start_heading === 'string' &&
        value.start_heading.length > 0),
    `${source}.start_heading MUST be a non-empty string when present.`,
    { code: 'INVALID_POLICY' },
  )
  invariant(
    value.end_heading === undefined ||
      (typeof value.end_heading === 'string' && value.end_heading.length > 0),
    `${source}.end_heading MUST be a non-empty string when present.`,
    { code: 'INVALID_POLICY' },
  )
  invariant(
    value.read_trigger === undefined ||
      (typeof value.read_trigger === 'string' &&
        value.read_trigger.trim().length > 0),
    `${source}.read_trigger MUST be a non-empty string when present.`,
    { code: 'INVALID_POLICY' },
  )

  const definition = value as unknown as PolicyGuidanceSource
  const fullContent = readText(resolveInside(root, definition.path)).trim()
  let startIndex = 0
  let endIndex = fullContent.length

  if (definition.start_heading) {
    startIndex = fullContent.indexOf(definition.start_heading)
    invariant(
      startIndex >= 0,
      `${source}.start_heading was not found in ${definition.path}.`,
      { code: 'INVALID_POLICY' },
    )
  }

  if (definition.end_heading) {
    endIndex = fullContent.indexOf(definition.end_heading, startIndex)
    invariant(
      endIndex >= 0,
      `${source}.end_heading was not found in ${definition.path}.`,
      { code: 'INVALID_POLICY' },
    )
  }

  invariant(
    endIndex > startIndex,
    `${source} MUST select non-empty guidance from ${definition.path}.`,
    { code: 'INVALID_POLICY' },
  )

  const content = fullContent.slice(startIndex, endIndex).trim()

  return {
    source_path: definition.path,
    content,
    reference: {
      ...(definition.start_heading
        ? { start_heading: definition.start_heading }
        : {}),
      ...(definition.end_heading
        ? { end_heading: definition.end_heading }
        : {}),
      content_sha256: sha256(content),
      line_count: content.split('\n').length,
      byte_length: Buffer.byteLength(content, 'utf8'),
      read_trigger: definition.read_trigger ?? defaultReadTrigger(policyId),
    },
  }
}

function parsePolicy(root: string, value: unknown, source: string): Policy {
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
  let guidance: PolicyGuidance[] | undefined

  if (value.guidance_sources !== undefined) {
    invariant(
      Array.isArray(value.guidance_sources),
      `${source}: guidance_sources MUST be an array when present.`,
      { code: 'INVALID_POLICY' },
    )

    const policyId = value.id

    guidance = value.guidance_sources.map((item, index) =>
      parseGuidanceSource(
        root,
        policyId,
        item,
        `${source}:guidance_sources[${index}]`,
      ),
    )
  }

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
    id: value.id,
    title: value.title,
    severity: value.severity,
    summary: value.summary,
    instructions: value.instructions,
    guidance,
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
    value.installation_scope === undefined ||
      value.installation_scope === 'all' ||
      value.installation_scope === 'self_development',
    `${source}: installation_scope MUST be all or self_development when present.`,
    { code: 'INVALID_POLICY_LOOKUP' },
  )
  invariant(
    value.technology === undefined ||
      (typeof value.technology === 'string' &&
        supportedTechnologyIds().has(value.technology)),
    `${source}: technology MUST name a supported workspace technology when present.`,
    { code: 'INVALID_POLICY_LOOKUP' },
  )
  invariant(
    value.contract === undefined ||
      (typeof value.contract === 'string' &&
        RUN_CONTRACT_IDS.has(value.contract as RunContract)),
    `${source}: contract MUST name a supported run contract when present.`,
    { code: 'INVALID_POLICY_LOOKUP' },
  )
  invariant(
    value.review_mode === undefined ||
      (typeof value.review_mode === 'string' &&
        REVIEW_MODE_IDS.has(value.review_mode as ReviewMode)),
    `${source}: review_mode MUST name a supported review method when present.`,
    { code: 'INVALID_POLICY_LOOKUP' },
  )
  invariant(
    value.operator_artifacts === undefined ||
      value.operator_artifacts === 'requested' ||
      value.operator_artifacts === 'suppressed',
    `${source}: operator_artifacts MUST be requested or suppressed when present.`,
    { code: 'INVALID_POLICY_LOOKUP' },
  )
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

  const rows = value.rows.map((row, index) =>
    parseLookupRow(row, `${source}:rows[${index}]`),
  )
  const rowSources = value.rows.map((_, index) => `${source}:rows[${index}]`)
  const extensionDirectory = path.join(
    root,
    'governance',
    'registries',
    'policy_lookup.d',
  )

  if (isDirectory(extensionDirectory)) {
    for (const name of readdirSync(extensionDirectory)
      .filter((entry) => entry.endsWith('.json'))
      .sort()) {
      const extensionSource = `governance/registries/policy_lookup.d/${name}`
      const extension = readJson(path.join(root, extensionSource))

      invariant(
        isRecord(extension) &&
          extension.schema_version === 1 &&
          Array.isArray(extension.rows),
        `${extensionSource} MUST contain schema_version 1 and rows[].`,
        { code: 'INVALID_POLICY_LOOKUP' },
      )

      for (const [index, row] of extension.rows.entries()) {
        const rowSource = `${extensionSource}:rows[${index}]`

        rows.push(parseLookupRow(row, rowSource))
        rowSources.push(rowSource)
      }
    }
  }

  const rowIdentities = new Map<string, string>()
  const catalog = loadPolicyCatalog(root)

  for (const [index, row] of rows.entries()) {
    const identity = JSON.stringify({
      persona: row.persona,
      workflow: row.workflow,
      stage: row.stage,
      installation_scope: row.installation_scope ?? null,
      technology: row.technology ?? null,
      contract: row.contract ?? null,
      review_mode: row.review_mode ?? null,
      policies: [...row.policies].sort(),
    })
    const rowSource = rowSources[index] ?? `row ${index}`
    const previous = rowIdentities.get(identity)

    invariant(
      previous === undefined,
      `${rowSource} duplicates ${String(previous)}.`,
      { code: 'DUPLICATE_POLICY_LOOKUP_ROW' },
    )
    rowIdentities.set(identity, rowSource)

    for (const policyId of row.policies) {
      invariant(
        catalog.has(policyId),
        `${rowSource} references missing policy: ${policyId}`,
        { code: 'MISSING_POLICY' },
      )
    }
  }

  return {
    schema_version: 1,
    rows,
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
    const policy = parsePolicy(root, readJson(path.join(dir, name)), name)

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
  const selfDevelopment = isSelfDevelopmentInstallation(root)
  const technologies = new Set(
    context.technologies ?? [...detectWorkspaceTechnologies(root)],
  )
  const contracts = new Set(context.contracts ?? [])
  const reviewMode = context.review_mode ?? resolveReviewMode(root)
  const operatorArtifacts = context.operator_artifacts ?? 'requested'

  for (const row of lookup.rows) {
    const applies =
      matches(row.persona, context.persona) &&
      matches(row.workflow, context.workflow) &&
      matches(row.stage, context.stage)

    if (!applies) {
      continue
    }

    if (row.installation_scope === 'self_development' && !selfDevelopment) {
      continue
    }

    if (row.technology && !technologies.has(row.technology)) {
      continue
    }

    if (row.contract && !contracts.has(row.contract)) {
      continue
    }

    if (row.review_mode && row.review_mode !== reviewMode) {
      continue
    }

    if (
      row.operator_artifacts &&
      row.operator_artifacts !== operatorArtifacts
    ) {
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

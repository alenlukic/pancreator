import { readdirSync, type Dirent } from 'node:fs'
import path from 'node:path'

import { invariant } from './errors.js'
import {
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
} from './io.js'
import type {
  Policy,
  PolicyGuidance,
  PolicyLookupRow,
  PolicyLookupTable,
  PolicyRequirement,
} from './types.js'
import {
  configuredWorkspaceRoot,
  isSelfDevelopmentInstallation,
} from './project-config.js'
import { isValidPolicyRequirement } from './requirements/types.js'

interface PolicyContext {
  persona: string
  workflow: string
  stage: string
  technologies?: string[]
}

const SUPPORTED_POLICY_TECHNOLOGIES = new Set(['python'])
const PYTHON_MARKER_FILES = [
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'requirements.txt',
  'Pipfile',
  'poetry.lock',
  'pdm.lock',
  'uv.lock',
  'tox.ini',
  'noxfile.py',
  'environment.yml',
  'environment.yaml',
] as const
const TECHNOLOGY_SCAN_IGNORES = new Set([
  '.git',
  '.hg',
  '.mypy_cache',
  '.nox',
  '.pancreator',
  '.pytest_cache',
  '.ruff_cache',
  '.svn',
  '.tox',
  '.venv',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'venv',
])
const TECHNOLOGY_SCAN_MAX_DEPTH = 4
const TECHNOLOGY_SCAN_MAX_ENTRIES = 10_000

function containsPythonSource(
  directory: string,
  depth: number,
  budget: { remaining: number },
): boolean {
  if (depth > TECHNOLOGY_SCAN_MAX_DEPTH || budget.remaining <= 0) {
    return false
  }

  let entries: Dirent[]

  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return false
  }

  for (const entry of entries) {
    budget.remaining -= 1

    if (budget.remaining < 0) {
      return false
    }

    if (entry.isFile() && /\.pyi?$/u.test(entry.name)) {
      return true
    }

    if (
      entry.isDirectory() &&
      !TECHNOLOGY_SCAN_IGNORES.has(entry.name) &&
      containsPythonSource(path.join(directory, entry.name), depth + 1, budget)
    ) {
      return true
    }
  }

  return false
}

export function detectWorkspaceTechnologies(root: string): Set<string> {
  const workspaceRoot = path.resolve(root, configuredWorkspaceRoot(root))
  const technologies = new Set<string>()

  if (
    PYTHON_MARKER_FILES.some((marker) =>
      fileExists(path.join(workspaceRoot, marker)),
    ) ||
    containsPythonSource(workspaceRoot, 0, {
      remaining: TECHNOLOGY_SCAN_MAX_ENTRIES,
    })
  ) {
    technologies.add('python')
  }

  return technologies
}

interface PolicyGuidanceSource {
  path: string
  start_heading?: string
  end_heading?: string
}

function matches(pattern: string, value: string): boolean {
  return pattern === '*' || pattern === value
}

function parseGuidanceSource(
  root: string,
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

  return {
    source_path: definition.path,
    content: fullContent.slice(startIndex, endIndex).trim(),
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

    guidance = value.guidance_sources.map((item, index) =>
      parseGuidanceSource(root, item, `${source}:guidance_sources[${index}]`),
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
        SUPPORTED_POLICY_TECHNOLOGIES.has(value.technology)),
    `${source}: technology MUST name a supported workspace technology when present.`,
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

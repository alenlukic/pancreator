import { readdirSync } from 'node:fs'
import path from 'node:path'

import { isDirectory, isFile, isRecord, readJson, readText } from '../io.js'
import { loadPolicyCatalog } from '../policies.js'
import { listWorkflowSlugs } from '../workflow.js'

/**
 * A harness facility is a removable unit an operator recognizes by name. The
 * category decides which usage evidence can exist for it and which reference
 * edges the closure follows, so it is part of the identity rather than a label.
 */
export type FacilityCategory =
  | 'artifact-profile'
  | 'cli-subcommand'
  | 'command'
  | 'criterion'
  | 'handbook'
  | 'invocation'
  | 'mode'
  | 'orphan'
  | 'persona'
  | 'policy'
  | 'requirement'
  | 'skill'
  | 'source-symbol'
  | 'template'
  | 'validator'
  | 'workflow'

export type FacilityNodeKind =
  | 'facility'
  | 'derived'
  | 'source_symbol'
  | 'orphan'

export interface Facility {
  /** `<category>:<name>`, stable across scans and quoted by the operator. */
  id: string
  category: FacilityCategory
  name: string
  /** Repo-relative definition path, or null for a code-resident facility. */
  path: string | null
  /**
   * Every repo-relative path this facility alone defines. A persona owns both
   * its brief and its projected agent template, so removing the facility means
   * removing the set rather than the single definition file.
   */
  owned_paths: string[]
  /** Derived graph nodes cascade but never enter the operator candidate list. */
  selectable: boolean
  node_kind: FacilityNodeKind
  source_symbol?: string
  owner_facility?: string
  orphan_kind?: 'unused_export' | 'import_chain_only' | 'unused_file'
  dedicated_tests?: string[]
  protected: boolean
  /** Why the facility refuses removal. Present only when protected. */
  protected_reason?: string
}

/** An index file enumerates facilities, so it is edited and never removed. */
const INDEX_BASENAME = 'index.md'

/**
 * Facilities the harness cannot lose without breaking the bootstrap that would
 * be needed to repair the loss. The three policies project the always-on
 * `.cursor/rules` an unbound agent reads before any card exists, and the
 * debloat facilities are the ones this command runs on. Debloat is itself a
 * low-evidence facility, so without this entry it nominates itself for removal
 * on the first scan that runs 30 days after it last ran.
 */
const PROTECTED_FACILITY_REASONS = new Map<string, string>([
  [
    'policy:PRINCIPLES-001',
    'Projects the always-on operating principles rule every agent reads.',
  ],
  [
    'policy:DELEGATE-001',
    'Projects the always-on subagent supervision rule every agent reads.',
  ],
  [
    'policy:BROWSER-001',
    'Projects the always-on browser isolation rule every agent reads.',
  ],
  ['policy:DEBLOAT-001', 'Governs this command.'],
  ['command:pan-debloat', 'This command.'],
  ['persona:debloater', 'This command delegates it.'],
  ['mode:debloat', 'This command resolves its card from it.'],
  [
    'skill:debloat-closure',
    'Carries the adjudication procedure DEBLOAT-001 references.',
  ],
])

/**
 * Paths no removal may delete or edit. The operating card and the projection
 * manifest describe how every other facility is found and rendered, so a
 * closure that reaches them has gone wrong rather than found bloat.
 */
export const PROTECTED_PATHS: readonly string[] = [
  'AGENTS.md',
  'governance/registries/projection_manifest.json',
]

/**
 * Paths a removal edits in place rather than deletes.
 *
 * Each one enumerates facilities by construction: a lookup row, a dispatch
 * case, a grammar line, a model mapping. Losing one facility means losing its
 * entry, never the file. Treating them as ordinary code referrers would also
 * mark every facility as externally referenced and stop every cascade, so the
 * closure reports them as edits and the agent repairs each entry.
 */
export const EDIT_ONLY_PATHS: readonly string[] = [
  'config.json',
  'governance/registries/command_governance.json',
  'governance/registries/policy_lookup_table.json',
  'governance/registries/validation_registry.json',
  'src/cli.ts',
  'src/lib/governance-card.ts',
  'src/lib/pan-command-grammar.ts',
  'src/lib/validation.ts',
]

function listFiles(
  root: string,
  relativeDir: string,
  suffix: string,
): string[] {
  const absolute = path.join(root, relativeDir)

  if (!isDirectory(absolute)) {
    return []
  }

  return readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => entry.name)
    .sort()
}

function listFilesRecursive(
  root: string,
  relativeDir: string,
  suffix: string,
): string[] {
  const absolute = path.join(root, relativeDir)

  if (!isDirectory(absolute)) {
    return []
  }

  const found: string[] = []

  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const child = `${relativeDir}/${entry.name}`

    if (entry.isDirectory()) {
      found.push(...listFilesRecursive(root, child, suffix))
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      found.push(child)
    }
  }

  return found.sort()
}

function facility(
  category: FacilityCategory,
  name: string,
  definitionPath: string | null,
  ownedPaths: string[] = [],
  options: {
    selectable?: boolean
    nodeKind?: FacilityNodeKind
    includeDefinitionPath?: boolean
  } = {},
): Facility {
  const id = `${category}:${name}`
  const reason = PROTECTED_FACILITY_REASONS.get(id)
  const owned =
    definitionPath && options.includeDefinitionPath !== false
      ? [definitionPath, ...ownedPaths]
      : [...ownedPaths]

  return {
    id,
    category,
    name,
    path: definitionPath,
    owned_paths: [...new Set(owned)].sort(),
    selectable: options.selectable ?? true,
    node_kind: options.nodeKind ?? 'facility',
    protected: reason !== undefined,
    ...(reason ? { protected_reason: reason } : {}),
  }
}

interface StandaloneModeDefinition {
  name: string
  kind: string | null
  persona: string | null
  workflow: string | null
}

function sourceBlock(
  root: string,
  relative: string,
  declaration: string,
): string {
  const absolute = path.join(root, relative)

  if (!isFile(absolute)) {
    return ''
  }

  const source = readText(absolute)
  const start = source.indexOf(declaration)

  if (start < 0) {
    return ''
  }

  const open = source.indexOf('{', start + declaration.length)

  if (open < 0) {
    return ''
  }

  let depth = 0
  let quote: "'" | '"' | '`' | null = null
  let escaped = false

  for (let index = open; index < source.length; index += 1) {
    const character = source[index] as string

    if (quote) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === quote) {
        quote = null
      }

      continue
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character
    } else if (character === '{') {
      depth += 1
    } else if (character === '}') {
      depth -= 1

      if (depth === 0) {
        return source.slice(open + 1, index)
      }
    }
  }

  return ''
}

function topLevelEntries(block: string): Array<{ name: string; body: string }> {
  const starts = [
    ...block.matchAll(/^  (?:'([^']+)'|([A-Za-z][\w-]*)):\s*\{/gmu),
  ]

  return starts.map((match, index) => ({
    name: (match[1] ?? match[2]) as string,
    body: block.slice(
      (match.index ?? 0) + match[0].length,
      starts[index + 1]?.index ?? block.length,
    ),
  }))
}

function topLevelPropertyNames(block: string): string[] {
  return [...block.matchAll(/^  (?:'([^']+)'|([A-Za-z][\w-]*)):\s*/gmu)].map(
    (match) => (match[1] ?? match[2]) as string,
  )
}

/**
 * Standalone mode definitions from the scanned tree.
 *
 * Importing STANDALONE_MODES would inventory the running build when the
 * operator scans another worktree or historical tree.
 */
export function readStandaloneModes(root: string): StandaloneModeDefinition[] {
  return topLevelEntries(
    sourceBlock(
      root,
      'src/lib/governance-card.ts',
      'export const STANDALONE_MODES',
    ),
  ).map((entry) => {
    const field = (name: string): string | null =>
      new RegExp(`\\b${name}:\\s*['"]([^'"]+)['"]`, 'u').exec(
        entry.body,
      )?.[1] ?? null

    return {
      name: entry.name,
      kind: field('kind'),
      persona: field('persona'),
      workflow: field('workflow'),
    }
  })
}

function personaFacilities(root: string): Facility[] {
  const agentTemplates = new Set(
    listFiles(root, 'library/cursor/agents', '.md'),
  )

  return listFiles(root, 'library/personas', '.md')
    .filter((entry) => entry !== INDEX_BASENAME)
    .map((entry) => {
      const name = entry.slice(0, -'.md'.length)

      // The projected Cursor agent exists only for a persona a subagent runs.
      // An in-session persona such as the orchestrator has no template, and
      // claiming one would put a missing path in the removal closure.
      return facility(
        'persona',
        name,
        `library/personas/${entry}`,
        agentTemplates.has(entry) ? [`library/cursor/agents/${entry}`] : [],
      )
    })
}

function commandFacilities(root: string): Facility[] {
  return listFiles(root, 'library/cursor/commands', '.md').map((entry) =>
    facility(
      'command',
      entry.slice(0, -'.md'.length),
      `library/cursor/commands/${entry}`,
    ),
  )
}

function skillFacilities(root: string): Facility[] {
  return listFiles(root, 'library/skills', '.md')
    .filter((entry) => entry !== INDEX_BASENAME)
    .map((entry) =>
      facility(
        'skill',
        entry.slice(0, -'.md'.length),
        `library/skills/${entry}`,
      ),
    )
}

function policyFacilities(root: string): Facility[] {
  return [...loadPolicyCatalog(root).values()]
    .map((policy) =>
      facility('policy', policy.id, `governance/policies/${policy.id}.json`),
    )
    .sort((left, right) => left.id.localeCompare(right.id))
}

function workflowFacilities(root: string): Facility[] {
  return listWorkflowSlugs(root).map((slug) =>
    facility('workflow', slug, `library/workflows/${slug}/workflow.json`, [
      `library/workflows/${slug}`,
    ]),
  )
}

function modeFacilities(root: string): Facility[] {
  return readStandaloneModes(root)
    .map((entry) => entry.name)
    .sort()
    .map((mode) => facility('mode', mode, null))
}

function validatorFacilities(root: string): Facility[] {
  return listFiles(root, 'src/lib/validators', '.ts').map((entry) =>
    facility(
      'validator',
      entry.slice(0, -'.ts'.length),
      `src/lib/validators/${entry}`,
    ),
  )
}

function handbookFacilities(root: string): Facility[] {
  return listFilesRecursive(root, 'governance/handbooks', '.md')
    .filter((relative) => path.basename(relative) !== INDEX_BASENAME)
    .map((relative) =>
      facility(
        'handbook',
        relative.slice('governance/handbooks/'.length, -'.md'.length),
        relative,
      ),
    )
}

function templateFacilities(root: string): Facility[] {
  const absolute = path.join(root, 'library/templates')

  if (!isDirectory(absolute)) {
    return []
  }

  return readdirSync(absolute, { withFileTypes: true })
    .map((entry) => entry.name)
    .sort()
    .map((name) => facility('template', name, `library/templates/${name}`))
}

function derivedFacility(
  category: FacilityCategory,
  name: string,
  definitionPath: string | null = null,
): Facility {
  return facility(category, name, definitionPath, [], {
    selectable: false,
    nodeKind: 'derived',
    includeDefinitionPath: false,
  })
}

function requirementFacilities(root: string): Facility[] {
  return [...loadPolicyCatalog(root).values()]
    .flatMap((policy) =>
      (policy.requirements ?? []).map((requirement) =>
        derivedFacility(
          'requirement',
          `${policy.id}/${requirement.id}`,
          `governance/policies/${policy.id}.json`,
        ),
      ),
    )
    .sort((left, right) => left.id.localeCompare(right.id))
}

function invocationKindFacilities(root: string): Facility[] {
  const absolute = path.join(root, 'src/lib/requirements/types.ts')

  if (!isFile(absolute)) {
    return []
  }

  const source = readText(absolute)
  const match =
    /export type InvocationKind\s*=\s*([\s\S]*?)\n\nexport interface/u.exec(
      source,
    )

  if (!match) {
    return []
  }

  return [...(match[1] as string).matchAll(/'([^']+)'/gu)]
    .map((entry) => derivedFacility('invocation', entry[1] as string, null))
    .sort((left, right) => left.id.localeCompare(right.id))
}

function criterionFacilities(root: string): Facility[] {
  const stagesRoot = path.join(root, 'library', 'workflows')

  if (!isDirectory(stagesRoot)) {
    return []
  }

  const criteria = new Map<string, string>()
  const workflows = readdirSync(stagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  for (const workflow of workflows) {
    for (const file of listFiles(
      root,
      `library/workflows/${workflow}/stages`,
      '.json',
    )) {
      const relative = `library/workflows/${workflow}/stages/${file}`
      const value = readJson(path.join(root, relative))

      if (!isRecord(value) || !Array.isArray(value.criteria)) {
        continue
      }

      for (const criterion of value.criteria) {
        if (isRecord(criterion) && typeof criterion.id === 'string') {
          criteria.set(criterion.id, relative)
        }
      }
    }
  }

  return [...criteria]
    .map(([id, relative]) => derivedFacility('criterion', id, relative))
    .sort((left, right) => left.id.localeCompare(right.id))
}

function artifactProfileFacilities(root: string): Facility[] {
  return topLevelPropertyNames(
    sourceBlock(
      root,
      'src/lib/operator-artifact-profiles.ts',
      'export const OPERATOR_ARTIFACT_PROFILE_HEADINGS',
    ),
  )
    .map((name) =>
      derivedFacility(
        'artifact-profile',
        name,
        'src/lib/operator-artifact-profiles.ts',
      ),
    )
    .sort((left, right) => left.id.localeCompare(right.id))
}

function cliSubcommandFacilities(root: string): Facility[] {
  const absolute = path.join(root, 'src/lib/pan-command-grammar.ts')

  if (!isFile(absolute)) {
    return []
  }

  const names = new Set<string>()

  for (const match of readText(absolute).matchAll(
    /^\s*pan ([a-z][a-z0-9-]*)\b/gmu,
  )) {
    names.add(match[1] as string)
  }

  return [...names]
    .sort()
    .map((name) =>
      derivedFacility('cli-subcommand', name, 'src/lib/pan-command-grammar.ts'),
    )
}

/**
 * Every removable facility in the workspace, which is the denominator the
 * unused scan divides its usage evidence into.
 *
 * The enumeration reads the canonical directories rather than a registry,
 * because a registry that lists facilities is itself a facility that can drift.
 */
export function collectFacilities(root: string): Facility[] {
  return [
    ...artifactProfileFacilities(root),
    ...cliSubcommandFacilities(root),
    ...commandFacilities(root),
    ...criterionFacilities(root),
    ...handbookFacilities(root),
    ...invocationKindFacilities(root),
    ...modeFacilities(root),
    ...personaFacilities(root),
    ...policyFacilities(root),
    ...requirementFacilities(root),
    ...skillFacilities(root),
    ...templateFacilities(root),
    ...validatorFacilities(root),
    ...workflowFacilities(root),
  ].sort((left, right) => left.id.localeCompare(right.id))
}

/** Index the facilities by id for repeated lookup during a scan. */
export function facilityIndex(
  facilities: readonly Facility[],
): Map<string, Facility> {
  return new Map(facilities.map((entry) => [entry.id, entry]))
}

/**
 * Map every owned path back to the facility that owns it, so a reference to a
 * file resolves to the facility a scan reports.
 */
export function facilitiesByPath(
  facilities: readonly Facility[],
): Map<string, Facility> {
  const byPath = new Map<string, Facility>()

  for (const entry of facilities) {
    for (const owned of entry.owned_paths) {
      // A workflow owns its directory and its workflow.json. The more specific
      // owner already sits in the map, so the first writer wins.
      if (!byPath.has(owned)) {
        byPath.set(owned, entry)
      }
    }
  }

  return byPath
}

/**
 * Governance, handbook, policy-lookup, and harness-instruction coverage checks
 * that repository validation runs.
 */

import { readdirSync } from 'node:fs'
import path from 'node:path'

import { fileExists, readText, resolveInside, isFile } from '../io.js'
import {
  type PolicyCardAudience,
  filterPolicyInstructionsForCard,
  policyInstructionAppliesToCard,
} from '../policy-instructions.js'
import { STANDALONE_MODES } from '../governance-card/modes.js'
import {
  HOST_TOOLS_PATH,
  allHostToolNames,
  hostToolPolicyIssues,
  loadHostToolRegistry,
} from '../host-tools.js'
import {
  PLATFORM_GUIDANCE_CATALOG_PATH,
  loadPlatformGuidanceCatalog,
} from '../platform-guidance.js'
import { loadPolicyCatalog, resolvePolicies } from '../policies.js'
import {
  PLATFORM_ACTION_CATEGORY,
  REDLINE_CATEGORIES,
  readAuthorityOrder,
} from '../watch/redline.js'
import { collectAwaitShellBanIssues } from '../validators/await-shell-ban.js'
import { collectShellMonitorIssues } from '../validators/shell-monitor.js'
import type { Policy, PolicyLookupRow, PolicyLookupTable } from '../types.js'

function listMarkdownFiles(directory: string): string[] {
  const files: string[] = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(absolute))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(absolute)
    }
  }

  return files
}

const CODE_REVIEW_PERSONAS = new Set([
  'coder',
  'metacritic',
  'reviewer',
  'qa-tester',
])
export const DESIGN_PERSONAS = new Set([
  'designer',
  'design-reviewer',
  'design-qa',
])
const POLICY_REFERENCE_PATTERN = /\b[A-Z][A-Z0-9]*-\d{3}\b/gu
const STATIC_GUIDANCE_PATH_PATTERN =
  /\b(?:governance\/handbooks|library\/skills)\/[A-Za-z0-9._/-]+\.md\b/gu

interface HandbookPolicyRequirement {
  handbook_path: string
  label: string
  /** Workflow-stage personas that MUST resolve the handbook. May be empty. */
  personas: Set<string>
  installation_scope?: 'all' | 'self_development'
  technology?: string
  /**
   * Standalone mode that owns the handbook instead of any workflow stage. A
   * batch-pass handbook stays out of ordinary stage context by design, so the
   * coverage check follows the mode context rather than the stage personas.
   */
  standalone_mode?: string
}

export const HANDBOOK_POLICY_REQUIREMENTS: HandbookPolicyRequirement[] = [
  {
    handbook_path: 'governance/handbooks/eng/engineering.md',
    label: 'engineering handbook',
    personas: CODE_REVIEW_PERSONAS,
  },
  {
    handbook_path: 'governance/handbooks/typescript/node.md',
    label: 'TypeScript handbook',
    personas: CODE_REVIEW_PERSONAS,
    installation_scope: 'self_development',
  },
  {
    handbook_path: 'governance/handbooks/typescript/style-guide.md',
    label: 'TypeScript style handbook',
    personas: new Set<string>(),
    standalone_mode: 'style',
  },
  {
    handbook_path: 'governance/handbooks/python/style-guide.md',
    label: 'Python style handbook',
    personas: new Set<string>(),
    standalone_mode: 'style',
  },
  {
    handbook_path: 'governance/handbooks/design/ux-guide.md',
    label: 'design handbook',
    personas: DESIGN_PERSONAS,
  },
]

/**
 * Report whether a handbook policy requirement applies to this installation:
 * always, unless it is scoped to self-development and the installation is not.
 */
export function handbookRequirementApplies(
  requirement: HandbookPolicyRequirement,
  selfDevelopment: boolean,
): boolean {
  return (
    requirement.installation_scope !== 'self_development' || selfDevelopment
  )
}

function validateHandbookPolicyCoverage(
  root: string,
  catalog: Map<string, Policy>,
  requirement: HandbookPolicyRequirement,
  errors: string[],
): Set<string> {
  const handbookAbsolute = path.join(root, requirement.handbook_path)

  if (!fileExists(handbookAbsolute)) {
    errors.push(`missing required file: ${requirement.handbook_path}`)
    return new Set<string>()
  }

  const policyIds = new Set<string>()
  const matches = [...catalog.values()].filter((policy) =>
    (policy.guidance ?? []).some(
      (guidance) => guidance.source_path === requirement.handbook_path,
    ),
  )

  if (matches.length === 0) {
    errors.push(
      `${requirement.handbook_path} MUST be delivered by at least one policy`,
    )
    return policyIds
  }

  for (const policy of matches) {
    policyIds.add(policy.id)
  }

  return policyIds
}

/**
 * Check governance authoring and append error messages to `errors`: every
 * governance Markdown file declares RFC 2119 semantics, every policy summary
 * and instruction uses an RFC 2119 directive, static guidance paths are
 * declared as guidance sources, and each required handbook is delivered by a
 * policy and reaches its standalone mode. Returns the ids of the policies that
 * deliver each required handbook.
 */
export function validateGovernance(
  root: string,
  catalog: Map<string, Policy>,
  errors: string[],
): Map<string, Set<string>> {
  const governanceRoot = path.join(root, 'governance')
  const directivePattern = /\b(?:MUST(?: NOT)?|SHOULD(?: NOT)?|MAY)\b/u

  for (const filePath of listMarkdownFiles(governanceRoot)) {
    const relative = path.relative(root, filePath).split(path.sep).join('/')
    const content = readText(filePath)

    if (!content.includes('RFC 2119')) {
      errors.push(`${relative} MUST declare RFC 2119 directive semantics`)
    }
  }

  for (const policy of catalog.values()) {
    if (!directivePattern.test(policy.summary)) {
      errors.push(`${policy.id} summary MUST use an RFC 2119 directive`)
    }

    for (const [index, instruction] of policy.instructions.entries()) {
      if (!directivePattern.test(instruction.text)) {
        errors.push(
          `${policy.id} instruction ${index + 1} MUST use an RFC 2119 directive`,
        )
      }
    }

    const declaredGuidance = new Set(
      (policy.guidance ?? []).map((guidance) => guidance.source_path),
    )
    const staticReferences = [
      policy.summary,
      ...policy.instructions.map((instruction) => instruction.text),
    ].flatMap((text) => text.match(STATIC_GUIDANCE_PATH_PATTERN) ?? [])

    for (const guidancePath of new Set(staticReferences)) {
      if (!declaredGuidance.has(guidancePath)) {
        errors.push(
          `${policy.id} references static guidance ${guidancePath} without declaring it in guidance_sources`,
        )
      }
    }
  }

  const handbookPolicies = new Map<string, Set<string>>()

  for (const requirement of HANDBOOK_POLICY_REQUIREMENTS) {
    const policyIds = validateHandbookPolicyCoverage(
      root,
      catalog,
      requirement,
      errors,
    )

    handbookPolicies.set(requirement.handbook_path, policyIds)
    validateStandaloneHandbookCoverage(root, requirement, policyIds, errors)
  }

  return handbookPolicies
}

/**
 * A handbook owned by a standalone mode reaches agents only through that mode,
 * so the mode context — not a workflow stage — carries the coverage duty.
 */
function validateStandaloneHandbookCoverage(
  root: string,
  requirement: HandbookPolicyRequirement,
  handbookPolicyIds: Set<string>,
  errors: string[],
): void {
  if (!requirement.standalone_mode) {
    return
  }

  const mode = STANDALONE_MODES[requirement.standalone_mode]

  if (!mode) {
    errors.push(
      `${requirement.handbook_path} names unknown standalone mode ` +
        `'${requirement.standalone_mode}'`,
    )
    return
  }

  const resolved = resolvePolicies(root, {
    persona: mode.persona,
    workflow: mode.workflow,
    stage: mode.stage,
    ...(requirement.technology
      ? { technologies: [requirement.technology] }
      : {}),
  })

  if (resolved.some((policy) => handbookPolicyIds.has(policy.id))) {
    return
  }

  errors.push(
    `standalone mode '${requirement.standalone_mode}' MUST load a policy for ` +
      `the ${requirement.label}`,
  )
}

/**
 * A harness coverage citation names the enforcing test, not only its file:
 * `` `tests/<path>::<test name>` ``. The bare-path form is matched separately so
 * the diagnostic can say which half is missing.
 */
const HARNESS_INSTRUCTION_TEST_CITATION_PATTERN =
  /`(tests\/[A-Za-z0-9._/-]+)::([^`]+)`/gu
const HARNESS_INSTRUCTION_TEST_PATH_PATTERN = /\btests\/[A-Za-z0-9._/:-]+/gu

function tokenBoundaryPattern(token: string): RegExp {
  const escaped = token.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`, 'u')
}

/**
 * True when `content` declares a test whose quoted name is exactly `name`.
 *
 * The name MUST open a `test(...)` or `it(...)` call that begins a line. A bare
 * quoted-substring search accepted any string in the file, so an import
 * specifier satisfied a citation that names no enforcer. Matching anywhere in
 * the line accepted a fixture literal, because a test that writes
 * `test('...')` into a temporary file carries that call inside a string.
 */
function declaresQuotedTestName(content: string, name: string): boolean {
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  // A raw string cannot carry the backtick alternative, because `\`` is an
  // invalid identity escape under the `u` flag.
  const declaration = `^\\s*(?:await\\s+)?(?:test|it)\\(\\s*(['"\`])${escaped}\\1`

  return new RegExp(declaration, 'mu').test(content)
}

/**
 * The `harness` audience removes an instruction from every card, so the
 * citation beside it is the only surface a reviewer can follow. This check
 * makes that citation resolve to one declared test rather than to a file that
 * merely exists, and refuses one citation standing in for several rules.
 */
export function validateHarnessInstructionCoverage(
  root: string,
  catalog: Map<string, Policy>,
): string[] {
  const errors: string[] = []

  for (const policy of catalog.values()) {
    const requirementIds = (policy.requirements ?? []).map(
      (requirement) => requirement.id,
    )
    const requirementPatterns = requirementIds.map(tokenBoundaryPattern)
    const citedBy = new Map<string, number>()

    for (const [index, instruction] of policy.instructions.entries()) {
      if (!instruction.audience.includes('harness')) {
        continue
      }

      const label = `${policy.id} harness instruction ${index + 1}`
      const text = instruction.text

      if (requirementPatterns.some((pattern) => pattern.test(text))) {
        continue
      }

      const citations = [
        ...text.matchAll(HARNESS_INSTRUCTION_TEST_CITATION_PATTERN),
      ]

      if (citations.length === 0) {
        const bare = [...text.matchAll(HARNESS_INSTRUCTION_TEST_PATH_PATTERN)]

        errors.push(
          bare.length > 0
            ? `${label} cites ${bare[0]?.[0] ?? 'a tests/ path'} without naming ` +
                'the test that enforces it; use the `tests/<path>::<test name>` form'
            : `${label} MUST reference a same-policy requirement id or a ` +
                '`tests/<path>::<test name>` citation',
        )
        continue
      }

      for (const citation of citations) {
        const testPath = citation[1] as string
        const testName = (citation[2] as string).trim()
        const token = `${testPath}::${testName}`
        const duplicate = citedBy.get(token)

        if (duplicate !== undefined) {
          errors.push(
            `${label} repeats the coverage citation ${token}, which instruction ` +
              `${duplicate} already claims; one test MUST NOT stand in for two rules`,
          )
          continue
        }

        citedBy.set(token, index + 1)

        let content: string | null = null

        try {
          const absolute = resolveInside(root, testPath)
          content = isFile(absolute) ? readText(absolute) : null
        } catch {
          content = null
        }

        if (content === null) {
          errors.push(`${label} cites ${testPath}, which is not a test file`)
          continue
        }

        if (!declaresQuotedTestName(content, testName)) {
          errors.push(
            `${label} cites test '${testName}', which ${testPath} does not declare`,
          )
        }
      }
    }
  }

  return errors
}

/**
 * Personas whose governance card is a supervisor card. Resolved on demand
 * because the mode table and this module import each other.
 */
function supervisorCardPersonas(): Set<string> {
  return new Set(
    Object.values(STANDALONE_MODES)
      .filter((mode) => mode.kind === 'supervisor')
      .map((mode) => mode.persona),
  )
}

const CARD_AUDIENCES: readonly PolicyCardAudience[] = ['agent', 'supervisor']

/**
 * The card audiences one lookup row can render. A wildcard persona row reaches
 * every card, a supervisor persona reaches only the supervisor card, and every
 * other persona reaches a worker card.
 */
function rowCardAudiences(row: PolicyLookupRow): PolicyCardAudience[] {
  if (row.persona === '*') {
    return [...CARD_AUDIENCES]
  }

  return supervisorCardPersonas().has(row.persona) ? ['supervisor'] : ['agent']
}

/** Registry integrity: a policy no lookup row names reaches no agent at all. */
export function validatePolicyLookupCoverage(
  catalog: Map<string, Policy>,
  lookup: PolicyLookupTable,
): string[] {
  const named = new Set(lookup.rows.flatMap((row) => row.policies))

  return [...catalog.keys()]
    .filter((id) => !named.has(id))
    .sort()
    .map(
      (id) =>
        `${id} is in the policy catalog and no policy lookup row names it, so ` +
        'no card delivers it',
    )
}

/**
 * A row that resolves a policy whose filtered instruction list is empty renders
 * a policy heading with no rules under it. The audience assignment, not the
 * row, is wrong in that case.
 */
export function validateLookupRowDelivery(
  catalog: Map<string, Policy>,
  lookup: PolicyLookupTable,
): string[] {
  const errors: string[] = []

  for (const [index, row] of lookup.rows.entries()) {
    for (const policyId of row.policies) {
      const policy = catalog.get(policyId)

      if (!policy) {
        continue
      }

      for (const audience of rowCardAudiences(row)) {
        if (
          filterPolicyInstructionsForCard(policy.instructions, audience)
            .length > 0
        ) {
          continue
        }

        errors.push(
          `policy lookup row ${index} (${row.persona}/${row.workflow}/${row.stage}) ` +
            `loads ${policyId}, whose instruction list is empty at card audience ` +
            `${audience}`,
        )
      }
    }
  }

  return errors
}

/**
 * Every audience a policy carries must reach a card. `harness` is the one
 * deliberately card-less audience, and `validateHarnessInstructionCoverage`
 * judges it instead. Any other audience with no producer is a write-only tag
 * whose rules are delivered nowhere.
 */
export function validatePolicyAudienceDelivery(
  catalog: Map<string, Policy>,
  lookup: PolicyLookupTable,
): string[] {
  const errors: string[] = []
  const delivered = new Map<string, Set<PolicyCardAudience>>()

  for (const row of lookup.rows) {
    for (const policyId of row.policies) {
      const audiences = delivered.get(policyId) ?? new Set()

      for (const audience of rowCardAudiences(row)) {
        audiences.add(audience)
      }

      delivered.set(policyId, audiences)
    }
  }

  for (const policy of catalog.values()) {
    const carried = new Set(
      policy.instructions.flatMap((instruction) => instruction.audience),
    )
    const rendered = delivered.get(policy.id) ?? new Set()

    for (const audience of [...carried].sort()) {
      if (audience === 'harness') {
        continue
      }

      const producers = CARD_AUDIENCES.filter((card) =>
        policyInstructionAppliesToCard(
          { text: 'probe', audience: [audience] },
          card,
        ),
      )

      if (producers.length === 0) {
        errors.push(
          `${policy.id} carries audience '${audience}', which no card producer ` +
            'renders, so those instructions reach no agent',
        )
        continue
      }

      if (!producers.some((card) => rendered.has(card))) {
        errors.push(
          `${policy.id} carries audience '${audience}' and no policy lookup row ` +
            `renders a card at audience ${producers.join(' or ')}`,
        )
      }
    }
  }

  return errors
}

function lookupPatternCovers(provider: string, consumer: string): boolean {
  return provider === '*' || provider === consumer
}

function lookupRowCovers(
  provider: PolicyLookupRow,
  consumer: PolicyLookupRow,
): boolean {
  return (
    lookupPatternCovers(provider.persona, consumer.persona) &&
    lookupPatternCovers(provider.workflow, consumer.workflow) &&
    lookupPatternCovers(provider.stage, consumer.stage) &&
    // A technology-scoped row only resolves for a run in that technology, so it
    // cannot satisfy a dependency for a row that resolves without that scope.
    (provider.technology === undefined ||
      provider.technology === consumer.technology) &&
    // A contract-scoped row only resolves for runs carrying that contract, so it
    // cannot satisfy a dependency for a row that resolves without one.
    (provider.contract === undefined ||
      provider.contract === consumer.contract) &&
    // Same reasoning for operator-artifact-scoped rows.
    (provider.operator_artifacts === undefined ||
      provider.operator_artifacts === consumer.operator_artifacts) &&
    // A mode-scoped row cannot provide a policy to the opposite mode.
    (provider.long_horizon === undefined ||
      provider.long_horizon === consumer.long_horizon)
  )
}

function referencedPolicyIds(policy: Policy): Set<string> {
  const text = [
    policy.summary,
    ...policy.instructions.map((instruction) => instruction.text),
    ...(policy.guidance ?? []).map((guidance) => guidance.content),
  ].join('\n')
  // A test coverage citation (`tests/<path>::<test name>`) names a test, not
  // a policy; a test name may carry a token shaped like a policy id.
  const withoutTestCitations = text.replaceAll(
    /`tests\/[A-Za-z0-9._/-]+::[^`]+`/gu,
    '',
  )

  return new Set(withoutTestCitations.match(POLICY_REFERENCE_PATTERN) ?? [])
}

/**
 * Append an error to `errors` for each policy that names a policy id missing
 * from the catalog, and for each lookup row that loads a policy without also
 * loading, through a covering row, every policy it references. Test citations
 * are not read as policy references.
 */
export function validatePolicyLookupDependencies(
  catalog: Map<string, Policy>,
  lookup: PolicyLookupTable,
  errors: string[],
): void {
  for (const policy of catalog.values()) {
    for (const referencedId of referencedPolicyIds(policy)) {
      if (!catalog.has(referencedId)) {
        errors.push(`${policy.id} references missing policy ${referencedId}`)
      }
    }
  }

  for (const [index, row] of lookup.rows.entries()) {
    const available = new Set(
      lookup.rows
        .filter((candidate) => lookupRowCovers(candidate, row))
        .flatMap((candidate) => candidate.policies),
    )

    for (const policyId of row.policies) {
      const policy = catalog.get(policyId)

      if (!policy) {
        continue
      }

      for (const referencedId of referencedPolicyIds(policy)) {
        if (catalog.has(referencedId) && !available.has(referencedId)) {
          errors.push(
            `policy lookup row ${index} (${row.persona}/${row.workflow}/${row.stage}) ` +
              `loads ${policyId} without referenced policy ${referencedId}`,
          )
        }
      }
    }
  }
}

const FALLBACK_QUESTION_TOOL_IDENTIFIERS = [
  'cursor/ask_question',
  'ask_question',
  'askquestion',
  'ask-question',
] as const
const CURSOR_AGENT_FRONTMATTER_PATTERN =
  /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u

/**
 * Lowercased question-tool identifiers of every host, from the host tool
 * registry. A root without the registry falls back to the Cursor names;
 * `validateHostToolRegistry` reports the missing file.
 */
function questionToolIdentifiers(root: string): string[] {
  if (!fileExists(path.join(root, HOST_TOOLS_PATH))) {
    return [...FALLBACK_QUESTION_TOOL_IDENTIFIERS]
  }

  const registry = loadHostToolRegistry(root)

  return [
    ...allHostToolNames(registry, 'question_tool'),
    ...registry.terms.question_tool.aliases,
  ].map((identifier) => identifier.toLowerCase())
}

/** Check the host tool registry shape and its agreement with each owning policy. */
export function validateHostToolRegistry(root: string): string[] {
  let registry

  try {
    registry = loadHostToolRegistry(root)
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)]
  }

  const catalog = loadPolicyCatalog(root)

  return hostToolPolicyIssues(registry, (policyId) => {
    const policy = catalog.get(policyId)

    return policy
      ? [
          policy.summary,
          ...policy.instructions.map((instruction) => instruction.text),
        ].join('\n')
      : null
  })
}

/**
 * Check the platform guidance catalog shape, and that every entry names a
 * redline category or the platform action category.
 */
export function validatePlatformGuidanceCatalog(root: string): string[] {
  let catalog

  try {
    catalog = loadPlatformGuidanceCatalog(root)
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)]
  }

  if (catalog === null) {
    return [`missing required file: ${PLATFORM_GUIDANCE_CATALOG_PATH}`]
  }

  const categories = new Set([
    ...REDLINE_CATEGORIES.map((category) => category.id),
    PLATFORM_ACTION_CATEGORY.id,
  ])

  return catalog.entries
    .filter((entry) => !categories.has(entry.category))
    .map(
      (entry) =>
        `${PLATFORM_GUIDANCE_CATALOG_PATH}: ${entry.id} names unknown ` +
        `category ${entry.category}`,
    )
}

const SUPERVISOR_AGENT_SOURCE = 'library/vscode/agents/supervisor.agent.md'

/**
 * Check that the VS Code supervisor agent lists the `AGENTS.md` authority
 * order verbatim, because VS Code ranks its body above every earlier system
 * instruction.
 */
export function validateSupervisorAgentAuthority(root: string): string[] {
  const absolute = path.join(root, SUPERVISOR_AGENT_SOURCE)

  if (!fileExists(absolute)) {
    return []
  }

  const lines = readText(absolute).split('\n')
  const start = lines.findIndex((line) => line === '## Authority order')
  const listed: string[] = []

  for (const line of start === -1 ? [] : lines.slice(start + 1)) {
    if (line.startsWith('## ')) {
      break
    }

    const match = /^\d+\.\s+(.+)$/u.exec(line)

    if (match) {
      listed.push(match[1].trim())
    }
  }

  return JSON.stringify(listed) === JSON.stringify(readAuthorityOrder(root))
    ? []
    : [
        `${SUPERVISOR_AGENT_SOURCE}: the "## Authority order" list MUST match ` +
          'the AGENTS.md authority order verbatim',
      ]
}

/** Check that canonical Cursor agent frontmatter does not name a host question tool. */
export function validateQuestionToolAccess(root: string): string[] {
  const directory = path.join(root, 'library', 'cursor', 'agents')

  if (!fileExists(directory)) {
    return ['missing canonical Cursor agent directory: library/cursor/agents']
  }

  const filenames = readdirSync(directory)
    .filter((filename) => filename.endsWith('.md'))
    .sort()

  if (filenames.length === 0) {
    return ['library/cursor/agents MUST contain canonical agent files']
  }

  const errors: string[] = []
  const identifiers = questionToolIdentifiers(root)

  for (const filename of filenames) {
    const absolute = path.join(directory, filename)
    const frontmatter = CURSOR_AGENT_FRONTMATTER_PATTERN.exec(
      readText(absolute),
    )?.[1]

    if (!frontmatter) {
      continue
    }

    const normalized = frontmatter.toLowerCase()
    const identifier = identifiers.find((candidate) =>
      normalized.includes(candidate),
    )

    if (identifier) {
      errors.push(
        `library/cursor/agents/${filename} frontmatter MUST NOT name or block ` +
          `question-method identifier '${identifier}'`,
      )
    }
  }

  return errors
}

/** Check that every canonical agent and the hooks source carry the AwaitShell ban. */
export function validateAwaitShellBan(root: string): string[] {
  return collectAwaitShellBanIssues(root).map((issue) => issue.message)
}

/** Check that the shell-monitor hook, the wrapper, and both allowlists agree. */
export function validateShellMonitor(root: string): string[] {
  return collectShellMonitorIssues(root).map((issue) => issue.message)
}

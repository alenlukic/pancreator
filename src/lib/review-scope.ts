import { isRecord } from './io.js'
import {
  gitChangedPathsBetween,
  gitMergeBase,
  gitRevParse,
  gitShowFile,
} from './git.js'
import { invariant } from './errors.js'
import { resolvePolicies } from './policies.js'

/**
 * A reviewer depends on more than the diff it reads. It depends on the
 * charters that tell it what to look for, the policies that bind how it
 * behaves, the code that builds its card and captures its target, the tests
 * and validators it trusts when it "verifies" a finding, and the registries
 * that can excuse a defect. A change to any of those is a conflict of
 * interest, and the conflicts differ in what the session can still do:
 *
 * - `instrument`: the lineup, a charter, the coordinator, the mode policy, an
 *   entry point, the scope check itself, or the reviewer's model mapping. A
 *   charter cannot find a defect introduced into that charter. Excluded from
 *   the squad's verdict and routed to an independent reviewer.
 * - `conduct`: a policy on the reviewer's own card, or guidance it delivers.
 *   The squad can review it — under the base version of that rule, so the
 *   change cannot relax the rule that would catch it. A difference from the
 *   base standard is never a finding; the standards delta goes to the
 *   operator, who owns the merits of a rule change.
 * - `substrate`: what the reviewer trusts when it verifies — validation code,
 *   test helpers, the check wrappers, the gate cache, exemption registries,
 *   the changelog. Reviewed normally, but verification that leans on them is
 *   tainted and must say so.
 */
export type ConflictTier = 'instrument' | 'conduct' | 'substrate'

export interface ReviewConflict {
  path: string
  tier: ConflictTier
  /** Why the path is in the closure, for the operator report. */
  source: string
}

/**
 * Static instrument paths that no card can enumerate: the lineup files, the
 * coordinator and its projected agent, both entry points, and this module.
 * Everything else in the closure is derived from the review card.
 *
 * A trailing `*` matches any suffix; every other pattern matches one path.
 */
export const REVIEW_MACHINERY_PATTERNS = [
  'governance/policies/REVIEW-001.json',
  'governance/policies/SHEPHERD-001.json',
  'library/cursor/agents/shepherd-reviewer.md',
  'library/cursor/commands/pan-review.md',
  'library/cursor/commands/pan-shepherd.md',
  'library/personas/shepherd-reviewer.md',
  'library/skills/review-squad*',
  'library/skills/shepherd-pr.md',
  'src/lib/review-scope.ts',
  'src/lib/governance-card.ts',
  'src/lib/policies.ts',
  'src/lib/policy-guidance.ts',
] as const

/**
 * The tests of each machinery module, derived from the module list so a new
 * machinery entry brings its tests into the substrate tier without a second
 * edit. `src/lib/<module>.ts` yields `tests/*\/<module>*.test.ts`, which
 * reaches `review-scope.test.ts` and `review-scope-resolve.test.ts` alike.
 */
export const MACHINERY_TEST_PATTERNS: readonly string[] =
  REVIEW_MACHINERY_PATTERNS.filter(
    (pattern) => pattern.startsWith('src/lib/') && pattern.endsWith('.ts'),
  ).map(
    (pattern) =>
      `tests/*/${pattern.slice('src/lib/'.length, -'.ts'.length)}*.test.ts`,
  )

/**
 * Paths the reviewer trusts when it verifies a finding or reads a green
 * result. Not what it looks for — what it believes.
 */
export const VERIFICATION_SUBSTRATE_PATTERNS: readonly string[] = [
  'src/lib/validation.ts',
  'src/lib/validators/*',
  'src/lib/requirements/*',
  'src/lib/governance/*',
  'src/lib/gate-cache.ts',
  'src/lib/git.ts',
  'src/lib/worktrees.ts',
  'src/lib/projection.ts',
  'src/lib/cursor-content.ts',
  'tests/helpers.ts',
  'tests/*/*helpers.ts',
  ...MACHINERY_TEST_PATTERNS,
  'bin/run-quiet',
  'bin/run-built',
  'bin/check',
  'bin/build',
  'bin/lint',
  'bin/install',
  'library/templates/repository-checks*',
  'governance/registries/directive_exemptions.json',
  'governance/registries/context_bloat_dispositions.json',
  'governance/registries/validation_registry.json',
  'CHANGELOG.md',
]

/**
 * The `governance` case of `src/cli.ts` is where `governance card` and
 * `governance review-scope` are wired: the entry points of the review mode.
 * The rest of that file is every other command, so the whole path is not
 * machinery; only a change inside this case is.
 */
export function cliGovernanceBlock(text: string | null): string | null {
  if (text === null) {
    return null
  }

  const start = text.indexOf("case 'governance': {")

  if (start === -1) {
    return null
  }

  const next = text.indexOf("\n    case '", start)

  return next === -1 ? text.slice(start) : text.slice(start, next)
}

/** True when the change edits the governance entry points of `src/cli.ts`. */
export function cliGovernanceBlocksChanged(
  baseText: string | null,
  headText: string | null,
): boolean {
  return cliGovernanceBlock(baseText) !== cliGovernanceBlock(headText)
}

/** The personas whose cards define the reviewer's conduct. */
export const REVIEW_PERSONAS = ['reviewer', 'shepherd-reviewer'] as const

/**
 * The lookup-table identifiers the standalone review mode resolves under.
 * The review card and the closure must agree on them, or the card would bind
 * one policy set and the scope check would guard another.
 */
export const REVIEW_MODE_CONTEXT = {
  workflow: 'standalone',
  stage: 'review',
} as const

/**
 * Everything the review card pulls in: the policies resolved for the review
 * personas and the guidance those policies deliver. Computed from the current
 * checkout, so a policy the change adds is in the closure too.
 */
export interface ReviewClosure {
  /** policy id → repository path */
  policies: Record<string, string>
  /** guidance path → the policy id that delivers it */
  guidance: Record<string, string>
  /** Persona and projected-agent files for the review personas. */
  persona_paths: string[]
  /** Registries that select or project the above. */
  registry_paths: string[]
}

/**
 * A trailing `*` matches any suffix. An interior `*` matches one path segment,
 * so `tests/*\/*-helpers.ts` reaches every lane's helper without crossing into
 * deeper directories. No other glob syntax is supported.
 */
function matchesPattern(candidate: string, pattern: string): boolean {
  if (!pattern.includes('*')) {
    return candidate === pattern
  }

  const parts = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
  const body = parts.reduce((accumulated, part, index) => {
    if (index === 0) {
      return part
    }

    const trailing = index === parts.length - 1 && pattern.endsWith('*')

    return `${accumulated}${trailing ? '.*' : '[^/]*'}${part}`
  }, '')

  return new RegExp(`^${body}$`, 'u').test(candidate)
}

function matchesAny(
  candidate: string,
  patterns: readonly string[],
): string | null {
  return patterns.find((pattern) => matchesPattern(candidate, pattern)) ?? null
}

/** Instrument-tier paths within a changed-path set, sorted and deduplicated. */
export function reviewMachineryConflicts(changedPaths: string[]): string[] {
  const conflicts = changedPaths.filter(
    (candidate) => matchesAny(candidate, REVIEW_MACHINERY_PATTERNS) !== null,
  )

  return [...new Set(conflicts)].sort()
}

/** Build the card-derived closure for the review personas. */
export function buildReviewClosure(root: string): ReviewClosure {
  const policies: Record<string, string> = {}
  const guidance: Record<string, string> = {}

  for (const persona of REVIEW_PERSONAS) {
    const resolved = resolvePolicies(root, {
      persona,
      ...REVIEW_MODE_CONTEXT,
      contracts: [],
      operator_artifacts: 'suppressed',
    })

    for (const policy of resolved) {
      policies[policy.id] = `governance/policies/${policy.id}.json`

      for (const item of policy.guidance ?? []) {
        guidance[item.source_path] ??= policy.id
      }
    }
  }

  return {
    policies,
    guidance,
    persona_paths: REVIEW_PERSONAS.flatMap((persona) => [
      `library/personas/${persona}.md`,
      `library/cursor/agents/${persona}.md`,
    ]),
    registry_paths: [
      'governance/registries/policy_lookup_table.json',
      'governance/registries/projection_manifest.json',
    ],
  }
}

/**
 * Classify every changed path against the closure. Pure, so a test can hand
 * it a closure without a repository.
 */
export function classifyReviewPaths(
  changedPaths: string[],
  closure: ReviewClosure,
): ReviewConflict[] {
  const conflicts: ReviewConflict[] = []
  const seen = new Set<string>()
  const push = (path: string, tier: ConflictTier, source: string) => {
    if (seen.has(path)) {
      return
    }

    seen.add(path)
    conflicts.push({ path, tier, source })
  }
  const policyByPath = new Map(
    Object.entries(closure.policies).map(([id, path]) => [path, id]),
  )

  for (const path of [...new Set(changedPaths)].sort()) {
    const instrument = matchesAny(path, REVIEW_MACHINERY_PATTERNS)

    if (instrument !== null) {
      push(path, 'instrument', `review machinery (${instrument})`)
      continue
    }

    if (closure.persona_paths.includes(path)) {
      push(path, 'instrument', 'review persona or its projected agent')
      continue
    }

    const policyId = policyByPath.get(path)

    if (policyId) {
      push(path, 'conduct', `policy on the review card: ${policyId}`)
      continue
    }

    const deliveredBy = closure.guidance[path]

    if (deliveredBy) {
      push(path, 'conduct', `guidance delivered by ${deliveredBy}`)
      continue
    }

    if (closure.registry_paths.includes(path)) {
      push(
        path,
        'conduct',
        'registry that selects or projects review governance',
      )
      continue
    }

    const substrate = matchesAny(path, VERIFICATION_SUBSTRATE_PATTERNS)

    if (substrate !== null) {
      push(path, 'substrate', `verification substrate (${substrate})`)
    }
  }

  return conflicts
}

/** Per-policy instruction delta between two versions of a policy file. */
export interface StandardsDelta {
  policy: string
  path: string
  status: 'added' | 'removed' | 'changed'
  summary_changed: boolean
  removed_instructions: string[]
  added_instructions: string[]
  /**
   * Which side failed to parse as a policy record. A malformed file is a
   * defect to fix, never a wholesale instruction removal for the operator to
   * weigh, so the instruction lists stay empty when this is set.
   */
  malformed: 'base' | 'head' | 'both' | null
}

function policyFields(text: string | null): {
  id: string | null
  summary: string | null
  instructions: string[]
  parsed: boolean
} {
  if (text === null) {
    return { id: null, summary: null, instructions: [], parsed: true }
  }

  let value: unknown

  try {
    value = JSON.parse(text)
  } catch {
    return { id: null, summary: null, instructions: [], parsed: false }
  }

  if (!isRecord(value)) {
    return { id: null, summary: null, instructions: [], parsed: false }
  }

  return {
    parsed: true,
    id: typeof value.id === 'string' ? value.id : null,
    summary: typeof value.summary === 'string' ? value.summary : null,
    instructions: Array.isArray(value.instructions)
      ? value.instructions.filter(
          (item): item is string => typeof item === 'string',
        )
      : [],
  }
}

/**
 * What a change did to a standard, stated as the instructions it removed and
 * the instructions it added. Pure over the two texts.
 */
export function diffPolicyTexts(
  path: string,
  baseText: string | null,
  headText: string | null,
): StandardsDelta | null {
  if (baseText === headText) {
    return null
  }

  const base = policyFields(baseText)
  const head = policyFields(headText)
  const baseSet = new Set(base.instructions)
  const headSet = new Set(head.instructions)
  const malformed =
    !base.parsed && !head.parsed
      ? 'both'
      : !base.parsed
        ? 'base'
        : !head.parsed
          ? 'head'
          : null
  const policy =
    head.id ?? base.id ?? path.replace(/^.*\//u, '').replace(/\.json$/u, '')
  const status =
    baseText === null ? 'added' : headText === null ? 'removed' : 'changed'

  if (malformed) {
    return {
      policy,
      path,
      status,
      summary_changed: false,
      removed_instructions: [],
      added_instructions: [],
      malformed,
    }
  }

  const summaryChanged = base.summary !== head.summary
  const removed = base.instructions.filter((item) => !headSet.has(item))
  const added = head.instructions.filter((item) => !baseSet.has(item))

  // A row with nothing for the operator to weigh — a reformat, a metadata
  // edit — is not a standards delta. Only the instruction and summary text are.
  if (
    status === 'changed' &&
    !summaryChanged &&
    removed.length === 0 &&
    added.length === 0
  ) {
    return null
  }

  return {
    policy,
    path,
    status,
    summary_changed: summaryChanged,
    removed_instructions: removed,
    added_instructions: added,
    malformed: null,
  }
}

const REVIEW_MAPPING_KEYS = ['reviewer', 'shepherd-reviewer'] as const

function reviewMappings(text: string | null): string {
  if (text === null) {
    return ''
  }

  let value: unknown

  try {
    value = JSON.parse(text)
  } catch {
    return text
  }

  if (!isRecord(value)) {
    return text
  }

  const picked: Record<string, unknown> = {}
  const defaults = isRecord(value.defaults) ? value.defaults : {}

  for (const key of REVIEW_MAPPING_KEYS) {
    picked[`defaults.${key}`] = defaults[key]
  }

  if (isRecord(value.configs)) {
    // Key order in config.json is not a mapping change.
    for (const [name, config] of Object.entries(value.configs).sort(
      ([left], [right]) => left.localeCompare(right),
    )) {
      const personas =
        isRecord(config) && isRecord(config.personas) ? config.personas : {}

      for (const key of REVIEW_MAPPING_KEYS) {
        picked[`configs.${name}.personas.${key}`] = personas[key]
      }
    }
  }

  return JSON.stringify(picked)
}

/**
 * True when the change alters which model the reviewer or the coordinator
 * runs on. `config.json` changes constantly for other reasons, so this is
 * judged on the two mappings, not on the path.
 */
export function reviewerMappingChanged(
  baseConfig: string | null,
  headConfig: string | null,
): boolean {
  return reviewMappings(baseConfig) !== reviewMappings(headConfig)
}

export interface ReviewScope {
  base: string
  head: string
  /**
   * The working-tree revision the review closure was read from. The closure
   * resolves the review card from disk, so this is the checkout's HEAD; it
   * equals `head` unless the caller named the revision on purpose.
   */
  closure_revision: string
  /** Every path the three-dot diff changes. */
  changed_paths: string[]
  conflicts: ReviewConflict[]
  /**
   * True when no instrument-tier conflict exists: the squad can grade every
   * changed path, possibly under base conduct or with tainted verification.
   */
  independent: boolean
  /** True when no conflict exists at any tier. */
  clean: boolean
  standards_delta: StandardsDelta[]
}

export interface ResolveReviewScopeOptions {
  head: string
  /** Defaults to the merge base of `head` and the repository's default branch. */
  base?: string | null
  defaultBranch?: string | null
  /**
   * The revision the caller asserts the working tree sits at. Required when
   * that tree is not at `head`, so a closure read from another revision is
   * an explicit choice rather than an accident of which checkout ran the check.
   */
  closureRevision?: string | null
}

/**
 * Resolve one review target and report every conflict of interest it carries.
 *
 * The caller passes the target it already resolved; this does not guess a
 * target from the working tree, because the session states its range before
 * anything reads it.
 */
export function resolveReviewScope(
  root: string,
  options: ResolveReviewScopeOptions,
): ReviewScope {
  const head = gitRevParse(root, options.head)
  const base = options.base
    ? gitRevParse(root, options.base)
    : gitMergeBase(root, options.defaultBranch ?? 'main', head)
  // The closure comes from the working tree, so the tree must be the target
  // head or the caller must say which revision it is reading from instead.
  const closureRevision = gitRevParse(root, 'HEAD')

  if (closureRevision !== head) {
    invariant(
      options.closureRevision,
      `The review closure is read from the working tree at ` +
        `${closureRevision.slice(0, 12)}, which is not the target head ` +
        `${head.slice(0, 12)}. Run the scope check from the review ` +
        'workspace, or name the working-tree revision with --closure-revision.',
      { code: 'REVIEW_CLOSURE_REVISION_MISMATCH' },
    )
    invariant(
      gitRevParse(root, options.closureRevision) === closureRevision,
      `--closure-revision '${options.closureRevision}' does not resolve to ` +
        `the working tree HEAD ${closureRevision.slice(0, 12)}.`,
      { code: 'REVIEW_CLOSURE_REVISION_MISMATCH' },
    )
  }

  invariant(
    base,
    `No merge base between '${options.defaultBranch ?? 'main'}' and ` +
      `'${options.head}'. Pass an explicit base.`,
    { code: 'REVIEW_BASE_UNRESOLVED' },
  )

  // Both sides of a rename must appear: a renamed lineup file otherwise
  // leaves the instrument tier, and a renamed policy loses its removed half.
  const changedPaths = gitChangedPathsBetween(root, base, head, {
    detectRenames: false,
  })
  const conflicts = classifyReviewPaths(changedPaths, buildReviewClosure(root))

  if (
    changedPaths.includes('src/cli.ts') &&
    cliGovernanceBlocksChanged(
      gitShowFile(root, base, 'src/cli.ts'),
      gitShowFile(root, head, 'src/cli.ts'),
    )
  ) {
    conflicts.push({
      path: 'src/cli.ts',
      tier: 'instrument',
      source: 'governance card or review-scope entry point changed',
    })
  }

  if (
    changedPaths.includes('config.json') &&
    reviewerMappingChanged(
      gitShowFile(root, base, 'config.json'),
      gitShowFile(root, head, 'config.json'),
    )
  ) {
    conflicts.push({
      path: 'config.json',
      tier: 'instrument',
      source: 'reviewer or coordinator model mapping changed',
    })
  }

  const standardsDelta = changedPaths
    .filter((path) => /^governance\/policies\/[^/]+\.json$/u.test(path))
    .map((path) =>
      diffPolicyTexts(
        path,
        gitShowFile(root, base, path),
        gitShowFile(root, head, path),
      ),
    )
    .filter((delta): delta is StandardsDelta => delta !== null)

  conflicts.sort(
    (left, right) =>
      tierRank(left.tier) - tierRank(right.tier) ||
      left.path.localeCompare(right.path),
  )

  return {
    base,
    head,
    closure_revision: closureRevision,
    changed_paths: changedPaths,
    conflicts,
    independent: !conflicts.some((item) => item.tier === 'instrument'),
    clean: conflicts.length === 0,
    standards_delta: standardsDelta,
  }
}

function tierRank(tier: ConflictTier): number {
  return tier === 'instrument' ? 0 : tier === 'conduct' ? 1 : 2
}

/** Conflicts grouped by tier, for the CLI and the card. */
export function conflictsByTier(
  conflicts: ReviewConflict[],
): Record<ConflictTier, ReviewConflict[]> {
  return {
    instrument: conflicts.filter((item) => item.tier === 'instrument'),
    conduct: conflicts.filter((item) => item.tier === 'conduct'),
    substrate: conflicts.filter((item) => item.tier === 'substrate'),
  }
}

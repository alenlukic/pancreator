import { readdirSync } from 'node:fs'
import path from 'node:path'

import { isDirectory, isFile, isRecord, readJson, readText } from '../io.js'
import { loadPolicyCatalog } from '../policies.js'
import { loadWorkflow, workflowPersonaNames } from '../workflow.js'
import type { IntentClassifier } from './intent.js'
import {
  EDIT_ONLY_PATHS,
  facilitiesByPath,
  readStandaloneModes,
  type Facility,
} from './inventory.js'

/**
 * How a file that references a facility behaves when that facility is removed.
 *
 * The class decides two different things. Whether the reference blocks an
 * implicit cascade removal, and whether the referring file is repaired or
 * deleted. Code is the only class that blocks, because code that names a
 * facility stops compiling when the facility disappears and a human has to
 * decide what replaces it.
 *
 * `registry` covers a registration rather than a use. A lookup row, a model
 * mapping, and a string-keyed dispatch table all name every facility of their
 * kind by construction, so treating one as a use would immunize the whole
 * category. A registration proves a facility is wired in, never that anything
 * still reaches it, so liveness has to come from a resolution edge instead.
 */
export type ReferrerClass = 'code' | 'doc' | 'facility' | 'registry' | 'test'

export interface Reference {
  /** Repo-relative path of the file that carries the reference. */
  from: string
  referrer_class: ReferrerClass
  /** Facility that owns `from`, when one does. */
  owner_facility: string | null
  to: string
  /** Literal text that produced the edge, for the operator to spot-check. */
  token: string
  /**
   * Whether the referring text uses the facility rather than mentioning it.
   *
   * A typed edge and a code edge are always functional. A prose edge is
   * functional only when the intent classifier reads its line as a direction
   * to run, read, apply, or follow the facility. An index entry, a description,
   * and a passing mention stay in the graph so the closure can repair them,
   * but they neither keep a facility reachable nor block a cascade.
   */
  functional: boolean
}

export interface ReferenceGraph {
  references: Reference[]
  /** Facility id to the facilities it functionally references. */
  outgoing: Map<string, Set<string>>
  /** Facility id to every reference that reaches it. */
  incoming: Map<string, Reference[]>
}

export interface ReferenceGraphOptions {
  /**
   * Classifier for prose edges. Without one every prose edge counts as
   * functional, which is the older and more conservative reading.
   */
  readonly classifier?: IntentClassifier
}

/**
 * Files every agent reads in full before any card exists.
 *
 * A functional direction in one of these files keeps its target live even
 * though the file owns no facility node of its own.
 */
export const ALWAYS_READ_PATHS: readonly string[] = ['AGENTS.md']

const SCAN_ROOTS = ['bin', 'docs', 'governance', 'library', 'src', 'tests']

const SCAN_FILES = ['AGENTS.md', 'README.md']

const SCAN_EXTENSIONS = new Set(['.json', '.md', '.mdc', '.sh', '.ts'])

/**
 * Code that registers facilities in a string-keyed table instead of calling
 * them. The import is a registration, and the key is resolved at run time from
 * somewhere else, so the module is a registry rather than a caller.
 */
const DISPATCH_TABLE_PATHS = ['src/lib/requirements/handlers.ts']

const PAYLOAD_REGISTRY_PATHS = [
  'bin/install',
  'bin/install-support',
  'bin/update',
]

const DISPATCH_MARKER = '// debloat: dispatch'

const VALIDATION_REGISTRY_PATH =
  'governance/registries/validation_registry.json'

/**
 * Files that enumerate facilities. Counting one as a referrer would make every
 * facility of its kind look externally referenced, which would stop every
 * cascade. They are repaired instead, through the typed parsers below.
 *
 * `src/lib/requirements/handlers.ts` belongs here even though it is code. It
 * imports every validator solely to bind it to a handler id in one dispatch
 * table, so the import proves registration and nothing else. A validator is
 * live only when a policy requirement or a direct harness call resolves that
 * handler id, which `validatorResolutionReferences` below models.
 */
function isRegistryPath(relative: string): boolean {
  return (
    EDIT_ONLY_PATHS.includes(relative) ||
    DISPATCH_TABLE_PATHS.includes(relative) ||
    PAYLOAD_REGISTRY_PATHS.includes(relative) ||
    path.basename(relative) === 'index.md' ||
    relative.startsWith('governance/registries/')
  )
}

/**
 * Column of the dispatch marker on each line that carries one.
 *
 * The marker is a trailing comment, so it governs the references written
 * before it on its own line and nothing else in the file. Recording the column
 * rather than the line text is what bounds C-4: a file may register one
 * specifier in a dispatch table and import the same specifier for real a few
 * lines down, and the second occurrence has to keep blocking.
 */
function dispatchMarkerColumns(content: string): Map<number, number> {
  const columns = new Map<number, number>()

  content.split(/\r?\n/u).forEach((line, index) => {
    const column = line.indexOf(DISPATCH_MARKER)

    if (column >= 0) {
      columns.set(index, column)
    }
  })

  return columns
}

/** Offset at which each line of `content` starts. */
function lineStartOffsets(content: string): number[] {
  const starts = [0]
  let index = content.indexOf('\n')

  while (index >= 0) {
    starts.push(index + 1)
    index = content.indexOf('\n', index + 1)
  }

  return starts
}

function lineIndexOf(starts: readonly number[], offset: number): number {
  let low = 0
  let high = starts.length - 1

  while (low < high) {
    const middle = Math.ceil((low + high) / 2)

    if ((starts[middle] as number) <= offset) {
      low = middle
    } else {
      high = middle - 1
    }
  }

  return low
}

function referrerClass(relative: string, owned: boolean): ReferrerClass {
  if (isRegistryPath(relative)) {
    return 'registry'
  }

  if (owned) {
    return 'facility'
  }

  if (relative.startsWith('tests/')) {
    return 'test'
  }

  // Only executable source blocks a removal. Prose that ships beside the
  // facilities, such as the projected Cursor rule sources, is repaired like
  // any other document.
  if (relative.startsWith('src/') || relative.startsWith('bin/')) {
    return 'code'
  }

  return 'doc'
}

const LINE_COMMENT = /(^|[^:"'`\\])\/\/[^\n]*/gu

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//gu

/**
 * Source with its comments removed.
 *
 * A comment that names a facility is documentation, not a dependency. Left in,
 * one sentence of prose in a live module pins a facility that nothing calls:
 * a doc comment in the engine kept `ORCH-001` alive, and a comment in the
 * debloat scanner kept `persona:spotfixer` alive.
 *
 * A block comment is blanked rather than collapsed so every surviving
 * character keeps its line. The dispatch classifier reads the line of each
 * match, and a stripped newline would move a real import onto a marked line.
 */
function withoutComments(content: string): string {
  return content
    .replace(BLOCK_COMMENT, (match) => match.replace(/[^\n]/gu, ' '))
    .replace(LINE_COMMENT, (_match, prefix: string) => prefix)
}

function listTextFiles(root: string): string[] {
  const found: string[] = []

  const walk = (relative: string): void => {
    const absolute = path.join(root, relative)

    if (!isDirectory(absolute)) {
      return
    }

    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = relative ? `${relative}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        walk(child)
      } else if (
        entry.isFile() &&
        (SCAN_EXTENSIONS.has(path.extname(entry.name)) ||
          path.extname(entry.name) === '')
      ) {
        found.push(child)
      }
    }
  }

  for (const base of SCAN_ROOTS) {
    walk(base)
  }

  for (const file of SCAN_FILES) {
    if (isFile(path.join(root, file))) {
      found.push(file)
    }
  }

  return found.sort()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

const RELATIVE_IMPORT_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.\.?\/[^'"]+)['"]/gu

const MARKDOWN_LINK_PATTERN = /\]\(([^)\s#]+)(?:\s[^)]*)?\)/gu

/**
 * Repo-relative paths a file names through a specifier relative to itself.
 *
 * Two shapes matter and neither shares text with the target's repository
 * path. A sibling import reads `./refusals.js`, so a validator that only the
 * module beside it imports looks unreferenced. An index reads
 * `[spotfix.md](spotfix.md)`, so every skill index entry looks unreferenced
 * and a removal would leave the index listing a file that no longer exists.
 */
interface RelativeTarget {
  target: string
  /** Zero-based line of `content` that carried the specifier. */
  line: number
}

function relativeTargets(relative: string, content: string): RelativeTarget[] {
  const directory = path.posix.dirname(relative)
  const extension = path.posix.extname(relative)
  const starts = lineStartOffsets(content)
  const specifiers: Array<{ specifier: string; offset: number }> = []

  if (extension === '.ts') {
    for (const match of content.matchAll(RELATIVE_IMPORT_PATTERN)) {
      specifiers.push({
        specifier: match[1] as string,
        offset: match.index ?? 0,
      })
    }
  }

  if (extension === '.md' || extension === '.mdc') {
    for (const match of content.matchAll(MARKDOWN_LINK_PATTERN)) {
      const target = match[1] as string

      if (!/^[a-z][a-z0-9+.-]*:/iu.test(target)) {
        specifiers.push({ specifier: target, offset: match.index ?? 0 })
      }
    }
  }

  return specifiers.map(({ specifier, offset }) => {
    const resolved = path.posix.normalize(path.posix.join(directory, specifier))

    return {
      target: resolved.endsWith('.js')
        ? `${resolved.slice(0, -'.js'.length)}.ts`
        : resolved,
      line: lineIndexOf(starts, offset),
    }
  })
}

/**
 * Literal strings whose presence in a repository file means the file depends
 * on the facility.
 *
 * Every token is a path or a harness identifier rather than a bare name, so a
 * sentence that happens to contain the word cannot create an edge.
 */
function referenceTokens(entry: Facility): string[] {
  const tokens = [...entry.owned_paths]

  switch (entry.category) {
    case 'policy':
      tokens.push(entry.name)
      break
    case 'persona':
      tokens.push(`pan-${entry.name}`)
      break
    case 'command':
      tokens.push(entry.name)
      break
    case 'workflow':
      tokens.push(`library/workflows/${entry.name}`)
      break
    case 'mode':
      tokens.push(`--mode ${entry.name}`, `"card_mode": "${entry.name}"`)
      break
    case 'validator':
      tokens.push(`validators/${entry.name}.js`, `validators/${entry.name}.ts`)
      break
    case 'artifact-profile':
      tokens.push(`'${entry.name}'`, `"${entry.name}"`)
      break
    case 'cli-subcommand':
      tokens.push(`case '${entry.name}'`, `pan ${entry.name}`)
      break
    case 'criterion':
      tokens.push(entry.name)
      break
    case 'invocation':
      tokens.push(`'${entry.name}'`, `"${entry.name}"`)
      break
    case 'requirement':
      tokens.push(entry.name.split('/').at(-1) ?? entry.name)
      break
    case 'source-symbol':
      if (entry.source_symbol) {
        tokens.push(entry.source_symbol)
      }
      break
    case 'handbook':
    case 'orphan':
    case 'skill':
    case 'template':
      break
  }

  return [...new Set(tokens)]
}

function ownerOf(
  byPath: Map<string, Facility>,
  relative: string,
): Facility | null {
  const direct = byPath.get(relative)

  if (direct) {
    return direct
  }

  // A workflow owns its whole directory, including prompts and stage files.
  for (const [owned, facility] of byPath) {
    if (!owned.includes('.') && relative.startsWith(`${owned}/`)) {
      return facility
    }
  }

  return null
}

const IMPORT_BINDING_PATTERN =
  /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gu

const DISPATCH_ENTRY_PATTERN =
  /['"]([a-z0-9-]+)['"]\s*:\s*([A-Za-z_$][\w$]*)\s*,/gu

const REQUIREMENT_ID_PATTERN = /requirement_id:\s*['"]([a-z0-9-]+)['"]/gu

/**
 * Handler id to the validator facility its dispatch entry binds.
 *
 * Read from the dispatch table itself rather than from a hand-kept list, so a
 * new handler needs no change here. Two steps: the import bindings say which
 * module each symbol comes from, and the table says which symbol each handler
 * id maps to.
 */
function dispatchBindings(
  root: string,
  byPath: Map<string, Facility>,
): Map<string, string> {
  const bindings = new Map<string, string>()

  for (const relative of DISPATCH_TABLE_PATHS) {
    const absolute = path.join(root, relative)

    if (!isFile(absolute)) {
      continue
    }

    let content: string

    try {
      content = readText(absolute)
    } catch {
      continue
    }

    const directory = path.posix.dirname(relative)
    const symbolModule = new Map<string, string>()

    for (const match of content.matchAll(IMPORT_BINDING_PATTERN)) {
      const specifier = match[2] as string

      if (!specifier.startsWith('.')) {
        continue
      }

      const resolved = path.posix.normalize(
        path.posix.join(directory, specifier),
      )
      const modulePath = resolved.endsWith('.js')
        ? `${resolved.slice(0, -'.js'.length)}.ts`
        : resolved
      const facility = byPath.get(modulePath)

      if (!facility) {
        continue
      }

      for (const binding of (match[1] as string).split(',')) {
        const symbol = binding
          .trim()
          .split(/\s+as\s+/u)
          .pop()
          ?.trim()

        if (symbol) {
          symbolModule.set(symbol, facility.id)
        }
      }
    }

    for (const match of content.matchAll(DISPATCH_ENTRY_PATTERN)) {
      const facilityId = symbolModule.get(match[2] as string)

      if (facilityId) {
        bindings.set(match[1] as string, facilityId)
      }
    }
  }

  return bindings
}

/**
 * Edges that prove a registered validator is actually reached.
 *
 * A validator's import into the dispatch table is a registration, so liveness
 * has to come from whatever resolves its handler id. Two things do. A policy
 * requirement names a registry entry whose handler is that id, and harness
 * code can synthesize the requirement directly. Without these edges every
 * validator looks permanently live; with them, one whose handler nothing
 * resolves becomes a removal candidate.
 */
function validatorResolutionReferences(
  root: string,
  byPath: Map<string, Facility>,
  ids: ReadonlySet<string>,
): Reference[] {
  const bindings = dispatchBindings(root, byPath)

  if (bindings.size === 0) {
    return []
  }

  const registryPath = path.join(root, VALIDATION_REGISTRY_PATH)
  const registry = isFile(registryPath) ? readJson(registryPath) : null
  const handlerByEntry = new Map<string, string>()

  if (isRecord(registry) && Array.isArray(registry.entries)) {
    for (const entry of registry.entries) {
      if (
        isRecord(entry) &&
        typeof entry.id === 'string' &&
        typeof entry.handler === 'string'
      ) {
        handlerByEntry.set(entry.id, entry.handler)
      }
    }
  }

  const references: Reference[] = []

  for (const policy of loadPolicyCatalog(root).values()) {
    for (const requirement of policy.requirements ?? []) {
      const handler = handlerByEntry.get(requirement.registry_id)
      const target = handler ? bindings.get(handler) : undefined

      if (!target || !ids.has(target)) {
        continue
      }

      references.push({
        from: `governance/policies/${policy.id}.json`,
        referrer_class: 'facility',
        owner_facility: `requirement:${policy.id}/${requirement.id}`,
        to: target,
        token: requirement.registry_id,
        functional: true,
      })
    }
  }

  // Harness code can name a handler id directly instead of resolving one
  // through a policy. That call is a real use, so it blocks like other code.
  // An enumerating module is not skipped here: naming a handler id is a
  // resolution whatever else the file does, and `src/lib/validation.ts`
  // synthesizes exactly one requirement this way.
  for (const relative of listTextFiles(root)) {
    if (path.extname(relative) !== '.ts' || relative.startsWith('tests/')) {
      continue
    }

    let content: string

    try {
      content = withoutComments(readText(path.join(root, relative)))
    } catch {
      continue
    }

    for (const match of content.matchAll(REQUIREMENT_ID_PATTERN)) {
      const target = bindings.get(match[1] as string)

      if (!target || !ids.has(target)) {
        continue
      }

      references.push({
        from: relative,
        referrer_class: 'code',
        owner_facility: null,
        to: target,
        token: match[1] as string,
        functional: true,
      })
    }
  }

  return references
}

function typedReferences(
  root: string,
  facilities: readonly Facility[],
): Reference[] {
  const ids = new Set(facilities.map((entry) => entry.id))
  const references: Reference[] = []

  const add = (
    from: string,
    ownerFacility: string | null,
    to: string,
    token: string,
  ): void => {
    if (!ids.has(to) || ownerFacility === to) {
      return
    }

    references.push({
      from,
      referrer_class: ownerFacility ? 'facility' : 'registry',
      owner_facility: ownerFacility,
      to,
      token,
      functional: true,
    })
  }

  // A registry row names a facility by bare name, which is deliberately not a
  // scan token: `hypervisor` on its own matches ordinary prose. Recording the
  // row here is what puts the registry into the closure's edit list, so a
  // removed persona does not leave an orphan lookup row behind.
  const back = (from: string, to: string, token: string): void => {
    if (ids.has(to)) {
      references.push({
        from,
        referrer_class: 'registry',
        owner_facility: null,
        to,
        token,
        functional: false,
      })
    }
  }

  // A policy names its guidance document, which is the only structured edge
  // that reaches a skill or a handbook.
  for (const policy of loadPolicyCatalog(root).values()) {
    const from = `governance/policies/${policy.id}.json`

    for (const requirement of policy.requirements ?? []) {
      const requirementId = `requirement:${policy.id}/${requirement.id}`

      add(from, `policy:${policy.id}`, requirementId, requirement.id)

      if (requirement.applicability?.invocation_kind) {
        add(
          from,
          `invocation:${requirement.applicability.invocation_kind}`,
          requirementId,
          requirement.applicability.invocation_kind,
        )
      }
    }

    for (const guidance of policy.guidance ?? []) {
      const target = facilities.find((entry) =>
        entry.owned_paths.includes(guidance.source_path),
      )

      if (target) {
        add(from, `policy:${policy.id}`, target.id, guidance.source_path)
      }
    }
  }

  // The lookup table binds a persona, a workflow, or a stage to the policies
  // a run resolves for it. A wildcard row is universal, so it anchors the
  // policy to the registry rather than to any one facility.
  const lookupPath = 'governance/registries/policy_lookup_table.json'
  const lookup = isFile(path.join(root, lookupPath))
    ? readJson(path.join(root, lookupPath))
    : null

  if (isRecord(lookup) && Array.isArray(lookup.rows)) {
    for (const row of lookup.rows) {
      if (!isRecord(row) || !Array.isArray(row.policies)) {
        continue
      }

      const owners: string[] = []

      if (typeof row.persona === 'string' && row.persona !== '*') {
        owners.push(`persona:${row.persona}`)
        back(lookupPath, `persona:${row.persona}`, row.persona)
      }

      if (typeof row.workflow === 'string' && row.workflow !== '*') {
        owners.push(`workflow:${row.workflow}`)
        back(lookupPath, `workflow:${row.workflow}`, row.workflow)
      }

      for (const policy of row.policies) {
        if (typeof policy !== 'string') {
          continue
        }

        if (owners.length === 0) {
          add(lookupPath, null, `policy:${policy}`, policy)
          continue
        }

        for (const owner of owners) {
          add(lookupPath, owner, `policy:${policy}`, policy)
        }
      }
    }
  }

  // A command resolves its card from a mode.
  const governancePath = 'governance/registries/command_governance.json'
  const governance = isFile(path.join(root, governancePath))
    ? readJson(path.join(root, governancePath))
    : null

  if (isRecord(governance)) {
    for (const entries of Object.values(governance)) {
      if (!Array.isArray(entries)) {
        continue
      }

      for (const entry of entries) {
        const command =
          typeof entry === 'string'
            ? entry
            : isRecord(entry) && typeof entry.command === 'string'
              ? entry.command
              : null

        if (!command) {
          continue
        }

        back(governancePath, `command:${command}`, command)

        if (isRecord(entry) && typeof entry.card_mode === 'string') {
          add(
            governancePath,
            `command:${command}`,
            `mode:${entry.card_mode}`,
            entry.card_mode,
          )
        }
      }
    }
  }

  // A standalone mode names the persona and workflow its card binds.
  const modeRegistry = 'src/lib/governance-card.ts'

  for (const definition of readStandaloneModes(root)) {
    back(modeRegistry, `mode:${definition.name}`, definition.name)

    if (definition.kind) {
      add(
        modeRegistry,
        `mode:${definition.name}`,
        `invocation:${definition.kind}`,
        definition.kind,
      )

      add(
        modeRegistry,
        `invocation:${definition.kind}`,
        `artifact-profile:${definition.kind}`,
        definition.kind,
      )
    }

    if (definition.persona) {
      add(
        modeRegistry,
        `mode:${definition.name}`,
        `persona:${definition.persona}`,
        definition.persona,
      )
    }

    if (definition.workflow) {
      add(
        modeRegistry,
        `mode:${definition.name}`,
        `workflow:${definition.workflow}`,
        definition.workflow,
      )
    }
  }

  // Every persona the executor can run carries a model mapping.
  const configPath = 'config.json'
  const config = isFile(path.join(root, configPath))
    ? readJson(path.join(root, configPath))
    : null

  if (isRecord(config) && isRecord(config.defaults)) {
    for (const persona of Object.keys(config.defaults)) {
      back(configPath, `persona:${persona}`, persona)
    }
  }

  // A workflow names the persona each of its stages runs under.
  for (const entry of facilities) {
    if (entry.category !== 'workflow' || !entry.path) {
      continue
    }

    let personas: string[] = []

    try {
      personas = workflowPersonaNames(loadWorkflow(root, entry.name))
    } catch {
      // A workflow the loader rejects contributes no typed edge. The literal
      // scan below still reads its files.
      personas = []
    }

    for (const persona of personas) {
      add(entry.path, entry.id, `persona:${persona}`, persona)
    }
  }

  const artifactProfile = (stage: string): string => {
    switch (stage) {
      case 'intake':
      case 'plan':
      case 'review':
      case 'design':
      case 'handoff':
        return stage
      case 'test':
        return 'qa'
      case 'ship':
        return 'release'
      case 'inspect':
        return 'inspection'
      default:
        return 'implementation'
    }
  }

  for (const relative of listTextFiles(root).filter(
    (entry) =>
      entry.startsWith('library/workflows/') &&
      entry.includes('/stages/') &&
      entry.endsWith('.json'),
  )) {
    const stage = readJson(path.join(root, relative))

    if (
      !isRecord(stage) ||
      typeof stage.slug !== 'string' ||
      !Array.isArray(stage.criteria)
    ) {
      continue
    }

    const workflow = relative.split('/')[2]
    const owner = workflow ? `workflow:${workflow}` : null

    if (!owner) {
      continue
    }

    add(
      relative,
      owner,
      `artifact-profile:${artifactProfile(stage.slug)}`,
      artifactProfile(stage.slug),
    )

    for (const criterion of stage.criteria) {
      if (isRecord(criterion) && typeof criterion.id === 'string') {
        add(relative, owner, `criterion:${criterion.id}`, criterion.id)
      }
    }
  }

  for (const entry of facilities) {
    if (entry.category !== 'command' || !entry.name.startsWith('pan-')) {
      continue
    }

    const subcommand = entry.name.slice('pan-'.length)

    add(
      entry.path ?? 'src/lib/pan-command-grammar.ts',
      entry.id,
      `cli-subcommand:${subcommand}`,
      subcommand,
    )
  }

  for (const entry of facilities) {
    if (entry.category === 'source-symbol' && entry.owner_facility) {
      add(
        entry.path ?? 'src',
        entry.owner_facility,
        entry.id,
        entry.source_symbol ?? entry.name,
      )
    }
  }

  return references
}

/**
 * Build the directed reference graph over every facility.
 *
 * Typed edges come first, because a registry row and a workflow stage carry
 * exact structure that a text scan can only approximate. The literal scan then
 * adds every prose reference, which is how a command reaches the skill it
 * tells an agent to read.
 */
export function buildReferenceGraph(
  root: string,
  facilities: readonly Facility[],
  options: ReferenceGraphOptions = {},
): ReferenceGraph {
  const classifier = options.classifier
  const byPath = facilitiesByPath(facilities)
  const byId = new Map(facilities.map((entry) => [entry.id, entry]))
  const tokenOwners = new Map<string, string[]>()

  for (const entry of facilities) {
    for (const token of referenceTokens(entry)) {
      const owners = tokenOwners.get(token)

      if (owners) {
        owners.push(entry.id)
      } else {
        tokenOwners.set(token, [entry.id])
      }
    }
  }

  const tokens = [...tokenOwners.keys()].sort(
    (left, right) => right.length - left.length,
  )
  const references: Reference[] = [
    ...typedReferences(root, facilities),
    ...validatorResolutionReferences(
      root,
      byPath,
      new Set(facilities.map((entry) => entry.id)),
    ),
  ]

  if (tokens.length > 0) {
    const pattern = new RegExp(
      `(?<![A-Za-z0-9_-])(?:${tokens.map(escapeRegExp).join('|')})(?![A-Za-z0-9_-])`,
      'gu',
    )

    for (const relative of listTextFiles(root)) {
      let rawContent: string

      try {
        rawContent = readText(path.join(root, relative))
      } catch {
        continue
      }

      let content = rawContent

      if (path.extname(relative) === '.ts') {
        content = withoutComments(content)
      }

      const owner = ownerOf(byPath, relative)
      const ownerId = owner?.id ?? null
      const carrierClass = referrerClass(relative, owner !== null)
      const markerColumns = dispatchMarkerColumns(rawContent)
      const lineStarts = lineStartOffsets(content)
      const contentLines = content.split(/\r?\n/u)
      const emitted = new Set<string>()
      // Code uses what it names, and a registration or a test never does. A
      // prose line is read by the classifier: a direction to run, read, or
      // apply the facility is functional, and anything else is a mention the
      // closure repairs without treating it as a dependency.
      const isFunctional = (
        referenceClass: ReferrerClass,
        line: number,
      ): boolean => {
        switch (referenceClass) {
          case 'code':
            return true
          case 'registry':
          case 'test':
            return false
          case 'doc':
          case 'facility':
            return classifier
              ? classifier.classify(contentLines[line] ?? '').functional
              : true
        }
      }
      const emit = (
        to: string,
        token: string,
        dispatched: boolean,
        line: number,
        selectableOverride = false,
      ): void => {
        const referenceClass: ReferrerClass =
          dispatched || selectableOverride ? 'registry' : carrierClass
        const functional = isFunctional(referenceClass, line)
        const key = `${token}\u0000${to}\u0000${referenceClass}\u0000${functional}`

        if (emitted.has(key)) {
          return
        }

        emitted.add(key)
        references.push({
          from: relative,
          referrer_class: referenceClass,
          owner_facility: ownerId,
          to,
          token,
          functional,
        })
      }
      // The marker is compared against the occurrence's own column, so the
      // same token may produce both a registry edge and a blocking code edge
      // from one file.
      const dispatchedAt = (offset: number): boolean => {
        const line = lineIndexOf(lineStarts, offset)
        const column = markerColumns.get(line)

        return (
          column !== undefined && offset - (lineStarts[line] as number) < column
        )
      }

      for (const match of content.matchAll(pattern)) {
        const token = match[0]
        const offset = match.index ?? 0
        const dispatched = dispatchedAt(offset)
        const line = lineIndexOf(lineStarts, offset)

        for (const target of tokenOwners.get(token) ?? []) {
          if (target === ownerId) {
            continue
          }

          emit(
            target,
            token,
            dispatched,
            line,
            byId.get(target)?.selectable === false,
          )
        }
      }

      const targetsOfLines = (marked: boolean): RelativeTarget[] =>
        relativeTargets(
          relative,
          contentLines
            .map((line, index) => {
              const column = markerColumns.get(index)

              if ((column !== undefined) !== marked) {
                return ''
              }

              return column === undefined ? line : line.slice(0, column)
            })
            .join('\n'),
        )

      for (const marked of [true, false]) {
        for (const { target, line } of targetsOfLines(marked)) {
          const resolved = byPath.get(target)

          if (!resolved || resolved.id === ownerId) {
            continue
          }

          emit(resolved.id, target, marked, line)
        }
      }
    }
  }

  const outgoing = new Map<string, Set<string>>()
  const incoming = new Map<string, Reference[]>()

  for (const entry of facilities) {
    outgoing.set(entry.id, new Set())
    incoming.set(entry.id, [])
  }

  for (const reference of references) {
    incoming.get(reference.to)?.push(reference)

    if (reference.owner_facility && reference.functional) {
      outgoing.get(reference.owner_facility)?.add(reference.to)
    }
  }

  return { references, outgoing, incoming }
}

/**
 * Facilities a functional direction in an always-read file names.
 *
 * `AGENTS.md` owns no facility, so its edges never enter `outgoing`. Every
 * agent reads it in full, though, so a direction it carries is a live use.
 */
export function alwaysReadTargets(graph: ReferenceGraph): Set<string> {
  const targets = new Set<string>()

  for (const reference of graph.references) {
    if (reference.functional && ALWAYS_READ_PATHS.includes(reference.from)) {
      targets.add(reference.to)
    }
  }

  return targets
}

/**
 * Files that still name any of the given facilities, keyed by file.
 *
 * This exists for verification after a removal, where `buildReferenceGraph`
 * cannot help: it inventories the tree, so a facility whose definition is gone
 * has no node and every reference to it silently disappears. Here the facility
 * records come from the session, so a leftover reference to a deleted file is
 * still found.
 */
export function findReferences(
  root: string,
  facilities: readonly Facility[],
): Map<string, Set<string>> {
  const tokenOwners = new Map<string, string[]>()
  const pathOwners = new Map<string, string>()

  for (const entry of facilities) {
    for (const owned of entry.owned_paths) {
      pathOwners.set(owned, entry.id)
    }

    for (const token of referenceTokens(entry)) {
      const owners = tokenOwners.get(token)

      if (owners) {
        owners.push(entry.id)
      } else {
        tokenOwners.set(token, [entry.id])
      }
    }
  }

  const tokens = [...tokenOwners.keys()].sort(
    (left, right) => right.length - left.length,
  )
  const found = new Map<string, Set<string>>()

  if (tokens.length === 0) {
    return found
  }

  const pattern = new RegExp(
    `(?<![A-Za-z0-9_-])(?:${tokens.map(escapeRegExp).join('|')})(?![A-Za-z0-9_-])`,
    'gu',
  )

  for (const relative of listTextFiles(root)) {
    let content: string

    try {
      content = readText(path.join(root, relative))
    } catch {
      continue
    }

    const matched = new Set<string>()

    for (const match of content.matchAll(pattern)) {
      for (const owner of tokenOwners.get(match[0]) ?? []) {
        matched.add(owner)
      }
    }

    for (const { target } of relativeTargets(relative, content)) {
      const owner = pathOwners.get(target)

      if (owner) {
        matched.add(owner)
      }
    }

    if (matched.size > 0) {
      found.set(relative, matched)
    }
  }

  return found
}

/**
 * Facilities reachable from a set of roots by following references.
 *
 * The scan uses this to separate a facility that is genuinely idle from one
 * that no run record names but a live facility still depends on.
 */
export function reachableFrom(
  graph: ReferenceGraph,
  roots: Iterable<string>,
): Set<string> {
  const reached = new Set<string>()
  const queue = [...roots]

  while (queue.length > 0) {
    const current = queue.pop() as string

    for (const next of graph.outgoing.get(current) ?? []) {
      if (!reached.has(next)) {
        reached.add(next)
        queue.push(next)
      }
    }
  }

  return reached
}

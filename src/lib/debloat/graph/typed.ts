/**
 * Typed reference edges: registry rows, workflow stages, dispatch bindings,
 * and validator resolutions.
 */

import path from 'node:path'

import { isFile, isRecord, readJson, readText } from '../../io.js'
import { loadPolicyCatalog } from '../../policies.js'
import { loadWorkflow, workflowPersonaNames } from '../../workflow.js'
import { readStandaloneModes, type Facility } from '../inventory.js'
import type { Reference } from './model.js'
import { DISPATCH_TABLE_PATHS, listTextFiles, withoutComments } from './scan.js'

const VALIDATION_REGISTRY_PATH =
  'governance/registries/validation_registry.json'

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
export function validatorResolutionReferences(
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
  // resolution whatever else the file does, and
  // `src/lib/validation/repository.ts` synthesizes exactly one requirement
  // this way.
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

export function typedReferences(
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

import path from 'node:path'

import { invariant } from '../errors.js'
import { PROTECTED_PATHS, type Facility } from './inventory.js'
import type { Reference, ReferenceGraph, ReferrerClass } from './graph.js'
import type { SymbolIndex } from './symbols.js'

export interface RemovalEntry {
  path: string
  kind: 'facility_definition' | 'dedicated_test'
  /** Facility whose removal takes this path with it. */
  facility_id: string
  reason: string
}

export interface EditEntry {
  path: string
  referrer_class: ReferrerClass
  /** Removed facilities this file still names. */
  references: string[]
  reason: string
}

export interface RetainedEntry {
  facility_id: string
  retained_by: Array<{ path: string; referrer_class: ReferrerClass }>
  reason: string
}

export interface FreedEntry {
  kind: 'path' | 'symbol'
  path: string
  symbol?: string
  /** Removed path or facility whose departure stranded this entry. */
  stranded_by: string
}

export interface CandidatePreview {
  facility_id: string
  cascaded: string[]
  freed: FreedEntry[]
  remove_count: number
  edit_count: number
}

export interface ClosureRecord {
  schema_version: 1
  session_id: string
  computed_at: string
  /** Exactly what the operator selected. Never widened. */
  selected: string[]
  /** Facilities the exclusive-reference cascade added to the selection. */
  cascaded: string[]
  /** Everything that comes out: selection plus cascade, sorted. */
  removed_facilities: string[]
  remove: RemovalEntry[]
  edit: EditEntry[]
  /** Source paths and symbols no surviving module references. */
  freed: FreedEntry[]
  retained_because: RetainedEntry[]
  /** Residual false-positive classes a static graph cannot decide. */
  adjudication_required: string[]
}

/**
 * The three reference kinds the graph provably cannot see. Each one produces a
 * removal the closure believes is safe and is not, so the agent inspects them
 * before deleting anything.
 */
export const ADJUDICATION_CATEGORIES: readonly string[] = [
  'Dynamically constructed paths. A TypeScript expression such as ' +
    '`path.join(dir, `${persona}.md`)` produces no literal edge, so a ' +
    'facility it reaches looks unreferenced. Search the removal set for ' +
    'template-literal and variable path construction before deleting.',
  'Semantic references. A file or transcript that names a facility in prose ' +
    'without writing its path or id produces no edge. Read each removed ' +
    "facility's neighbors for descriptions that stand in for its name.",
  'Untitled test coupling. A test can exercise a facility without naming its ' +
    'path, so it is neither a dedicated test nor an edit. Run the full suite ' +
    'after removal and attribute every failure before accepting the closure.',
]

function isBlocking(
  reference: Reference,
  removed: ReadonlySet<string>,
): boolean {
  switch (reference.referrer_class) {
    case 'code':
      // Code that names a facility stops compiling without it, and no
      // cascade may decide on its behalf what replaces the reference.
      return true
    case 'facility':
      // A surviving facility blocks only when it uses the target. A line that
      // merely names it is repaired by the closure like any other mention.
      return (
        reference.functional &&
        reference.owner_facility !== null &&
        !removed.has(reference.owner_facility)
      )
    case 'doc':
    case 'registry':
    case 'test':
      return false
  }
}

/**
 * Grow the operator selection to everything it exclusively owns.
 *
 * A facility joins the removal set only when a removed facility references it
 * and nothing that survives does. The loop repeats because removing a facility
 * can strand the next one: a command's skill, then that skill's handbook.
 */
function cascade(
  facilities: readonly Facility[],
  graph: ReferenceGraph,
  selected: readonly string[],
): { removed: Set<string>; retained: RetainedEntry[] } {
  const removed = new Set(selected)
  const retained = new Map<string, RetainedEntry>()
  let changed = true

  while (changed) {
    changed = false
    retained.clear()

    for (const facility of facilities) {
      if (removed.has(facility.id) || facility.protected) {
        continue
      }

      const references = graph.incoming.get(facility.id) ?? []
      const strandedBy = references.filter(
        (reference) =>
          reference.owner_facility !== null &&
          removed.has(reference.owner_facility),
      )

      if (strandedBy.length === 0) {
        continue
      }

      const blocking = references.filter((reference) =>
        isBlocking(reference, removed),
      )

      if (blocking.length === 0) {
        removed.add(facility.id)
        changed = true
        continue
      }

      retained.set(facility.id, {
        facility_id: facility.id,
        retained_by: [
          ...new Map(
            blocking.map((reference) => [
              reference.from,
              {
                path: reference.from,
                referrer_class: reference.referrer_class,
              },
            ]),
          ).values(),
        ].sort((left, right) => left.path.localeCompare(right.path)),
        reason:
          'A removed facility references it, but so does something that ' +
          'survives, so it stays.',
      })
    }
  }

  return {
    removed,
    retained: [...retained.values()].sort((left, right) =>
      left.facility_id.localeCompare(right.facility_id),
    ),
  }
}

/**
 * Test files whose every facility reference is removed.
 *
 * A test that only ever exercised removed facilities has nothing left to
 * assert, so it leaves with them. A test that also touches a survivor is an
 * edit instead, because deleting it would drop live coverage.
 */
function dedicatedTests(
  graph: ReferenceGraph,
  removed: ReadonlySet<string>,
): Map<string, string> {
  const byFile = new Map<string, Set<string>>()

  for (const reference of graph.references) {
    if (reference.referrer_class !== 'test') {
      continue
    }

    const existing = byFile.get(reference.from)

    if (existing) {
      existing.add(reference.to)
    } else {
      byFile.set(reference.from, new Set([reference.to]))
    }
  }

  const dedicated = new Map<string, string>()

  for (const [file, targets] of byFile) {
    const removedTargets = [...targets].filter((target) => removed.has(target))

    if (removedTargets.length === 0 || removedTargets.length !== targets.size) {
      continue
    }

    dedicated.set(file, removedTargets.sort()[0] as string)
  }

  return dedicated
}

export interface ComputeClosureOptions {
  readonly sessionId: string
  readonly now?: Date
  readonly symbolIndex?: SymbolIndex
}

function pathOwner(
  facilities: readonly Facility[],
  relative: string,
): string | null {
  for (const facility of facilities) {
    if (
      facility.owned_paths.some(
        (owned) =>
          owned === relative ||
          (!path.posix.extname(owned) && relative.startsWith(`${owned}/`)),
      )
    ) {
      return facility.id
    }
  }

  return null
}

function computeFreed(
  facilities: readonly Facility[],
  removed: ReadonlySet<string>,
  removedPaths: ReadonlySet<string>,
  index: SymbolIndex | undefined,
): FreedEntry[] {
  if (!index) {
    return []
  }

  const removedFile = (relative: string): boolean => {
    if (removedPaths.has(relative)) {
      return true
    }

    const owner = pathOwner(facilities, relative)

    return owner !== null && removed.has(owner)
  }
  const freed: FreedEntry[] = []

  for (const declaration of index.declarations) {
    if (removedFile(declaration.file)) {
      continue
    }

    const uses = index.uses.filter(
      (entry) => entry.symbol_id === declaration.id,
    )
    const stranded = uses.filter((entry) => removedFile(entry.from))
    const surviving = uses.filter((entry) => !removedFile(entry.from))

    if (stranded.length > 0 && surviving.length === 0) {
      freed.push({
        kind: 'symbol',
        path: declaration.file,
        symbol: declaration.name,
        stranded_by: stranded[0]?.from ?? 'removed facility',
      })
    }
  }

  for (const file of index.graph.files.filter((entry) =>
    entry.startsWith('src/'),
  )) {
    if (removedFile(file)) {
      continue
    }

    const importers = [...(index.graph.dependents.get(file) ?? [])]
    const stranded = importers.filter(removedFile)
    const surviving = importers.filter((entry) => !removedFile(entry))

    if (stranded.length > 0 && surviving.length === 0) {
      freed.push({
        kind: 'path',
        path: file,
        stranded_by: stranded[0] ?? 'removed facility',
      })
    }
  }

  return [
    ...new Map(
      freed.map((entry) => [
        `${entry.kind}:${entry.path}:${entry.symbol ?? ''}`,
        entry,
      ]),
    ).values(),
  ].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      (left.symbol ?? '').localeCompare(right.symbol ?? ''),
  )
}

/**
 * Turn an operator selection into an exact removal manifest.
 *
 * The split between `remove` and `edit` is the important one. A facility
 * definition is deleted; a registry row, a doc sentence, and a code reference
 * are repaired. Collapsing the two would either orphan a registry or delete a
 * file that enumerates dozens of surviving facilities.
 */
export function computeClosure(
  facilities: readonly Facility[],
  graph: ReferenceGraph,
  selected: readonly string[],
  options: ComputeClosureOptions,
): ClosureRecord {
  const byId = new Map(facilities.map((entry) => [entry.id, entry]))

  for (const id of selected) {
    const facility = byId.get(id)

    invariant(facility, `Unknown facility in selection: ${id}`, {
      code: 'DEBLOAT_SELECTION_INVALID',
    })
    invariant(
      !facility.protected,
      `Facility '${id}' is protected and cannot be removed: ` +
        `${facility.protected_reason ?? ''}`.trim(),
      { code: 'DEBLOAT_FACILITY_PROTECTED' },
    )
    invariant(
      facility.selectable,
      `Facility '${id}' is a derived graph node.`,
      {
        code: 'DEBLOAT_SELECTION_INVALID',
      },
    )
  }

  const { removed, retained } = cascade(facilities, graph, selected)
  const protectedPaths = new Set(PROTECTED_PATHS)
  const remove: RemovalEntry[] = []

  for (const id of [...removed].sort()) {
    const facility = byId.get(id)

    if (!facility) {
      continue
    }

    for (const owned of facility.owned_paths) {
      invariant(
        !protectedPaths.has(owned),
        `Closure reached a protected path: ${owned}`,
        { code: 'DEBLOAT_PROTECTED_PATH' },
      )

      remove.push({
        path: owned,
        kind: 'facility_definition',
        facility_id: id,
        reason: `Defines ${id}.`,
      })
    }
  }

  for (const [file, facilityId] of [...dedicatedTests(graph, removed)].sort()) {
    remove.push({
      path: file,
      kind: 'dedicated_test',
      facility_id: facilityId,
      reason: 'Every facility this test references is removed.',
    })
  }

  for (const id of [...removed].sort()) {
    const facility = byId.get(id)

    if (facility?.node_kind !== 'orphan') {
      continue
    }

    for (const test of facility.dedicated_tests ?? []) {
      remove.push({
        path: test,
        kind: 'dedicated_test',
        facility_id: id,
        reason: 'This test exercises only the selected orphan.',
      })
    }
  }

  const removedPaths = new Set(remove.map((entry) => entry.path))
  // A workflow is removed by its directory, so every file beneath it leaves
  // too and must not also be reported as an edit.
  const removedPrefixes = [...removedPaths]
    .filter((entry) => !path.extname(entry))
    .map((entry) => `${entry}/`)
  const edits = new Map<string, EditEntry>()

  for (const id of [...removed].sort()) {
    const facility = byId.get(id)

    if (
      facility?.node_kind !== 'orphan' ||
      facility.orphan_kind === 'unused_file' ||
      !facility.path
    ) {
      continue
    }

    edits.set(facility.path, {
      path: facility.path,
      referrer_class: 'code',
      references: [id],
      reason: `Remove orphaned export ${facility.source_symbol ?? facility.name}.`,
    })
  }

  for (const reference of graph.references) {
    if (!removed.has(reference.to) || removedPaths.has(reference.from)) {
      continue
    }

    if (removedPrefixes.some((prefix) => reference.from.startsWith(prefix))) {
      continue
    }

    const existing = edits.get(reference.from)

    if (existing) {
      if (!existing.references.includes(reference.to)) {
        existing.references.push(reference.to)
      }
      continue
    }

    edits.set(reference.from, {
      path: reference.from,
      referrer_class: reference.referrer_class,
      references: [reference.to],
      reason:
        reference.referrer_class === 'registry'
          ? 'Registry row or index entry names a removed facility.'
          : 'Survives the removal but still names a removed facility.',
    })
  }

  const edit = [...edits.values()]
    .map((entry) => ({ ...entry, references: entry.references.sort() }))
    .sort((left, right) => left.path.localeCompare(right.path))

  return {
    schema_version: 1,
    session_id: options.sessionId,
    computed_at: (options.now ?? new Date()).toISOString(),
    selected: [...selected].sort(),
    cascaded: [...removed].filter((id) => !selected.includes(id)).sort(),
    removed_facilities: [...removed].sort(),
    remove: remove.sort((left, right) => left.path.localeCompare(right.path)),
    edit,
    freed: computeFreed(
      facilities,
      removed,
      new Set(remove.map((entry) => entry.path)),
      options.symbolIndex,
    ),
    retained_because: retained,
    adjudication_required: [...ADJUDICATION_CATEGORIES],
  }
}

/** Preview one candidate with the same closure implementation used by impact. */
export function previewCandidate(
  facilities: readonly Facility[],
  graph: ReferenceGraph,
  facilityId: string,
  options: ComputeClosureOptions,
): CandidatePreview {
  const closure = computeClosure(facilities, graph, [facilityId], options)

  return {
    facility_id: facilityId,
    cascaded: closure.cascaded,
    freed: closure.freed,
    remove_count: closure.remove.length,
    edit_count: closure.edit.length,
  }
}

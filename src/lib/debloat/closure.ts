import path from 'node:path'

import { invariant } from '../errors.js'
import { PROTECTED_PATHS, type Facility } from './inventory.js'
import type { Reference, ReferenceGraph, ReferrerClass } from './graph.js'

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
      return (
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

  const removedPaths = new Set(remove.map((entry) => entry.path))
  // A workflow is removed by its directory, so every file beneath it leaves
  // too and must not also be reported as an edit.
  const removedPrefixes = [...removedPaths]
    .filter((entry) => !path.extname(entry))
    .map((entry) => `${entry}/`)
  const edits = new Map<string, EditEntry>()

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
    retained_because: retained,
    adjudication_required: [...ADJUDICATION_CATEGORIES],
  }
}

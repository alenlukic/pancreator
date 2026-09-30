/** The reference graph build and the queries over it. */

import path from 'node:path'

import { readText } from '../../io.js'
import { facilitiesByPath, type Facility } from '../inventory.js'
import {
  ALWAYS_READ_PATHS,
  type Reference,
  type ReferenceGraph,
  type ReferenceGraphOptions,
  type ReferrerClass,
} from './model.js'
import {
  dispatchMarkerColumns,
  escapeRegExp,
  lineIndexOf,
  lineStartOffsets,
  listTextFiles,
  ownerOf,
  referenceTokens,
  referrerClass,
  type RelativeTarget,
  relativeTargets,
  withoutComments,
} from './scan.js'
import { typedReferences, validatorResolutionReferences } from './typed.js'

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
        // style: allow style.switch_default Every referrer class returns, so a default would hide the compiler error that a new class must produce here.
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

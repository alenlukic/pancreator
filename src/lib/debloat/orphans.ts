import path from 'node:path'

import type { Facility } from './inventory.js'
import type { ExportedSymbol, SymbolIndex } from './symbols.js'

export type OrphanKind = 'unused_export' | 'import_chain_only' | 'unused_file'

export interface OrphanFinding {
  id: string
  kind: OrphanKind
  path: string
  symbol: string | null
  dedicated_tests: string[]
  reason: string
}

function isIndexModule(relative: string): boolean {
  return path.posix.basename(relative) === 'index.ts'
}

/**
 * Whether a consumer reaches the file through one or more barrel indexes.
 *
 * A barrel is not a consumer, so a file only its own `index.ts` imports still
 * looks orphaned. The barrel is a pass-through, though: when a further module
 * imports the barrel, the file behind it is live. Following the chain is what
 * separates that case from a barrel nothing imports either.
 */
function reachedThroughBarrel(
  file: string,
  index: SymbolIndex,
  seen: Set<string>,
): boolean {
  for (const importer of index.graph.dependents.get(file) ?? []) {
    if (importer.startsWith('tests/') || seen.has(importer)) {
      continue
    }

    seen.add(importer)

    if (
      !isIndexModule(importer) ||
      reachedThroughBarrel(importer, index, seen)
    ) {
      return true
    }
  }

  return false
}

function findingForSymbol(
  declaration: ExportedSymbol,
  index: SymbolIndex,
): OrphanFinding | null {
  const uses = index.uses.filter((entry) => entry.symbol_id === declaration.id)
  const functional = uses.filter((entry) => !entry.from.startsWith('tests/'))
  const dedicatedTests = [
    ...new Set(
      uses
        .filter((entry) => entry.from.startsWith('tests/'))
        .map((entry) => entry.from),
    ),
  ].sort()

  if (functional.length === 0) {
    return {
      id: `orphan:${declaration.id}`,
      kind: 'unused_export',
      path: declaration.file,
      symbol: declaration.name,
      dedicated_tests: dedicatedTests,
      reason: 'No non-test module imports this exported declaration.',
    }
  }

  if (
    functional.every(
      (entry) => entry.kind === 'reexport' || isIndexModule(entry.from),
    )
  ) {
    return {
      id: `orphan:${declaration.id}`,
      kind: 'import_chain_only',
      path: declaration.file,
      symbol: declaration.name,
      dedicated_tests: dedicatedTests,
      reason:
        'Every non-test use is an index or re-export chain with no direct consumer.',
    }
  }

  return null
}

/** Independent exported-symbol and source-file orphan pass. */
export function findOrphans(index: SymbolIndex): OrphanFinding[] {
  const findings = index.declarations
    .map((declaration) => findingForSymbol(declaration, index))
    .filter((entry): entry is OrphanFinding => entry !== null)
  const byFile = new Map<string, OrphanFinding[]>()

  for (const finding of findings) {
    const entries = byFile.get(finding.path) ?? []

    entries.push(finding)
    byFile.set(finding.path, entries)
  }

  for (const [file, declarations] of byFile) {
    const allExports = index.declarations.filter((entry) => entry.file === file)
    const importers = index.graph.dependents.get(file) ?? new Set<string>()
    const functionalImporters = [...importers].filter(
      (entry) => !entry.startsWith('tests/') && !isIndexModule(entry),
    )

    if (
      allExports.length > 0 &&
      declarations.length === allExports.length &&
      functionalImporters.length === 0 &&
      !index.entrypoints.has(file) &&
      !reachedThroughBarrel(file, index, new Set([file]))
    ) {
      findings.push({
        id: `orphan-file:${file}`,
        kind: 'unused_file',
        path: file,
        symbol: null,
        dedicated_tests: [
          ...new Set(declarations.flatMap((entry) => entry.dedicated_tests)),
        ].sort(),
        reason:
          'Every export is orphaned, no functional module or barrel consumer ' +
          'imports the file, and no tracked script or string literal names ' +
          'its built path.',
      })
    }
  }

  return findings.sort((left, right) => left.id.localeCompare(right.id))
}

/** Convert orphan findings into operator-selectable graph nodes. */
export function orphanFacilities(
  findings: readonly OrphanFinding[],
): Facility[] {
  return findings.map((finding) => ({
    id: finding.id,
    category: 'orphan',
    name: finding.symbol ?? finding.path,
    path: finding.path,
    owned_paths: finding.kind === 'unused_file' ? [finding.path] : [],
    selectable: true,
    node_kind: 'orphan',
    ...(finding.symbol ? { source_symbol: finding.symbol } : {}),
    orphan_kind: finding.kind,
    dedicated_tests: finding.dedicated_tests,
    protected: false,
  }))
}

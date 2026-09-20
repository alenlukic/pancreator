import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { computeClosure } from '../../src/lib/debloat/closure.js'
import type { ReferenceGraph } from '../../src/lib/debloat/graph.js'
import { findOrphans, orphanFacilities } from '../../src/lib/debloat/orphans.js'
import { buildSymbolIndex } from '../../src/lib/debloat/symbols.js'
import { createTestTempDirectory } from '../temp.js'

const ORPHAN_FUNCTION = 'orphan:src/orphans.ts#unusedFunction'

/**
 * Orphan removal is decided by the finding rather than by the graph, so the
 * closure needs no edges to reach its dedicated test.
 */
const EMPTY_GRAPH: ReferenceGraph = {
  references: [],
  incoming: new Map(),
  outgoing: new Map(),
}

function write(root: string, relative: string, content: string): void {
  const absolute = path.join(root, relative)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, content, 'utf8')
}

test('orphan analysis reports unused exports, types, and import chains', async () => {
  const root = createTestTempDirectory('debloat-orphans')

  write(
    root,
    'src/orphans.ts',
    [
      'export function unusedFunction(): number { return 1 }',
      'export type UnusedType = string',
      'export class Chained {}',
      '',
    ].join('\n'),
  )
  write(root, 'src/index.ts', "export { Chained } from './orphans.js'\n")
  write(
    root,
    'tests/unit/orphans.test.ts',
    "import { unusedFunction } from '../../src/orphans.js'\nvoid unusedFunction\n",
  )

  const findings = findOrphans(await buildSymbolIndex(root))
  const bySymbol = new Map(
    findings
      .filter((entry) => entry.symbol)
      .map((entry) => [entry.symbol, entry]),
  )

  assert.equal(bySymbol.get('unusedFunction')?.kind, 'unused_export')
  assert.equal(bySymbol.get('UnusedType')?.kind, 'unused_export')
  assert.equal(bySymbol.get('Chained')?.kind, 'import_chain_only')
  assert.deepEqual(bySymbol.get('unusedFunction')?.dedicated_tests, [
    'tests/unit/orphans.test.ts',
  ])

  const facilities = orphanFacilities(findings)

  assert.ok(facilities.every((entry) => entry.selectable))
  assert.ok(facilities.every((entry) => entry.node_kind === 'orphan'))

  // The operator selects one finding. The other three are reported and stay,
  // because an orphan check that removed its own findings would decide on the
  // operator's behalf.
  const closure = computeClosure(facilities, EMPTY_GRAPH, [ORPHAN_FUNCTION], {
    sessionId: '20260920-000000-abcdef',
  })

  assert.deepEqual(closure.cascaded, [])
  assert.deepEqual(
    closure.remove.map((entry) => ({
      path: entry.path,
      kind: entry.kind,
      facility_id: entry.facility_id,
    })),
    [
      {
        path: 'tests/unit/orphans.test.ts',
        kind: 'dedicated_test',
        facility_id: ORPHAN_FUNCTION,
      },
    ],
  )

  // The declaration leaves through an edit, because the file still holds the
  // exports the operator did not select.
  assert.deepEqual(closure.edit, [
    {
      path: 'src/orphans.ts',
      referrer_class: 'code',
      references: [ORPHAN_FUNCTION],
      reason: 'Remove orphaned export unusedFunction.',
    },
  ])

  for (const untouched of [
    'orphan:src/orphans.ts#UnusedType',
    'orphan:src/orphans.ts#Chained',
    'orphan-file:src/orphans.ts',
  ]) {
    assert.equal(
      closure.removed_facilities.includes(untouched),
      false,
      `${untouched} was not selected`,
    )
  }
})

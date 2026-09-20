import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import type { Facility } from '../../src/lib/debloat/inventory.js'
import {
  buildSymbolIndex,
  sourceSymbolFacilities,
} from '../../src/lib/debloat/symbols.js'
import { createTestTempDirectory } from '../temp.js'

function write(root: string, relative: string, content: string): void {
  const absolute = path.join(root, relative)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, content, 'utf8')
}

test('symbol analysis reuses the module graph and finds exclusive ownership', async () => {
  const root = createTestTempDirectory('debloat-symbols')

  write(
    root,
    'src/exports.ts',
    [
      'export function exclusive(): number { return 1 }',
      'export function shared(): number { return 2 }',
      'export type UnusedType = string',
      '',
    ].join('\n'),
  )
  write(
    root,
    'src/owner.ts',
    "import { exclusive, shared } from './exports.js'\nexport const owned = exclusive() + shared()\n",
  )
  write(
    root,
    'src/other.ts',
    "import { shared } from './exports.js'\nexport const other = shared()\n",
  )

  const index = await buildSymbolIndex(root)
  const owner: Facility = {
    id: 'policy:OWNER-001',
    category: 'policy',
    name: 'OWNER-001',
    path: 'src/owner.ts',
    owned_paths: ['src/owner.ts'],
    selectable: true,
    node_kind: 'facility',
    protected: false,
  }
  const nodes = sourceSymbolFacilities([owner], index)

  assert.ok(
    nodes.some(
      (entry) =>
        entry.id === 'source-symbol:src/exports.ts#exclusive' &&
        entry.owner_facility === owner.id,
    ),
  )
  assert.equal(
    nodes.some((entry) => entry.id === 'source-symbol:src/exports.ts#shared'),
    false,
    'a symbol used by a non-owner module is not exclusively owned',
  )
  assert.equal(index.graph.parser, 'typescript')
})

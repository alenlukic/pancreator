import assert from 'node:assert/strict'
import test from 'node:test'

import { traceRegistryIds } from '../../src/lib/validators/stage/plan-trace.js'

test('G01 documented prefixes resolve to explicit identifiers without changing text', () => {
  for (const id of ['US-1', 'C-01', 'OOS-101', 'Q1']) {
    for (const separator of [':', '.', '-', '—', '–', ')']) {
      const entries = [`  ${id} ${separator} Keep the original narrative.`]
      const original = structuredClone(entries)

      assert.deepEqual(traceRegistryIds(entries), [id])
      assert.deepEqual(traceRegistryIds([{ id, statement: entries[0] }]), [id])
      assert.deepEqual(entries, original)
    }
  }
})

test('G01 keyed registries require a meaningful definition', () => {
  assert.deepEqual(
    traceRegistryIds({
      'C-1': 'Keep the original.',
      'C-2': { statement: 'Keep this too.' },
      alias: { id: 'OOS-1', description: 'Exclude this.' },
      empty: '',
      missing: {},
    }),
    ['C-1', 'C-2', 'OOS-1'],
  )
})

test('G01 malformed labels cannot become trace identifiers', () => {
  assert.deepEqual(
    traceRegistryIds(['Unlabeled narrative', ': missing', { id: ' ' }]),
    [],
  )
})

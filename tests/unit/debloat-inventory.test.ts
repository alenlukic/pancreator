import assert from 'node:assert/strict'
import test from 'node:test'

import { buildReferenceGraph } from '../../src/lib/debloat/graph.js'
import { collectFacilities } from '../../src/lib/debloat/inventory.js'

test('derived functional node kinds are unselectable and carry incoming edges', () => {
  const root = process.cwd()
  const facilities = collectFacilities(root)
  const graph = buildReferenceGraph(root, facilities)
  const expected = [
    'requirement:ENG-001/eng-test-validate',
    'invocation:standalone',
    'criterion:implement.lint',
    'artifact-profile:implementation',
    'cli-subcommand:debloat',
  ]

  for (const id of expected) {
    const facility = facilities.find((entry) => entry.id === id)

    assert.ok(facility, `${id} is inventoried`)
    assert.equal(facility?.selectable, false, `${id} cannot be selected`)
    assert.ok(
      (graph.incoming.get(id) ?? []).length > 0,
      `${id} has an incoming functional edge`,
    )
  }
})

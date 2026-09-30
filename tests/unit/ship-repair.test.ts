import assert from 'node:assert/strict'
import test from 'node:test'

import {
  judgeShipRepair,
  shipRepairLaneProfiles,
} from '../../src/lib/ship-repair.js'

test('a repair of up to three lane test files is within the bound', () => {
  assert.equal(
    judgeShipRepair(['tests/unit/a.test.ts', 'tests/integration/b.test.ts'])
      .within,
    true,
  )
  assert.equal(judgeShipRepair([]).within, false)
  assert.equal(
    judgeShipRepair([
      'tests/unit/a.ts',
      'tests/unit/b.ts',
      'tests/unit/c.ts',
      'tests/unit/d.ts',
    ]).within,
    false,
  )
  assert.equal(judgeShipRepair(['src/lib/engine.ts']).within, false)
  assert.equal(judgeShipRepair(['tests/helpers.ts']).within, false)
  assert.equal(judgeShipRepair(['VERSION']).within, false)
})

test('each repaired path owes the profile of its lane once', () => {
  assert.deepEqual(
    shipRepairLaneProfiles([
      'tests/unit/a.test.ts',
      'tests/regression/b.test.ts',
      'tests/integration/c.test.ts',
    ]),
    ['fast', 'impacted-integration'],
  )
  assert.deepEqual(shipRepairLaneProfiles(['tests/secondary/x.test.ts']), [
    'secondary',
  ])
})

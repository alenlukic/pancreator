import assert from 'node:assert/strict'
import test from 'node:test'

import { workflowStageFieldContractErrors } from '../../src/lib/validation/stage-field-contract.js'
import { sharedFixture } from '../fixture-template.js'

test('every workflow stage can prepare its field contract', () => {
  assert.deepEqual(workflowStageFieldContractErrors(sharedFixture()), [])
})

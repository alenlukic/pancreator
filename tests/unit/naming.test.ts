import assert from 'node:assert/strict'
import test from 'node:test'

import {
  daysToAnchor,
  makeStageArtifactId,
  makeWorkflowRunId,
  pipelineStepPrefix,
} from '../../src/lib/naming.js'

test('workflow run IDs use UTC days to the 2200 anchor', () => {
  const date = new Date('2026-06-22T21:22:54.051Z')

  assert.equal(daysToAnchor(date), 63379)
  assert.equal(makeWorkflowRunId(date, '5f354f23'), '63379_Jun-22_5f354f23')
})

test('pipeline prefixes reverse sort the stage execution sequence', () => {
  assert.equal(pipelineStepPrefix(0), '999')
  assert.equal(pipelineStepPrefix(8), '991')
  assert.equal(pipelineStepPrefix(994), '005')
})

test('stage artifact IDs include run sequence and stage iteration', () => {
  assert.equal(
    makeStageArtifactId(2, 'implement', 3, 'df603be8'),
    '997_implement-3_df603be8',
  )
})

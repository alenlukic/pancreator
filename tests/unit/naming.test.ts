import assert from 'node:assert/strict'
import test from 'node:test'

import {
  completedPipelineStepPrefix,
  daysToAnchor,
  makeCompletedStageArtifactId,
  makeStageArtifactId,
  makeWorkflowRunId,
  pipelineStepPrefix,
} from '../../src/lib/naming.js'

test('workflow run IDs use UTC days to the 2200 anchor', () => {
  const date = new Date('2026-06-22T21:22:54.051Z')

  assert.equal(daysToAnchor(date), 63379)
  assert.equal(makeWorkflowRunId(date, '5f354f23'), '63379_Jun-22_5f354f23')
})

test('in-flight pipeline prefixes count down from 99', () => {
  assert.equal(pipelineStepPrefix(0), '99')
  assert.equal(pipelineStepPrefix(8), '91')
  assert.equal(pipelineStepPrefix(94), '05')
})

test('completed pipeline prefixes count down to zero', () => {
  assert.equal(completedPipelineStepPrefix(0, 7), '06')
  assert.equal(completedPipelineStepPrefix(3, 7), '03')
  assert.equal(completedPipelineStepPrefix(6, 7), '00')
})

test('stage artifact IDs include run sequence and stage iteration', () => {
  assert.equal(
    makeStageArtifactId(2, 'implement', 3, 'df603be8'),
    '97_implement-3_df603be8',
  )
  assert.equal(
    makeCompletedStageArtifactId(2, 7, 'implement', 3, 'df603be8'),
    '04_implement-3_df603be8',
  )
})

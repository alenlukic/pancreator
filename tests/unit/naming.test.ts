import assert from 'node:assert/strict'
import test from 'node:test'

import {
  completedPipelineStepPrefix,
  daysToAnchor,
  keywordRunSuffix,
  keywordRunSuffixFrom,
  makeCompletedStageArtifactId,
  makeStageArtifactId,
  makeWorkflowRunId,
  minutesToEndOfUtcDay,
  pipelineStepPrefix,
  temporalNamePrefix,
} from '../../src/lib/naming.js'

test('workflow run IDs use UTC days to the 2200 anchor', () => {
  const date = new Date('2026-06-22T21:22:54.051Z')

  assert.equal(daysToAnchor(date), 63379)
  assert.equal(minutesToEndOfUtcDay(date), 158)
  assert.equal(
    makeWorkflowRunId(date, '5f354f23'),
    '63379_Jun-22-0158_5f354f23',
  )
  assert.equal(
    makeWorkflowRunId(new Date('2026-07-03T23:00:00.000Z'), '3974ddd5'),
    '63368_Jul-03-0060_3974ddd5',
  )
  assert.equal(temporalNamePrefix(date), '63379_Jun-22-0158')
})

test('keyword suffixes strip temporal tokens, noise words, and hex fragments', () => {
  assert.equal(
    keywordRunSuffix('2026-08-14-harness-forensics.md'),
    'harness-fore',
  )
  assert.equal(
    keywordRunSuffix('request-20260812T035755Z-worktree-management.md'),
    'worktree-man',
  )
  assert.equal(keywordRunSuffix('best-of-n.md'), 'best-of-n')
  // A standardized temporal name must not leak its month token into keywords.
  assert.equal(
    keywordRunSuffix('63325_Aug-15-0108_list-liveness.md'),
    'list-livenes',
  )
  assert.equal(keywordRunSuffix('The Archive And Utils'), 'archive-util')
  assert.equal(keywordRunSuffix('request-20260810T054345Z-6df4ab84.md'), null)
  assert.equal(keywordRunSuffix('20260803T165512Z'), null)
  assert.equal(keywordRunSuffix(''), null)
  assert.equal(keywordRunSuffix('workspace targets everywhere'), 'workspace-ta')
  assert.equal(keywordRunSuffix('one-two-three-four'), 'one-two-thre')
  assert.equal(
    keywordRunSuffixFrom('request.md', '# Fix the workflow engine\n'),
    'fix-workflow',
  )
  assert.equal(
    keywordRunSuffixFrom('request.md', '\n\n- 2026-08-10\n- pond cleanup\n'),
    'pond-cleanup',
  )
  assert.equal(keywordRunSuffixFrom('request.md'), null)
})

test('run IDs accept keyword suffixes and reject malformed ones', () => {
  const date = new Date('2026-06-22T21:22:54.051Z')

  assert.equal(
    makeWorkflowRunId(date, 'harness-fore'),
    '63379_Jun-22-0158_harness-fore',
  )
  assert.throws(() => makeWorkflowRunId(date, 'Harness'), /suffixes MUST/u)
  assert.throws(
    () => makeWorkflowRunId(date, 'thirteen-char'),
    /suffixes MUST/u,
  )
  assert.throws(() => makeWorkflowRunId(date, 'trailing-'), /suffixes MUST/u)
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
  // In-flight prefixes count down from 99. Completed prefixes count down to
  // zero across the total step count of the run.
  assert.equal(pipelineStepPrefix(0), '99')
  assert.equal(pipelineStepPrefix(8), '91')
  assert.equal(pipelineStepPrefix(94), '05')
  assert.equal(completedPipelineStepPrefix(0, 7), '06')
  assert.equal(completedPipelineStepPrefix(3, 7), '03')
  assert.equal(completedPipelineStepPrefix(6, 7), '00')
})

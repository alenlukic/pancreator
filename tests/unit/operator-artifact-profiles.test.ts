import assert from 'node:assert/strict'
import test from 'node:test'

import {
  OPERATOR_ARTIFACT_PROFILE_HEADINGS,
  operatorArtifactProfileForStage,
} from '../../src/lib/operator-artifact-profiles.js'

test('operator artifact profiles map design workflow stages', () => {
  assert.equal(operatorArtifactProfileForStage('intake'), 'intake')
  assert.equal(operatorArtifactProfileForStage('design'), 'design')
  assert.equal(operatorArtifactProfileForStage('review'), 'review')
  assert.equal(operatorArtifactProfileForStage('test'), 'qa')
  assert.equal(operatorArtifactProfileForStage('handoff'), 'handoff')
  assert.equal(operatorArtifactProfileForStage('implement'), 'implementation')
})

test('design and handoff profiles declare required heading phrases', () => {
  assert.deepEqual(OPERATOR_ARTIFACT_PROFILE_HEADINGS.design, [
    'approach',
    'mocks',
    'acceptance criteria',
  ])
  assert.deepEqual(OPERATOR_ARTIFACT_PROFILE_HEADINGS.handoff, [
    'design package',
    'acceptance criteria',
    'next steps',
  ])
})

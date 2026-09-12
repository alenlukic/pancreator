import assert from 'node:assert/strict'
import test from 'node:test'

import { stageBySlug } from '../../src/lib/workflow.js'
import { createFixture, createRun } from '../helpers.js'
import { checkpoint } from './delivery-helpers.js'
import { checks, submitStage } from './prototype-helpers.js'

test('a failing fast profile does not block a prototype build', () => {
  const { root, runId, workflow } = checkpoint(
    'prototype@build-prepared',
    checks('checks=fast-fails', 0, 1),
  )

  const build = submitStage(root, runId, stageBySlug(workflow, 'build'))
  const fastCheck = build.submitted.record.evaluation.deterministic.find(
    (item) => item.id === 'build.fast_checks',
  )

  // A prototype measures test breadth and reports it, rather than gating on it.
  assert.ok(fastCheck, 'the fast profile must still be measured')
  assert.equal(fastCheck.hard, false)
  assert.equal(build.submitted.record.outcome, 'success')
  assert.equal(build.submitted.state.current_stage, 'evaluate')
})

test('a pre-existing static failure stays visible without blocking the spike', () => {
  const { root, runId, workflow } = checkpoint(
    'prototype@build-prepared',
    checks('checks=static-fails', 1, 0),
  )

  const build = submitStage(root, runId, stageBySlug(workflow, 'build'))
  const staticResult = build.submitted.record.evaluation.deterministic.find(
    (item) => item.id === 'build.static',
  )

  // Breakage the spike did not introduce is evidence, not a blocker.
  assert.ok(staticResult)
  assert.equal(staticResult.preexisting_failure, true)
  assert.equal(build.submitted.record.outcome, 'success')
})

test('the technical_director contract escalates the prototype approach stage', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'prototype',
    requestPath: 'request.md',
    title: 'Directed spike',
    involvement: 'technical-director',
  })

  // The same contract that escalates delivery/plan escalates prototype/approach,
  // because it attaches by checkpoint role rather than by stage slug.
  assert.deepEqual(state.operator_involvement?.applied_gates.approach, {
    workflow_gate: 'next_stage',
    run_gate: 'operator',
    source: 'technical_director contract at technical_plan checkpoint',
  })
})

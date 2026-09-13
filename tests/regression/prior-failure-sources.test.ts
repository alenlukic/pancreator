import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { prepareInvocation, setRunStage } from '../../src/lib/engine.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import {
  createFixture,
  createRun,
  makeOutput,
  submitAsSupervisor,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'
import type { Invocation, StageOutput } from '../../src/lib/types.js'

/**
 * The retry contract reads the reason the previous attempt failed from the
 * stage record. It read two of the three forms that reason takes: a failing
 * hard criterion and a failing supervisor assessment. An attempt that reported
 * a failure against an acceptance criterion carried no reason at all, and the
 * card told the retrying worker that the absent reason was itself a defect.
 */

/** Run one failing implement attempt and return the retry it produces. */
function retryAfter(
  root: string,
  grade: (output: StageOutput) => void,
): { invocation: Invocation; card: string } {
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Prior failure sources run',
  })
  const runId = state.run_id

  setRunStage(root, runId, 'implement', 'Seed implementation for the retry.')

  const first = prepareInvocation(root, runId).invocation

  assert.ok(first)

  const output = makeOutput(
    root,
    first,
    stageBySlug(workflow, 'implement'),
    'failure',
  )

  grade(output)
  writeJson(path.join(root, first.output.path), output)
  writeCanonicalDelegation(root, first)
  submitAsSupervisor(root, runId, first.output.path)

  const retry = prepareInvocation(root, runId).invocation

  assert.ok(retry)
  assert.equal(retry.attempt, 2)

  return {
    invocation: retry,
    card: readFileSync(
      resolveRunLayout(root, runId).invocation(retry.invocation_id, '.md')
        .absolute,
      'utf8',
    ),
  }
}

test('a retry carries a failure the worker declared against an acceptance criterion', () => {
  const { invocation, card } = retryAfter(createFixture(), (output) => {
    for (const criterion of output.criteria) {
      criterion.result = 'pass'
      criterion.explanation = 'Fixture evidence'
    }

    // An acceptance criterion is not a stage criterion, so this failure lived
    // only in the output the retrying worker was not given.
    output.criteria.push({
      id: 'AC-014',
      result: 'fail',
      explanation:
        'The second gate pass overwrote the first evidence log at one fingerprint.',
      evidence: [],
    })
  })

  assert.deepEqual(
    invocation.prior_failure?.declared_criteria_failures?.map(
      (criterion) => criterion.id,
    ),
    ['AC-014'],
  )
  assert.match(card, /### Criteria the attempt reported failing/u)
  assert.match(card, /\*\*AC-014\*\* \(fail\)/u)
  assert.match(card, /overwrote the first evidence log/u)
  assert.match(card, /This is the complete recorded reason/u)
})

test('a retry for which no reason resolves says so and lists nothing', () => {
  const { invocation, card } = retryAfter(createFixture(), (output) => {
    for (const criterion of output.criteria) {
      criterion.result = 'pass'
      criterion.explanation = 'Fixture evidence'
    }
  })

  const priorFailure = invocation.prior_failure

  assert.ok(priorFailure)
  assert.deepEqual(priorFailure.failed_hard_criteria, [])
  assert.deepEqual(priorFailure.declared_criteria_failures, [])
  assert.match(card, /No reason of any kind was recorded for it\./u)
  assert.match(card, /treat the absent reason itself as a defect to report/u)
  assert.doesNotMatch(card, /### Criteria the attempt reported failing/u)
  assert.doesNotMatch(card, /Address every item below/u)
})

test('a failing hard criterion still renders what it renders today', () => {
  const { invocation, card } = retryAfter(createFixture(), (output) => {
    for (const criterion of output.criteria) {
      criterion.result =
        criterion.id === 'implement.acceptance_claimed' ? 'fail' : 'pass'
      criterion.explanation =
        criterion.id === 'implement.acceptance_claimed'
          ? 'AC-02 has no supporting evidence.'
          : 'Fixture evidence'
    }
  })

  assert.deepEqual(
    invocation.prior_failure?.failed_hard_criteria.map(
      (criterion) => criterion.id,
    ),
    ['implement.acceptance_claimed'],
  )
  assert.deepEqual(invocation.prior_failure?.declared_criteria_failures, [])
  assert.match(card, /### Hard criteria that did not pass/u)
  assert.match(card, /AC-02 has no supporting evidence\./u)
  assert.match(card, /This is the complete recorded reason/u)
  assert.doesNotMatch(card, /### Criteria the attempt reported failing/u)
})

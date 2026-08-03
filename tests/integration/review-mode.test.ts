import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  createRun,
  getRunState,
  prepareInvocation,
  setRunStage,
} from '../../src/lib/engine.js'
import { resolvePolicies } from '../../src/lib/policies.js'
import { readProjectConfig } from '../../src/lib/project-config.js'
import { createFixture, read, writeJson } from '../helpers.js'

const SEED_NOTE = 'Independently review the current workspace.'

function setReviewMode(root: string, value: unknown): void {
  const config = read(path.join(root, 'config.json')) as Record<string, unknown>

  if (value === undefined) {
    delete config.review_mode
  } else {
    config.review_mode = value
  }

  writeJson(path.join(root, 'config.json'), config)
}

/** Jump a fresh run straight to the review stage and prepare its card. */
function reviewInvocation(root: string, reviewMode?: string) {
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Review mode run',
    ...(reviewMode === undefined ? {} : { reviewMode }),
  })

  setRunStage(root, state.run_id, 'review', SEED_NOTE)

  const invocation = prepareInvocation(root, state.run_id).invocation

  assert.ok(invocation)
  assert.equal(invocation.stage.slug, 'review')

  const card = readFileSync(
    path.join(
      root,
      `runtime/logs/workflows/${state.run_id}/invocations/${invocation.invocation_id}.md`,
    ),
    'utf8',
  )

  return { runId: state.run_id, state, invocation, card }
}

test('a configuration without review_mode resolves the default method', () => {
  const root = createFixture()

  setReviewMode(root, undefined)

  const { state, invocation, card } = reviewInvocation(root)

  assert.equal(state.review_mode, 'default')
  assert.equal(invocation.review_mode, 'default')
  assert.ok(invocation.policies.some((policy) => policy.id === 'REVIEW-001'))
  assert.ok(
    !invocation.policies.some((policy) => policy.id === 'REVIEW-002'),
    'the default method must not load the squad policy',
  )
  assert.doesNotMatch(card, /## 🔭 Review method/u)
})

test('review_mode squad loads REVIEW-002 and unrolls the squad skill', () => {
  const root = createFixture()

  setReviewMode(root, 'squad')

  const { state, invocation, card } = reviewInvocation(root)

  assert.equal(state.review_mode, 'squad')
  assert.equal(invocation.review_mode, 'squad')

  const squad = invocation.policies.find((policy) => policy.id === 'REVIEW-002')

  assert.ok(squad, 'a review_mode-scoped lookup row must load REVIEW-002')
  assert.deepEqual(
    (squad.guidance ?? []).map((guidance) => guidance.source_path),
    ['library/skills/review-squad.md'],
  )
  // REVIEW-001 keeps the verdict and the remediation boundary under both modes.
  assert.ok(invocation.policies.some((policy) => policy.id === 'REVIEW-001'))

  assert.match(card, /## 🔭 Review method/u)
  assert.match(card, /review mode `squad`/u)
  assert.match(
    card,
    /### Unrolled guidance · `library\/skills\/review-squad\.md`/u,
  )
  // The charters must arrive as content, not as a path the worker has to open.
  assert.match(card, /### Correctness/u)
  assert.match(card, /### Frontend/u)
})

test('another persona never picks up the squad policy', () => {
  const root = createFixture()

  setReviewMode(root, 'squad')

  const ids = resolvePolicies(root, {
    persona: 'coder',
    workflow: 'dev',
    stage: 'implement',
    review_mode: 'squad',
  }).map((policy) => policy.id)

  assert.ok(!ids.includes('REVIEW-002'))
})

test('--review-mode overrides the configured method for one run', () => {
  const root = createFixture()

  setReviewMode(root, 'default')

  const { state, invocation } = reviewInvocation(root, 'squad')

  assert.equal(state.review_mode, 'squad')
  assert.ok(invocation.policies.some((policy) => policy.id === 'REVIEW-002'))
  // The override is per run and leaves the configured default alone.
  assert.equal(readProjectConfig(root)?.review_mode, 'default')
})

test('an unknown review mode reports the available methods', () => {
  const root = createFixture()

  assert.throws(
    () =>
      createRun(root, {
        workflowSlug: 'dev',
        requestPath: 'request.md',
        title: 'Bad mode run',
        reviewMode: 'committee',
      }),
    /Unknown review mode 'committee'\. Available: default, squad\./u,
  )
})

test('an unsupported configured review mode fails to load', () => {
  const root = createFixture()

  setReviewMode(root, 'panel')

  assert.throws(
    () => readProjectConfig(root),
    /config\.json\.review_mode MUST be default or squad when present\./u,
  )
})

test('a configuration edit cannot change a run already in flight', () => {
  const root = createFixture()

  setReviewMode(root, 'squad')

  const { runId } = reviewInvocation(root)

  setReviewMode(root, 'default')

  assert.equal(getRunState(root, runId).review_mode, 'squad')

  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)
  assert.equal(invocation.review_mode, 'squad')
  assert.ok(invocation.policies.some((policy) => policy.id === 'REVIEW-002'))
})

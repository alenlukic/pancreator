import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  abortRun,
  createRun,
  getRunState,
  prepareInvocation,
} from '../../src/lib/engine.js'
import { loadState, loadStateRevision } from '../../src/lib/state.js'
import { createFixture } from '../helpers.js'

test('aborting a run finalizes artifact numbering and layout', () => {
  const root = createFixture()
  const created = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  })
  const runId = created.run_id
  const prepared = prepareInvocation(root, runId)

  assert.ok(prepared.invocation)
  assert.match(prepared.invocation.invocation_id, /^99_intake-1_/u)

  const canceled = abortRun(root, runId, 'operator canceled')
  const persisted = getRunState(root, runId)
  const runDirectory = path.join(root, 'runtime/logs/workflows', runId)

  assert.equal(canceled.status, 'canceled')
  assert.equal(persisted.status, 'canceled')
  assert.equal(persisted.current_invocation, null)
  const agentDirectory = path.join(runDirectory, 'agent')
  const operatorDirectory = path.join(runDirectory, 'operator')
  const invocationFiles = readdirSync(path.join(agentDirectory, 'invocations'))

  assert.ok(
    invocationFiles.some((name) => /^00_intake-1_.*\.json$/u.test(name)),
  )
  assert.ok(invocationFiles.some((name) => /^00_intake-1_.*\.md$/u.test(name)))
  assert.equal(existsSync(path.join(runDirectory, 'records')), false)
  assert.equal(existsSync(path.join(agentDirectory, 'artifacts/json')), true)
  assert.equal(existsSync(operatorDirectory), true)
  assert.equal(existsSync(path.join(runDirectory, 'artifacts')), false)
  assert.match(
    readFileSync(path.join(agentDirectory, 'events.jsonl'), 'utf8'),
    /"type":"workflow_artifacts_finalized"/u,
  )
})

test('finalization preserves content-addressed state revisions', () => {
  const root = createFixture()
  const created = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  })
  const runId = created.run_id
  const prepared = prepareInvocation(root, runId)

  assert.ok(prepared.invocation)

  // The prepared-invocation revision embeds the 99_-prefixed invocation id
  // that finalization renames. Rewriting the revision artifact's content
  // would invalidate its recorded digest and brick loadState/loadStateRevision
  // for the closed run.
  const preparedRevision = getRunState(root, runId).revision

  abortRun(root, runId, 'operator canceled')

  const reloaded = loadState(root, runId)

  assert.equal(reloaded.status, 'canceled')

  const historical = loadStateRevision(root, runId, preparedRevision)

  assert.match(
    historical.current_invocation?.id ?? '',
    /^99_intake-1_/u,
    'historical revisions keep their pre-finalization invocation ids',
  )
})

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { abortRun, getRunState } from '../../src/lib/engine.js'
import { loadState, loadStateRevision } from '../../src/lib/state.js'
import { checkpoint } from './delivery-helpers.js'

test('aborting a run finalizes artifact numbering and layout', () => {
  const { root, runId, state, invocation } = checkpoint(
    'delivery@plan-prepared',
  )

  assert.ok(invocation)
  assert.match(invocation.invocation_id, /^99_plan-1_/u)

  // Finalization renames the 99_-prefixed invocation id. Do not rewrite the
  // revision artifact content, because a new digest breaks loadState for the
  // closed run.
  const preparedRevision = state.revision

  const canceled = abortRun(root, runId, 'operator canceled')
  const persisted = getRunState(root, runId)
  const runDirectory = path.join(root, 'runtime/logs/workflows', runId)

  assert.equal(canceled.status, 'canceled')
  assert.equal(persisted.status, 'canceled')
  assert.equal(persisted.current_invocation, null)
  const agentDirectory = path.join(runDirectory, 'agent')
  const operatorDirectory = path.join(runDirectory, 'operator')
  const invocationFiles = readdirSync(path.join(agentDirectory, 'invocations'))

  assert.ok(invocationFiles.some((name) => /^00_plan-1_.*\.json$/u.test(name)))
  assert.ok(invocationFiles.some((name) => /^00_plan-1_.*\.md$/u.test(name)))
  assert.equal(existsSync(path.join(runDirectory, 'records')), false)
  assert.equal(existsSync(path.join(agentDirectory, 'artifacts/json')), true)
  assert.equal(existsSync(operatorDirectory), true)
  assert.equal(existsSync(path.join(runDirectory, 'artifacts')), false)
  assert.match(
    readFileSync(path.join(agentDirectory, 'events.jsonl'), 'utf8'),
    /"type":"workflow_artifacts_finalized"/u,
  )

  const reloaded = loadState(root, runId)

  assert.equal(reloaded.status, 'canceled')

  const historical = loadStateRevision(root, runId, preparedRevision)

  assert.match(
    historical.current_invocation?.id ?? '',
    /^99_plan-1_/u,
    'historical revisions keep their pre-finalization invocation ids',
  )
})

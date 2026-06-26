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
  const invocationFiles = readdirSync(path.join(runDirectory, 'invocations'))

  assert.equal(canceled.status, 'canceled')
  assert.equal(persisted.status, 'canceled')
  assert.equal(persisted.current_invocation, null)
  assert.ok(
    invocationFiles.some((name) => /^00_intake-1_.*\.json$/u.test(name)),
  )
  assert.ok(invocationFiles.some((name) => /^00_intake-1_.*\.md$/u.test(name)))
  assert.equal(existsSync(path.join(runDirectory, 'records')), false)
  assert.equal(existsSync(path.join(runDirectory, 'artifacts/json')), true)
  assert.equal(existsSync(path.join(runDirectory, 'artifacts/markdown')), true)
  assert.match(
    readFileSync(path.join(runDirectory, 'events.jsonl'), 'utf8'),
    /"type":"workflow_artifacts_finalized"/u,
  )
})

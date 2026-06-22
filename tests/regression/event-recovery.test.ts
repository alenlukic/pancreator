import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { createFixture } from '../helpers.js'
import { createRun, getRunState } from '../../src/lib/engine.js'

test('materialized state recovers from a newer write-ahead event', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  })
  const recovered = structuredClone(state)
  recovered.revision += 1
  recovered.status = 'paused'
  recovered.pause_reason = 'simulated interrupted state write'
  appendFileSync(
    path.join(
      root,
      'runtime',
      'logs',
      'workflows',
      state.run_id,
      'events.jsonl',
    ),
    `${JSON.stringify({
      schema_version: 1,
      event_id: 'simulated',
      type: 'simulated_write_ahead',
      timestamp: new Date().toISOString(),
      run_id: state.run_id,
      revision: recovered.revision,
      state_after: recovered,
    })}\n`,
  )
  const loaded = getRunState(root, state.run_id)
  assert.equal(loaded.status, 'paused')
  assert.equal(loaded.revision, recovered.revision)
})

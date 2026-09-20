import assert from 'node:assert/strict'
import test from 'node:test'

import { renderStatus } from '../../src/lib/render.js'
import { invocationLiveness } from '../../src/lib/state.js'
import type { RunState } from '../../src/lib/types.js'

function invocationState(preparedAt: string): RunState {
  return {
    schema_version: 2,
    run_id: 'run-literal',
    workflow_slug: 'delivery',
    workflow_snapshot: { path: 'workflow.json', sha256: 'a'.repeat(64) },
    workspace_root: '.',
    title: 'Literal run',
    status: 'running',
    current_stage: 'implement',
    pending_action: {
      type: 'invoke_agent',
      persona: 'coder',
      path: 'invocation.md',
    },
    current_invocation: {
      id: 'implement-1',
      json_path: 'invocation.json',
      markdown_path: 'invocation.md',
      output_path: 'output.json',
      prepared_at: preparedAt,
      last_activity_at: preparedAt,
    },
    request: {
      source_path: 'request.md',
      stored_path: 'request.md',
      sha256: '',
    },
    limits: {
      max_total_transitions: 20,
      max_stage_attempts: 3,
      max_consecutive_failures: 3,
    },
    attempts: {},
    transition_count: 0,
    consecutive_failures: 0,
    stage_history: [],
    revision: 1,
    created_at: preparedAt,
    updated_at: preparedAt,
  }
}

test('legacy invocation quiet time does not claim agent health', () => {
  const preparedAt = '2026-08-14T12:00:00.000Z'
  const state = invocationState(preparedAt)

  assert.equal(
    invocationLiveness(state, Date.parse(preparedAt) + 1_000, 2_000)?.status,
    'active',
  )
  assert.equal(
    invocationLiveness(state, Date.parse(preparedAt) + 3_000, 2_000)?.status,
    'stale',
  )

  const stale = invocationLiveness(state, Date.parse(preparedAt) + 3_000, 2_000)

  assert.ok(stale)
  const rendered = renderStatus({ ...state, invocation_liveness: stale })

  assert.match(rendered, /Agent health: unknown/u)
  assert.doesNotMatch(rendered, /Invocation activity/u)

  // The run waits on the operator, not on a delegated worker, so the render
  // reports no liveness.
  const waiting = invocationState('2020-01-01T00:00:00.000Z')

  waiting.pending_action = { type: 'operator_decision' }

  assert.equal(
    invocationLiveness(
      waiting,
      Date.parse('2020-01-01T00:00:00.000Z') + 10_000,
      2_000,
    ),
    null,
  )
})

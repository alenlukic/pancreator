import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  createRun,
  getRunStatus,
  quarantineRunForAgent,
} from '../../src/lib/engine.js'
import { tickHypervisor } from '../../src/lib/hypervisor.js'
import { renderStatus } from '../../src/lib/render.js'
import {
  eventPath,
  invocationLiveness,
  loadState,
  loadStateRevision,
  persist,
  statePath,
} from '../../src/lib/state.js'
import type { RunState, StageHistoryItem } from '../../src/lib/types.js'
import { createFixture } from '../helpers.js'

test('state events use recoverable content-addressed references', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const event = JSON.parse(
    readFileSync(eventPath(root, state.run_id), 'utf8')
      .trim()
      .split('\n')
      .at(-1) ?? '{}',
  ) as {
    state_after?: unknown
    state_ref?: { path?: string; sha256?: string }
  }

  assert.equal(event.state_after, undefined)
  assert.match(event.state_ref?.sha256 ?? '', /^[a-f0-9]{64}$/u)
  assert.ok(event.state_ref?.path)
  assert.ok(existsSync(path.join(root, event.state_ref.path)))

  writeFileSync(
    statePath(root, state.run_id),
    `${JSON.stringify({ ...state, revision: 0 }, null, 2)}\n`,
  )

  const recovered = loadState(root, state.run_id)

  assert.equal(recovered.revision, state.revision)

  // Every referenced event revision round-trips.
  const firstRevision = state.revision
  const firstTitle = state.title

  state.title = 'Second revision'
  persist(root, state, 'title_changed')

  state.title = 'Third revision'
  persist(root, state, 'title_changed')

  assert.equal(
    loadStateRevision(root, state.run_id, firstRevision).title,
    firstTitle,
  )
  assert.equal(
    loadStateRevision(root, state.run_id, firstRevision + 1).title,
    'Second revision',
  )
  assert.equal(
    loadStateRevision(root, state.run_id, firstRevision + 2).title,
    'Third revision',
  )
})

test('oversized event payloads externalize below the line budget', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  persist(root, state, 'large_fixture_event', {
    detail: 'x'.repeat(70 * 1024),
  })

  const line =
    readFileSync(eventPath(root, state.run_id), 'utf8')
      .trim()
      .split('\n')
      .at(-1) ?? ''
  const event = JSON.parse(line) as {
    payload_ref?: { path?: string; sha256?: string }
  }

  assert.ok(Buffer.byteLength(line, 'utf8') < 64 * 1024)
  assert.match(event.payload_ref?.sha256 ?? '', /^[a-f0-9]{64}$/u)
  assert.ok(event.payload_ref?.path)
  assert.ok(existsSync(path.join(root, event.payload_ref.path)))
})

test('full repository deltas externalize before state persistence', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const diagnostic = {
    kind: 'command' as const,
    command: 'npm test',
    diagnostic: 'failure',
    count: 101,
  }
  const history: StageHistoryItem = {
    stage: 'implement',
    attempt: 1,
    invocation_id: 'implement-1',
    output_path: 'output.json',
    outcome: 'failure',
    submitted_at: new Date().toISOString(),
    workspace_fingerprint: 'fixture',
    validation_errors: [],
    deterministic: [
      {
        id: 'implement.tests',
        type: 'shell',
        hard: true,
        passed: false,
        workspace_fingerprint: 'fixture',
        repository_check_delta: {
          new: [diagnostic],
          fixed: [],
          carried: [],
          counts: { new: 101, fixed: 0, carried: 0 },
          full: { new: [diagnostic], fixed: [], carried: [] },
        },
      },
    ],
  }

  state.stage_history.push(history)
  persist(root, state, 'stage_recorded')

  const delta = state.stage_history[0]?.deterministic[0]?.repository_check_delta

  assert.equal(delta?.full, undefined)
  assert.match(delta?.full_delta_ref?.sha256 ?? '', /^[a-f0-9]{64}$/u)
  assert.ok(delta?.full_delta_ref?.path)
  assert.deepEqual(delta?.full_delta_ref?.counts, {
    new: 101,
    fixed: 0,
    carried: 0,
  })
  assert.ok(existsSync(path.join(root, delta.full_delta_ref.path)))
})

test('audited-scale stage history stays within the state budget', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const diagnostics = Array.from({ length: 101 }, (_, index) => ({
    kind: 'command' as const,
    command: 'npm test',
    diagnostic: `failure-${index}`,
    count: 1,
  }))

  for (let attempt = 1; attempt <= 14; attempt += 1) {
    state.stage_history.push({
      stage: 'implement',
      attempt,
      invocation_id: `implement-${attempt}`,
      output_path: `output-${attempt}.json`,
      outcome: 'failure',
      submitted_at: new Date().toISOString(),
      workspace_fingerprint: `fixture-${attempt}`,
      validation_errors: [],
      deterministic: Array.from({ length: 4 }, (_, gate) => ({
        id: `gate-${gate}`,
        type: 'shell' as const,
        hard: true,
        passed: false,
        workspace_fingerprint: `fixture-${attempt}`,
        repository_check_delta: {
          new: diagnostics.slice(0, 100),
          fixed: [],
          carried: [],
          counts: { new: 101, fixed: 0, carried: 0 },
          full: { new: diagnostics, fixed: [], carried: [] },
        },
      })),
    })
  }

  persist(root, state, 'audited_scale_fixture')

  assert.ok(
    Buffer.byteLength(readFileSync(statePath(root, state.run_id)), 'utf8') <
      1024 * 1024,
  )
  assert.ok(
    state.stage_history.every((history) =>
      history.deterministic.every(
        (result) =>
          result.repository_check_delta?.new.length === 10 &&
          result.repository_check_delta.full_delta_ref !== undefined,
      ),
    ),
  )
})

test('project configuration overrides the state-size budget', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  writeFileSync(
    configPath,
    `${JSON.stringify({ ...config, state_size_budget_bytes: 1 }, null, 2)}\n`,
  )

  assert.throws(
    () => persist(root, state, 'budget_fixture'),
    /1-byte budget after compaction/u,
  )
})

/** A hand-built run state carrying what liveness and status rendering read. */
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

  // The run is not waiting on a delegated worker while it waits on the
  // operator, so "stale, re-deliver the card" advice would be impossible to
  // follow: liveness is not reported at all.
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

test('run status reports registry-backed agent health', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  state.current_invocation = {
    id: 'implement-1',
    json_path: 'invocation.json',
    markdown_path: 'invocation.md',
    output_path: 'output.json',
    prepared_at: '2020-01-01T00:00:00.000Z',
    last_activity_at: '2020-01-01T00:00:00.000Z',
  }
  state.pending_action = {
    type: 'invoke_agent',
    persona: 'coder',
    path: 'invocation.md',
  }
  writeFileSync(
    statePath(root, state.run_id),
    `${JSON.stringify(state, null, 2)}\n`,
  )
  tickHypervisor(root, {
    now: '2026-08-21T12:00:00.000Z',
    observations: [
      {
        agent_id: 'agent-1',
        run_id: state.run_id,
        invocation_id: 'implement-1',
        persona: 'coder',
        executor: 'cursor',
        process_alive: true,
        last_transcript_at: '2026-08-21T11:59:59.000Z',
      },
    ],
  })

  const status = getRunStatus(root, state.run_id, { json: true })

  assert.equal(typeof status, 'object')

  if (typeof status !== 'string') {
    assert.equal(status.agent_health?.health, 'running')
    assert.equal(status.agent_health?.agent_id, 'agent-1')
  }
})

test('recovery quarantine pauses the run for an operator decision', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const paused = quarantineRunForAgent(
    root,
    state.run_id,
    'agent-1',
    'The same recovery signature failed twice.',
  )

  assert.equal(paused.status, 'paused')
  assert.equal(paused.pending_action.type, 'operator_decision')
  assert.equal(
    paused.operator_pause?.prior_pending_action.type,
    'prepare_invocation',
  )
  assert.match(
    readFileSync(eventPath(root, state.run_id), 'utf8'),
    /"type":"hypervisor_agent_quarantined"/u,
  )
})

test('persist rejects payloads that shadow reserved event envelope keys', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  // The audited run recorded an operator decision whose payload key
  // `revision` overwrote the event's state revision, corrupting the recovery
  // chain. A colliding payload key must fail loudly at the persist boundary.
  assert.throws(
    () => persist(root, state, 'fixture_event', { revision: 1 }),
    /reserved envelope key 'revision'/u,
  )
})

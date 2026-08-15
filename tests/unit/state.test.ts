import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createRun, getRunStatus } from '../../src/lib/engine.js'
import { renderStatus } from '../../src/lib/render.js'
import {
  eventPath,
  invocationLiveness,
  loadState,
  loadStateRevision,
  persist,
  statePath,
} from '../../src/lib/state.js'
import type { StageHistoryItem } from '../../src/lib/types.js'
import { createFixture } from '../helpers.js'

test('state events use recoverable content-addressed references', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
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
})

test('every referenced event revision round-trips', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  })
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
    workflowSlug: 'dev',
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
    workflowSlug: 'dev',
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
    workflowSlug: 'dev',
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
    workflowSlug: 'dev',
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

test('invocation liveness reports active and stale workers', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  })
  const preparedAt = '2026-08-14T12:00:00.000Z'

  state.current_invocation = {
    id: 'implement-1',
    json_path: 'invocation.json',
    markdown_path: 'invocation.md',
    output_path: 'output.json',
    prepared_at: preparedAt,
    last_activity_at: preparedAt,
  }

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
  assert.match(
    renderStatus({ ...state, invocation_liveness: stale }),
    /Invocation activity: stale[\s\S]*Recovery: re-deliver/u,
  )
})

test('project configuration overrides the invocation liveness bound', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  })
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  writeFileSync(
    configPath,
    `${JSON.stringify({ ...config, stage_liveness_ms: 1 }, null, 2)}\n`,
  )
  state.current_invocation = {
    id: 'implement-1',
    json_path: 'invocation.json',
    markdown_path: 'invocation.md',
    output_path: 'output.json',
    prepared_at: '2020-01-01T00:00:00.000Z',
    last_activity_at: '2020-01-01T00:00:00.000Z',
  }
  writeFileSync(
    statePath(root, state.run_id),
    `${JSON.stringify(state, null, 2)}\n`,
  )

  const status = getRunStatus(root, state.run_id, { json: true })

  assert.equal(typeof status, 'object')

  if (typeof status !== 'string') {
    assert.equal(status.invocation_liveness?.status, 'stale')
    assert.equal(status.invocation_liveness?.stale_after_ms, 1)
  }
})

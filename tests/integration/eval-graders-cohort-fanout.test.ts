import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { RUN_ID, SyntheticRun, grade } from './eval-graders-helpers.js'

// ---------------------------------------------------------------------------
// cohort-fanout
// ---------------------------------------------------------------------------

const COHORT_ID = '63300_Aug-29-0100_fanout'

interface ChunkRunOptions {
  runId: string
  chunk: string
  cohortIndex: number
  status?: string
  workflow?: string
  /** [prepared, submitted] ISO pairs, one per attempt. */
  attempts: [string, string | null][]
  bound?: boolean
}

/** Write one chunk run's state.json and events.jsonl under the synthetic root. */
function writeChunkRun(root: string, options: ChunkRunOptions): void {
  const agent = path.join(
    root,
    'runtime',
    'logs',
    'workflows',
    options.runId,
    'agent',
  )

  mkdirSync(agent, { recursive: true })
  writeFileSync(
    path.join(agent, 'state.json'),
    JSON.stringify({
      schema_version: 2,
      run_id: options.runId,
      workflow_slug: options.workflow ?? 'delivery-chunk',
      workflow_snapshot: { path: 'x', sha256: 'x' },
      workspace_root: `worktrees/operator/${options.chunk}`,
      ...(options.bound === false
        ? {}
        : {
            cohort: {
              cohort_id: COHORT_ID,
              cohort_index: options.cohortIndex,
              chunk: options.chunk,
            },
          }),
      title: options.chunk,
      status: options.status ?? 'succeeded',
      current_stage: null,
      pending_action: { type: 'none' },
      current_invocation: null,
      request: { source_path: 'r', stored_path: 'r', sha256: 'r' },
      limits: {},
      attempts: {},
      transition_count: options.attempts.length,
      consecutive_failures: 0,
      stage_history: [],
      advisories: [],
      revision: 1,
      created_at: '2026-08-29T00:00:00.000Z',
      updated_at: '2026-08-29T00:00:00.000Z',
    }),
  )

  const events: Record<string, unknown>[] = []

  options.attempts.forEach(([prepared, submitted], index) => {
    const invocationId = `${options.chunk}-implement-${index + 1}`

    events.push({
      type: 'invocation_prepared',
      timestamp: prepared,
      invocation_id: invocationId,
      stage: 'implement',
    })

    if (submitted) {
      events.push({
        type: 'stage_output_submitted',
        timestamp: submitted,
        invocation_id: invocationId,
        stage: 'implement',
      })
    }
  })

  writeFileSync(
    path.join(agent, 'events.jsonl'),
    `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
  )
}

interface SessionOptions {
  maxParallel?: number
  chunks: {
    id: string
    cohortIndex: number
    runId?: string
    abandoned?: boolean
  }[]
  integratedCohorts?: number[]
}

/** Write the cohort session record and its integration evidence files. */
function writeCohortSession(root: string, options: SessionOptions): void {
  const directory = path.join(root, 'runtime', 'logs', 'cohorts', COHORT_ID)

  mkdirSync(directory, { recursive: true })

  const indexes = [...new Set(options.chunks.map((chunk) => chunk.cohortIndex))]
  const satisfaction = (options.integratedCohorts ?? []).map((index) => {
    const evidencePath = `runtime/logs/cohorts/${COHORT_ID}/integration-${index}.json`

    writeFileSync(
      path.join(root, evidencePath),
      JSON.stringify({ cohort_index: index, merge_commit: 'abc' }),
    )

    return {
      cohort_index: index,
      recorded_at: '2026-08-29T01:00:00.000Z',
      base_branch: 'main',
      merge_commit: 'abc',
      evidence_path: evidencePath,
    }
  })

  writeFileSync(
    path.join(directory, 'state.json'),
    JSON.stringify({
      schema_version: 1,
      cohort_id: COHORT_ID,
      plan_run_id: RUN_ID,
      parent_spec_path: 'spec.md',
      base_branch: 'main',
      ...(options.maxParallel ? { max_parallel: options.maxParallel } : {}),
      created_at: '2026-08-29T00:00:00.000Z',
      updated_at: '2026-08-29T00:00:00.000Z',
      chunks: options.chunks.map((chunk) => ({
        id: chunk.id,
        title: chunk.id,
        cohort_index: chunk.cohortIndex,
        child_spec_path: `${chunk.id}.md`,
        depends_on: [],
        ...(chunk.runId
          ? {
              worktree: `cohort-${chunk.id}`,
              branch: `cohort/${chunk.id}`,
              run_id: chunk.runId,
            }
          : {}),
        ...(chunk.abandoned
          ? { abandoned: { note: 'dropped', recorded_at: 'now' } }
          : {}),
      })),
      edges: [],
      cohorts: indexes.map((index) => ({
        index,
        chunks: options.chunks
          .filter((chunk) => chunk.cohortIndex === index)
          .map((chunk) => chunk.id),
      })),
      satisfaction,
    }),
  )
}

function planRun(): SyntheticRun {
  return new SyntheticRun()
    .setState({
      status: 'succeeded',
      currentStage: null,
      pendingAction: { type: 'none' },
    })
    .addHistory({ stage: 'plan', attempt: 1, invocationId: 'p1' })
    .write()
}

test('cohort-fanout fails when the plan run opened no cohort session', () => {
  const run = planRun()

  try {
    const verdict = grade(run, { id: 'cohort-fanout' })

    assert.equal(verdict.passed, false)
    assert.match(verdict.summary, /no cohort session/u)
  } finally {
    run.dispose()
  }
})

test('cohort-fanout passes a wide cohort that ran in parallel within the limit and integrated', () => {
  const run = planRun()

  try {
    writeCohortSession(run.root, {
      maxParallel: 2,
      chunks: [
        { id: 'a', cohortIndex: 1, runId: 'run-a' },
        { id: 'b', cohortIndex: 1, runId: 'run-b' },
        { id: 'c', cohortIndex: 1, runId: 'run-c' },
        { id: 'd', cohortIndex: 1, abandoned: true },
      ],
      integratedCohorts: [1],
    })
    // a and b overlap; c starts once a finished, so the peak is 2.
    writeChunkRun(run.root, {
      runId: 'run-a',
      chunk: 'a',
      cohortIndex: 1,
      attempts: [['2026-08-29T00:00:00Z', '2026-08-29T00:10:00Z']],
    })
    writeChunkRun(run.root, {
      runId: 'run-b',
      chunk: 'b',
      cohortIndex: 1,
      attempts: [['2026-08-29T00:00:05Z', '2026-08-29T00:20:00Z']],
    })
    writeChunkRun(run.root, {
      runId: 'run-c',
      chunk: 'c',
      cohortIndex: 1,
      attempts: [['2026-08-29T00:10:00Z', '2026-08-29T00:30:00Z']],
    })

    const verdict = grade(run, {
      id: 'cohort-fanout',
      policy: 'COHORT-001#15',
      config: { min_chunks: 3, max_cohorts: 1, min_concurrent: 2 },
    })

    assert.equal(verdict.passed, true, verdict.summary)
    assert.equal(verdict.policy, 'COHORT-001#15')

    const cohorts = verdict.details.cohorts as Record<string, unknown>[]

    assert.equal(cohorts[0]?.peak_concurrent_attempts, 2)
    assert.equal(cohorts[0]?.integrated, true)
    assert.ok(
      verdict.evidence.includes(
        `runtime/logs/cohorts/${COHORT_ID}/integration-1.json`,
      ),
    )
    assert.ok(
      verdict.evidence.some((item) => item.endsWith('run-b/agent/state.json')),
    )
  } finally {
    run.dispose()
  }
})

test('cohort-fanout reports serial execution, a breached limit, a wrong workflow, and a missing merge', () => {
  const run = planRun()

  try {
    writeCohortSession(run.root, {
      maxParallel: 2,
      chunks: [
        { id: 'a', cohortIndex: 1, runId: 'run-a' },
        { id: 'b', cohortIndex: 1, runId: 'run-b' },
        { id: 'c', cohortIndex: 2, runId: 'run-c' },
        { id: 'd', cohortIndex: 2, runId: 'run-d' },
        { id: 'e', cohortIndex: 2, runId: 'run-e' },
        { id: 'f', cohortIndex: 3 },
      ],
      integratedCohorts: [1],
    })
    // Cohort 1 ran strictly one after the other.
    writeChunkRun(run.root, {
      runId: 'run-a',
      chunk: 'a',
      cohortIndex: 1,
      attempts: [['2026-08-29T00:00:00Z', '2026-08-29T00:10:00Z']],
    })
    writeChunkRun(run.root, {
      runId: 'run-b',
      chunk: 'b',
      cohortIndex: 1,
      workflow: 'delivery',
      attempts: [['2026-08-29T00:10:00Z', '2026-08-29T00:20:00Z']],
    })
    // Cohort 2 ran three at once against a limit of two; e is still open.
    writeChunkRun(run.root, {
      runId: 'run-c',
      chunk: 'c',
      cohortIndex: 2,
      attempts: [['2026-08-29T01:00:00Z', '2026-08-29T01:10:00Z']],
    })
    writeChunkRun(run.root, {
      runId: 'run-d',
      chunk: 'd',
      cohortIndex: 2,
      attempts: [['2026-08-29T01:00:00Z', '2026-08-29T01:10:00Z']],
    })
    writeChunkRun(run.root, {
      runId: 'run-e',
      chunk: 'e',
      cohortIndex: 2,
      status: 'running',
      bound: false,
      attempts: [['2026-08-29T01:05:00Z', null]],
    })

    const verdict = grade(run, {
      id: 'cohort-fanout',
      config: { max_cohorts: 1 },
    })

    assert.equal(verdict.passed, false)

    const failures = verdict.details.failures as string[]

    assert.ok(
      failures.some((item) => /3 cohort\(s\), expected at most 1/u.test(item)),
    )
    assert.ok(
      failures.some((item) => /chunk f never received a run/u.test(item)),
    )
    assert.ok(
      failures.some((item) =>
        /chunk b ran workflow 'delivery', expected 'delivery-chunk'/u.test(
          item,
        ),
      ),
    )
    assert.ok(
      failures.some((item) =>
        /cohort 1 peaked at 1 concurrent attempt\(s\), expected at least 2/u.test(
          item,
        ),
      ),
    )
    assert.ok(
      failures.some((item) =>
        /cohort 2 peaked at 3 concurrent attempt\(s\), above the limit 2/u.test(
          item,
        ),
      ),
    )
    assert.ok(failures.some((item) => /chunk e run is 'running'/u.test(item)))
    assert.ok(
      failures.some((item) =>
        /chunk e run does not record membership/u.test(item),
      ),
    )
    assert.ok(
      failures.some((item) => /cohort 2 was never integrated/u.test(item)),
    )
  } finally {
    run.dispose()
  }
})

/** The cohort fan-out grader and the attempt windows it measures. */

import { readdirSync } from 'node:fs'
import path from 'node:path'

import { fileExists, isRecord, readJson } from '../../io.js'
import { loadRunRecords, type RunRecords } from '../run-records.js'
import { config, type Grader } from './context.js'

// ---------------------------------------------------------------------------
// cohort-fanout
// ---------------------------------------------------------------------------

interface AttemptWindow {
  run_id: string
  invocation_id: string
  started_at: string
  ended_at: string | null
}

/**
 * Attempt windows of one run: from `invocation_prepared` to the matching
 * `stage_output_submitted`. An open window ends at the run's last event.
 */
function attemptWindows(records: RunRecords): AttemptWindow[] {
  const lastTimestamp = [...records.events]
    .reverse()
    .map((event) => event.timestamp)
    .find((value): value is string => typeof value === 'string')
  const windows = new Map<string, AttemptWindow>()

  for (const event of records.events) {
    const invocationId = event.invocation_id
    const timestamp = event.timestamp

    if (typeof invocationId !== 'string' || typeof timestamp !== 'string') {
      continue
    }

    if (event.type === 'invocation_prepared') {
      windows.set(invocationId, {
        run_id: records.run_id,
        invocation_id: invocationId,
        started_at: timestamp,
        ended_at: null,
      })
    } else if (event.type === 'stage_output_submitted') {
      const window = windows.get(invocationId)

      if (window) {
        window.ended_at = timestamp
      }
    }
  }

  return [...windows.values()].map((window) => ({
    ...window,
    ended_at:
      window.ended_at ??
      (TERMINAL_RUN_STATUSES.has(records.state.status)
        ? (lastTimestamp ?? null)
        : null),
  }))
}

const TERMINAL_RUN_STATUSES = new Set(['succeeded', 'failed', 'canceled'])

/** Peak number of windows open at one instant; an open-ended window stays open. */
function peakConcurrency(windows: AttemptWindow[]): number {
  const points: { at: number; delta: number }[] = []

  for (const window of windows) {
    points.push({ at: Date.parse(window.started_at), delta: 1 })
    points.push({
      at: window.ended_at ? Date.parse(window.ended_at) : Infinity,
      delta: -1,
    })
  }

  // Close before open at the same instant so back-to-back windows do not
  // count as overlapping.
  points.sort((left, right) => left.at - right.at || left.delta - right.delta)

  let open = 0
  let peak = 0

  for (const point of points) {
    open += point.delta
    peak = Math.max(peak, open)
  }

  return peak
}

interface CohortSessionRecord {
  cohort_id: string
  plan_run_id: string
  max_parallel?: number
  chunks: {
    id: string
    cohort_index: number
    depends_on?: string[]
    worktree?: string
    branch?: string
    run_id?: string
    abandoned?: unknown
  }[]
  cohorts: { index: number; chunks: string[] }[]
  satisfaction: { cohort_index: number; evidence_path: string }[]
}

function findCohortSession(
  records: RunRecords,
): { path: string; state: CohortSessionRecord } | null {
  const directory = path.join(records.root, 'runtime', 'logs', 'cohorts')

  if (!fileExists(directory)) {
    return null
  }

  for (const entry of readdirSync(directory).sort()) {
    const statePath = path.join(directory, entry, 'state.json')

    if (!fileExists(statePath)) {
      continue
    }

    try {
      const value = readJson(statePath)

      if (
        isRecord(value) &&
        value.plan_run_id === records.run_id &&
        Array.isArray(value.chunks) &&
        Array.isArray(value.cohorts) &&
        Array.isArray(value.satisfaction)
      ) {
        return {
          path: path
            .relative(records.root, statePath)
            .split(path.sep)
            .join('/'),
          state: value as unknown as CohortSessionRecord,
        }
      }
    } catch {
      // An unreadable session is reported as a missing one.
    }
  }

  return null
}

/**
 * Grade a planning run's cohort fan-out from the session record and every
 * chunk run's records: the plan was carved into enough independent chunks,
 * every started chunk ran the chunk workflow to success in its own worktree,
 * the attempt windows of one cohort overlapped (the chunks really ran in
 * parallel) without exceeding the session's parallelism limit, and every
 * cohort was integrated back into the base branch.
 */
export const cohortFanout: Grader = (context) => {
  const { records } = context
  const minChunks = config(context, 'min_chunks', 2)
  const maxCohorts = config<number | null>(context, 'max_cohorts', null)
  const minConcurrentConfig = config<number | null>(
    context,
    'min_concurrent',
    null,
  )

  const requireIntegrated = config(context, 'require_integrated', true)
  const chunkWorkflow = config(context, 'chunk_workflow', 'delivery-chunk')

  const failures: string[] = []
  const evidence: string[] = []

  const session = findCohortSession(records)

  if (!session) {
    return {
      passed: false,
      summary: `no cohort session under runtime/logs/cohorts names plan run ${records.run_id}`,
      evidence,
      details: { failures: ['cohort session missing'] },
      observability:
        'Looks for runtime/logs/cohorts/*/state.json whose plan_run_id is this run; a fan-out that was never opened leaves nothing to grade.',
    }
  }

  evidence.push(session.path)

  const { state } = session
  const maxParallel =
    Number.isInteger(state.max_parallel) && Number(state.max_parallel) >= 1
      ? Number(state.max_parallel)
      : 4
  const activeChunks = state.chunks.filter((chunk) => !chunk.abandoned)

  if (activeChunks.length < minChunks) {
    failures.push(
      `${activeChunks.length} active chunk(s), expected at least ${minChunks}`,
    )
  }

  if (maxCohorts !== null && state.cohorts.length > maxCohorts) {
    failures.push(
      `${state.cohorts.length} cohort(s), expected at most ${maxCohorts}`,
    )
  }

  const chunkRuns = new Map<string, RunRecords>()
  const chunkSummaries: Record<string, unknown>[] = []

  for (const chunk of activeChunks) {
    const summary: Record<string, unknown> = {
      chunk: chunk.id,
      cohort_index: chunk.cohort_index,
      run_id: chunk.run_id ?? null,
      worktree: chunk.worktree ?? null,
      branch: chunk.branch ?? null,
    }

    chunkSummaries.push(summary)

    if (!chunk.run_id) {
      failures.push(`chunk ${chunk.id} never received a run`)
      continue
    }

    if (!chunk.worktree || !chunk.branch) {
      failures.push(`chunk ${chunk.id} has no worktree or branch recorded`)
    }

    let chunkRecords: RunRecords

    try {
      chunkRecords = loadRunRecords(records.root, chunk.run_id)
    } catch (error) {
      failures.push(
        `chunk ${chunk.id} run ${chunk.run_id} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      )
      continue
    }

    chunkRuns.set(chunk.id, chunkRecords)
    evidence.push(
      path
        .relative(records.root, chunkRecords.layout.state.absolute)
        .split(path.sep)
        .join('/'),
    )
    summary.status = chunkRecords.state.status
    summary.workflow = chunkRecords.state.workflow_slug

    if (chunkRecords.state.workflow_slug !== chunkWorkflow) {
      failures.push(
        `chunk ${chunk.id} ran workflow '${chunkRecords.state.workflow_slug}', expected '${chunkWorkflow}'`,
      )
    }

    if (chunkRecords.state.status !== 'succeeded') {
      failures.push(
        `chunk ${chunk.id} run is '${chunkRecords.state.status}', expected 'succeeded'`,
      )
    }

    const binding = chunkRecords.state.cohort

    if (!binding || binding.cohort_id !== state.cohort_id) {
      failures.push(
        `chunk ${chunk.id} run does not record membership of cohort session ${state.cohort_id}`,
      )
    }
  }

  const cohortConcurrency: Record<string, unknown>[] = []

  for (const group of [...state.cohorts].sort((a, b) => a.index - b.index)) {
    const members = activeChunks.filter(
      (chunk) => chunk.cohort_index === group.index,
    )
    const windows = members.flatMap((chunk) => {
      const run = chunkRuns.get(chunk.id)

      return run ? attemptWindows(run) : []
    })
    const peak = peakConcurrency(windows)
    const wanted =
      minConcurrentConfig ?? Math.min(members.length, maxParallel, 2)
    const integrated = state.satisfaction.some(
      (entry) => entry.cohort_index === group.index,
    )
    const satisfaction = state.satisfaction.find(
      (entry) => entry.cohort_index === group.index,
    )

    if (satisfaction?.evidence_path) {
      if (fileExists(path.join(records.root, satisfaction.evidence_path))) {
        evidence.push(satisfaction.evidence_path)
      } else {
        failures.push(
          `cohort ${group.index} integration evidence ${satisfaction.evidence_path} is missing`,
        )
      }
    }

    cohortConcurrency.push({
      cohort_index: group.index,
      chunks: members.map((chunk) => chunk.id),
      attempt_windows: windows.length,
      peak_concurrent_attempts: peak,
      min_concurrent_expected: wanted,
      integrated,
    })

    if (members.length >= 2 && peak < wanted) {
      failures.push(
        `cohort ${group.index} peaked at ${peak} concurrent attempt(s), expected at least ${wanted}`,
      )
    }

    if (peak > maxParallel) {
      failures.push(
        `cohort ${group.index} peaked at ${peak} concurrent attempt(s), above the limit ${maxParallel}`,
      )
    }

    if (requireIntegrated && members.length > 0 && !integrated) {
      failures.push(`cohort ${group.index} was never integrated`)
    }
  }

  return {
    passed: failures.length === 0,
    summary:
      failures.length === 0
        ? `${activeChunks.length} chunk(s) across ${state.cohorts.length} cohort(s) ran the ${chunkWorkflow} workflow in parallel within the limit ${maxParallel} and every cohort integrated.`
        : failures.join('; '),
    evidence,
    details: {
      cohort_id: state.cohort_id,
      max_parallel: maxParallel,
      chunks: chunkSummaries,
      cohorts: cohortConcurrency,
      failures,
    },
    observability:
      'Reads the cohort session state, each chunk run state.json and events.jsonl, and the integration evidence files. Concurrency is the overlap of invocation_prepared..stage_output_submitted windows across chunk runs; a worker that was launched but never prepared, and the merged tree itself, are not observable here.',
  }
}

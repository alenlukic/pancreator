import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { initCohortSession, startCohort } from '../../src/lib/cohorts.js'
import { listRunStates, loadState, statePath } from '../../src/lib/state.js'
import { createRun, writeJson } from '../helpers.js'

export const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

export function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
}

export interface ChunkSpec {
  id: string
  cohort_index: number
  depends_on?: string[]
}

/**
 * Stand up a planning run whose ratified plan stage output holds `chunks`.
 *
 * The cohort lifecycle reads the ratified plan through the run's own durable
 * records, so the fixture writes those records rather than a plan object the
 * commands would have to be told about.
 */
export function ratifiedPlanRun(root: string, chunks: ChunkSpec[]): string {
  mkdirSync(path.join(root, 'runtime', 'specs'), { recursive: true })
  writeFileSync(
    path.join(root, 'runtime', 'specs', 'parent-specification.md'),
    '# Parent specification\n\nThe complete record of the request.\n',
  )

  for (const chunk of chunks) {
    writeFileSync(
      path.join(root, 'runtime', 'specs', `${chunk.id}.md`),
      `# Chunk ${chunk.id}\n\nOne unit of work.\n`,
    )
  }

  writeFileSync(
    path.join(root, 'planning-request.md'),
    '# Request\n\nCarve one ratified plan into cohorts.\n',
  )

  const run = createRun(root, {
    workflowSlug: 'planning',
    requestPath: 'planning-request.md',
  })
  const outputPath = `runtime/logs/workflows/${run.run_id}/agent/outputs/plan-1.json`
  const indexes = [...new Set(chunks.map((chunk) => chunk.cohort_index))].sort()

  writeJson(path.join(root, outputPath), {
    schema_version: 1,
    result: 'success',
    data: {
      cohort_plan: {
        parent_spec_path: 'runtime/specs/parent-specification.md',
        chunks: chunks.map((chunk) => ({
          id: chunk.id,
          title: `Outcome ${chunk.id}`,
          cohort_index: chunk.cohort_index,
          child_spec_path: `runtime/specs/${chunk.id}.md`,
          depends_on: chunk.depends_on ?? [],
        })),
        edges: chunks.flatMap((chunk) =>
          (chunk.depends_on ?? []).map((from) => ({ from, to: chunk.id })),
        ),
        cohorts: indexes.map((index) => ({
          index,
          chunks: chunks
            .filter((chunk) => chunk.cohort_index === index)
            .map((chunk) => chunk.id),
        })),
      },
    },
  })

  writeJson(statePath(root, run.run_id), {
    ...loadState(root, run.run_id),
    status: 'succeeded',
    current_stage: null,
    stage_history: [
      {
        stage: 'plan',
        attempt: 1,
        outcome: 'success',
        invocation_id: 'plan-1',
        output_path: outputPath,
        recorded_at: '2026-09-02T00:00:00.000Z',
        // The harness always writes these on a real submission, and the
        // handoff the approval records persists through the same path.
        validation_errors: [],
        deterministic: [],
      },
    ],
  })

  return run.run_id
}

export function markSucceeded(root: string, runId: string): void {
  writeJson(statePath(root, runId), {
    ...loadState(root, runId),
    status: 'succeeded',
    current_stage: null,
  })
}

export function commitInChunk(
  root: string,
  workspace: string,
  chunk: string,
): void {
  const absolute = path.join(root, workspace)

  writeFileSync(path.join(absolute, `${chunk}.txt`), `${chunk} landed\n`)
  git(absolute, ['add', `${chunk}.txt`])
  git(absolute, ['commit', '-m', `feat: ${chunk}`])
}

/**
 * Re-declare the fixture as an embedded harness. Integration resolves the
 * repository from `workspace_root`, which stays the fixture root, so only the
 * emitted pan entrypoint changes.
 */
export function markEmbedded(root: string): void {
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  writeJson(configPath, { ...config, installation_mode: 'embedded' })
}

/** A session whose only cohort is committed, succeeded, and ready to integrate. */
export function finalCohortReadyToIntegrate(root: string): {
  cohortId: string
  planRunId: string
  chunkRunIds: string[]
} {
  const planRunId = ratifiedPlanRun(root, [
    { id: 'alpha', cohort_index: 1 },
    { id: 'beta', cohort_index: 1 },
  ])
  const session = initCohortSession(root, { planRunId })
  const started = startCohort(root, session.cohort_id)

  for (const chunk of started.chunks) {
    commitInChunk(
      root,
      loadState(root, chunk.run_id).workspace_root,
      chunk.chunk,
    )
    markSucceeded(root, chunk.run_id)
  }

  git(root, ['add', '-A'])
  git(root, ['commit', '-m', 'chore: cohort fixture baseline'])

  return {
    cohortId: session.cohort_id,
    planRunId,
    chunkRunIds: started.chunks.map((chunk) => chunk.run_id),
  }
}

export function releaseRuns(root: string): string[] {
  return listRunStates(root)
    .filter((run) => run.workflow_slug === 'delivery')
    .map((run) => run.run_id)
}

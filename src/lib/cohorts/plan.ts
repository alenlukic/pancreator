/** Cohort plan parsing and the ratified planning artifact it reads. */

import { invariant } from '../errors.js'
import { isRecord, readJson, resolveInside } from '../io.js'
import { loadState } from '../state.js'
import type {
  CohortChunkRecord,
  CohortDependencyEdge,
  CohortGroupRecord,
} from '../types.js'
import { COHORT_PLAN_WORKFLOW_SLUG } from './state.js'
import { requireString } from './chunks.js'

export interface ParsedCohortPlan {
  parent_spec_path: string
  chunks: CohortChunkRecord[]
  edges: CohortDependencyEdge[]
  cohorts: CohortGroupRecord[]
}

/**
 * Read the cohort plan out of a ratified planning stage output.
 *
 * Shape is checked here rather than trusted, because the fan-out creates
 * worktrees and runs from these values. Graph and traceability rules stay with
 * the planning-stage validator, which reports them while the plan can still be
 * corrected.
 */
export function parseCohortPlan(
  value: unknown,
  source: string,
): ParsedCohortPlan {
  invariant(isRecord(value), `${source} MUST be an object.`, {
    code: 'INVALID_COHORT_PLAN',
  })

  const parentSpecPath = requireString(
    value.parent_spec_path,
    `${source}.parent_spec_path`,
  )

  invariant(
    Array.isArray(value.chunks) && value.chunks.length > 0,
    `${source}.chunks MUST list at least one chunk.`,
    { code: 'INVALID_COHORT_PLAN' },
  )
  invariant(
    Array.isArray(value.cohorts) && value.cohorts.length > 0,
    `${source}.cohorts MUST list at least one cohort.`,
    { code: 'INVALID_COHORT_PLAN' },
  )

  const chunks = value.chunks.map((chunk, index) => {
    const chunkSource = `${source}.chunks[${index}]`

    invariant(isRecord(chunk), `${chunkSource} MUST be an object.`, {
      code: 'INVALID_COHORT_PLAN',
    })

    const cohortIndex = chunk.cohort_index

    invariant(
      Number.isInteger(cohortIndex) && Number(cohortIndex) >= 1,
      `${chunkSource}.cohort_index MUST be an integer of at least 1.`,
      { code: 'INVALID_COHORT_PLAN' },
    )

    const dependsOn = chunk.depends_on ?? []

    invariant(
      Array.isArray(dependsOn) &&
        dependsOn.every((item) => typeof item === 'string'),
      `${chunkSource}.depends_on MUST be an array of chunk ids.`,
      { code: 'INVALID_COHORT_PLAN' },
    )

    return {
      id: requireString(chunk.id, `${chunkSource}.id`),
      title:
        typeof chunk.title === 'string' && chunk.title.trim().length > 0
          ? chunk.title
          : requireString(chunk.id, `${chunkSource}.id`),
      cohort_index: Number(cohortIndex),
      child_spec_path: requireString(
        chunk.child_spec_path,
        `${chunkSource}.child_spec_path`,
      ),
      depends_on: dependsOn as string[],
    }
  })

  const edges = (Array.isArray(value.edges) ? value.edges : []).map(
    (edge, index) => {
      const edgeSource = `${source}.edges[${index}]`

      invariant(isRecord(edge), `${edgeSource} MUST be an object.`, {
        code: 'INVALID_COHORT_PLAN',
      })

      return {
        from: requireString(edge.from, `${edgeSource}.from`),
        to: requireString(edge.to, `${edgeSource}.to`),
      }
    },
  )

  const cohorts = value.cohorts.map((group, index) => {
    const groupSource = `${source}.cohorts[${index}]`

    invariant(isRecord(group), `${groupSource} MUST be an object.`, {
      code: 'INVALID_COHORT_PLAN',
    })
    invariant(
      Number.isInteger(group.index) && Number(group.index) >= 1,
      `${groupSource}.index MUST be an integer of at least 1.`,
      { code: 'INVALID_COHORT_PLAN' },
    )
    invariant(
      Array.isArray(group.chunks) &&
        group.chunks.every((item) => typeof item === 'string'),
      `${groupSource}.chunks MUST be an array of chunk ids.`,
      { code: 'INVALID_COHORT_PLAN' },
    )
    // An empty cohort has no chunk run that could ever succeed, so it would
    // stay unsatisfied forever and block every cohort after it.
    invariant(
      group.chunks.length > 0,
      `${groupSource}.chunks MUST list at least one chunk id.`,
      { code: 'INVALID_COHORT_PLAN' },
    )

    return { index: Number(group.index), chunks: group.chunks as string[] }
  })

  // The two views of membership must agree, because the fan-out iterates
  // `cohorts` while satisfaction reads `chunks[].cohort_index`.
  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]))

  for (const group of cohorts) {
    for (const chunkId of group.chunks) {
      const chunk = chunkById.get(chunkId)

      invariant(
        chunk && chunk.cohort_index === group.index,
        `${source}.cohorts[index ${group.index}] names chunk '${chunkId}', ` +
          `which ${chunk ? `claims cohort ${chunk.cohort_index}` : 'the plan does not declare'}.`,
        { code: 'INVALID_COHORT_PLAN' },
      )
    }
  }

  return { parent_spec_path: parentSpecPath, chunks, edges, cohorts }
}

function ratifiedPlanOutputPath(root: string, planRunId: string): string {
  const state = loadState(root, planRunId)

  invariant(
    state.workflow_slug === COHORT_PLAN_WORKFLOW_SLUG,
    `Run ${planRunId} runs workflow '${state.workflow_slug}', not ` +
      `'${COHORT_PLAN_WORKFLOW_SLUG}', so it holds no cohort plan.`,
    { code: 'COHORT_PLAN_RUN_INVALID' },
  )

  const ratified = [...state.stage_history]
    .reverse()
    .find((item) => item.stage === 'plan' && item.outcome === 'success')

  invariant(
    ratified,
    `Run ${planRunId} has no successful plan stage, so its cohort plan is ` +
      'not ratified yet.',
    { code: 'COHORT_PLAN_NOT_RATIFIED' },
  )

  return ratified.output_path
}

/** Cohort plan recorded by a ratified planning run. */
export function readRatifiedCohortPlan(
  root: string,
  planRunId: string,
): ParsedCohortPlan {
  const outputPath = ratifiedPlanOutputPath(root, planRunId)
  const output = readJson(resolveInside(root, outputPath))

  invariant(
    isRecord(output) && isRecord(output.data),
    `${outputPath} MUST contain a stage output with a data object.`,
    { code: 'INVALID_COHORT_PLAN' },
  )

  return parseCohortPlan(
    output.data.cohort_plan,
    `${outputPath} data.cohort_plan`,
  )
}

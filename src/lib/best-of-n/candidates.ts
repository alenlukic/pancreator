/** Candidate agent refresh and candidate abandonment. */

import { invariant } from '../errors.js'
import { resolveInside } from '../io.js'
import { loadPipelineConfigSnapshot } from '../pipeline-config.js'
import { projectPersonaVariants } from '../projection.js'
import { now } from '../state.js'
import { loadWorkflowFile, workflowPersonaNames } from '../workflow.js'
import {
  type BestOfNState,
  candidateRunState,
  persistBestOfNState,
} from './state.js'
import { withBestOfNSession } from './session.js'

export interface RefreshBestOfNAgentsResult {
  bon_id: string
  refreshed_agents: string[]
}

/**
 * Rebuild every run-scoped agent from its run's pinned model snapshot.
 *
 * This refreshes executable agent instructions without changing session state,
 * candidate models, or the runs' immutable workflow contracts.
 */
export function refreshBestOfNAgents(
  root: string,
  bonId: string,
): RefreshBestOfNAgentsResult {
  return withBestOfNSession(root, bonId, (state) => {
    const runAgents = [
      ...state.candidates.map((candidate) => ({
        runId: candidate.run_id,
        suffix: candidate.agent_suffix,
      })),
      ...(state.consolidation
        ? [
            {
              runId: state.consolidation.run_id,
              suffix: state.consolidation.agent_suffix,
            },
          ]
        : []),
    ]
    const refreshed = new Set<string>()

    for (const entry of runAgents) {
      const run = candidateRunState(root, entry.runId)

      invariant(run, `Best-of-N child run '${entry.runId}' does not exist.`, {
        code: 'BEST_OF_N_CHILD_NOT_FOUND',
      })
      invariant(
        run.pipeline_config,
        `Best-of-N child run '${entry.runId}' has no pipeline snapshot.`,
        { code: 'INVALID_PIPELINE_CONFIG' },
      )

      const snapshot = loadPipelineConfigSnapshot(
        root,
        run.pipeline_config.path,
      )
      const workflow = loadWorkflowFile(
        root,
        resolveInside(root, run.workflow_snapshot.path),
      )
      const personas: Record<string, string> = {}

      for (const persona of workflowPersonaNames(workflow)) {
        const model = snapshot.personas[persona]

        invariant(
          model,
          `Run '${entry.runId}' snapshot maps no model for '${persona}'.`,
          { code: 'INVALID_PIPELINE_CONFIG' },
        )
        personas[persona] = model
      }

      for (const change of projectPersonaVariants(
        root,
        entry.suffix,
        personas,
        { write: true },
      )) {
        refreshed.add(change.path)
      }
    }

    return {
      bon_id: bonId,
      refreshed_agents: [...refreshed].sort(),
    }
  })
}

/**
 * Record an operator-directed exclusion of one candidate.
 *
 * Exclusion is operator-owned: a failed candidate stays eligible for repair and
 * resume until the operator says otherwise, so the note is required evidence.
 */
export function abandonBestOfNCandidate(
  root: string,
  bonId: string,
  runId: string,
  note: string,
): BestOfNState {
  invariant(
    note.trim().length > 0,
    '--note is required to abandon a candidate.',
    {
      code: 'INVALID_ARGUMENT',
    },
  )

  return withBestOfNSession(root, bonId, (state) => {
    const candidate = state.candidates.find((entry) => entry.run_id === runId)

    invariant(
      candidate,
      `Best-of-N session ${bonId} has no candidate run '${runId}'.`,
      { code: 'BEST_OF_N_CANDIDATE_NOT_FOUND' },
    )

    return persistBestOfNState(root, {
      ...state,
      candidates: state.candidates.map((entry) =>
        entry.run_id === runId
          ? { ...entry, abandoned: { note, recorded_at: now() } }
          : entry,
      ),
    })
  })
}

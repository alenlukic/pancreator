/** The consolidation request and the consolidation run. */

import path from 'node:path'

import { createRun } from '../engine.js'
import { invariant } from '../errors.js'
import { readText, resolveInside, sha256, writeTextAtomic } from '../io.js'
import { loadPipelineConfig } from '../pipeline-config.js'
import { projectPersonaVariants } from '../projection.js'
import { loadWorkflow, workflowPersonaNames } from '../workflow.js'
import {
  agentSuffix,
  bestOfNDir,
  type BestOfNState,
  type BestOfNStatus,
  candidateRunState,
  parseBestOfNConfigs,
  persistBestOfNState,
} from './state.js'
import { bestOfNStatus, withBestOfNSession } from './session.js'
import { personaMapFor } from './init.js'

function candidateOutputPaths(root: string, runId: string): string[] {
  const run = candidateRunState(root, runId)

  if (!run) {
    return []
  }

  return [...new Set(run.stage_history.map((item) => item.output_path))].sort()
}

function renderConsolidationRequest(
  root: string,
  state: BestOfNState,
  status: BestOfNStatus,
): string {
  const lines = [
    '# Best-of-N consolidation request',
    '',
    `Session \`${state.bon_id}\` produced ${status.candidates.length} candidate ` +
      'implementations of one task. Evaluate every candidate below, then write ' +
      'one consolidated implementation into the main workspace.',
    '',
    '## Original task',
    '',
    `- Preserved request: \`${state.request.stored_path}\``,
    `- Operator source: \`${state.request.source_path}\``,
    '',
    '## Candidates',
    '',
  ]

  for (const candidate of status.candidates) {
    lines.push(
      `### ${candidate.slot}`,
      '',
      `- Run: \`${candidate.run_id}\``,
      `- Worktree: \`${candidate.worktree_path}\``,
      `- Final status: \`${candidate.status}\``,
      `- Operator exclusion: ${
        candidate.abandoned ? `yes — ${candidate.abandoned.note}` : 'no'
      }`,
      '- Outputs:',
      ...candidateOutputPaths(root, candidate.run_id).map(
        (outputPath) => `  - \`${outputPath}\``,
      ),
      '',
    )
  }

  lines.push(
    '## Required work',
    '',
    '1. Read each candidate diff in its worktree and each run output above.',
    '2. Record correctness, strengths, and weaknesses for every candidate.',
    '3. Choose a consolidation strategy and state the reason for it.',
    '4. Implement the consolidated change in the main workspace.',
    '5. Derive consolidated acceptance criteria and map evidence to each one.',
    '',
    'An excluded candidate MUST still be evaluated. Do not edit a worktree.',
    '',
  )

  return `${lines.join('\n')}\n`
}

/**
 * Start the consolidation run for a session whose candidates are all resolved.
 */
export function consolidateBestOfN(root: string, bonId: string): BestOfNState {
  return withBestOfNSession(root, bonId, (state) =>
    startConsolidationRun(root, state),
  )
}

/** The caller holds the session mutex. */
function startConsolidationRun(
  root: string,
  state: BestOfNState,
): BestOfNState {
  const bonId = state.bon_id

  invariant(
    state.status === 'ready',
    `Best-of-N session ${bonId} did not finish initialization, so its ` +
      `candidate set is incomplete. Remove its worktrees with 'pan best-of-n ` +
      `clean ${bonId}' and start a new session.`,
    { code: 'BEST_OF_N_INCOMPLETE' },
  )
  invariant(
    !state.consolidation,
    `Best-of-N session ${bonId} already started consolidation run ` +
      `'${state.consolidation?.run_id}'.`,
    { code: 'BEST_OF_N_ALREADY_CONSOLIDATED' },
  )

  const storedConfigsPath = `runtime/logs/best-of-n/${bonId}/configs.json`
  const configsRaw = readText(
    path.join(bestOfNDir(root, bonId), 'configs.json'),
  )

  // The candidates ran against the configs recorded at initialization, so the
  // consolidation run must come from the same bytes. An edited stored copy
  // would silently re-model the consolidation half of the session.
  invariant(
    sha256(configsRaw) === state.configs.sha256,
    `Stored configs at ${storedConfigsPath} no longer match the digest ` +
      `recorded at initialization (${state.configs.sha256}). Restore the ` +
      'stored file before consolidating.',
    { code: 'BEST_OF_N_CONFIGS_DRIFTED' },
  )

  const status = bestOfNStatus(root, bonId)

  invariant(
    status.unresolved.length === 0,
    `Best-of-N session ${bonId} has unresolved candidates: ` +
      `${status.unresolved.join(', ')}. Repair and resume each one, or record ` +
      'an operator-directed abandonment.',
    { code: 'BEST_OF_N_CANDIDATES_UNRESOLVED' },
  )
  invariant(
    status.successes > 0,
    `Best-of-N session ${bonId} has no successful candidate, so there is ` +
      'nothing to consolidate.',
    { code: 'BEST_OF_N_NO_SUCCESS' },
  )

  const configs = parseBestOfNConfigs(JSON.parse(configsRaw), storedConfigsPath)
  const slot = configs.consolidation.name
  const suffix = agentSuffix(bonId, slot)
  const requestPath = `runtime/logs/best-of-n/${bonId}/consolidation-request.md`

  writeTextAtomic(
    resolveInside(root, requestPath),
    renderConsolidationRequest(root, state, status),
  )

  const workflow = loadWorkflow(root, state.consolidation_workflow)

  projectPersonaVariants(
    root,
    suffix,
    personaMapFor(
      loadPipelineConfig(root).file.defaults,
      configs.consolidation.personas,
      workflowPersonaNames(workflow),
    ),
    { write: true },
  )

  const run = createRun(root, {
    workflowSlug: state.consolidation_workflow,
    requestPath,
    title: `consolidation · ${bonId}`,
    pipelineOverride: {
      label: `best-of-n:${bonId}:${slot}`,
      personas: configs.consolidation.personas,
      source_path: storedConfigsPath,
      source_sha256: state.configs.sha256,
    },
    cursorAgentSuffix: suffix,
    useWorkflowDeclaredGates: true,
    operatorArtifacts: state.operator_artifacts ?? false,
    bestOfN: { bon_id: bonId, role: 'consolidation', slot },
  })

  return persistBestOfNState(root, {
    ...state,
    consolidation: {
      slot,
      run_id: run.run_id,
      agent_suffix: suffix,
      request_path: requestPath,
    },
  })
}

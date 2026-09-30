/** Best-of-N session initialization and its candidate runs. */

import { copyFileSync } from 'node:fs'
import path from 'node:path'

import { createRun } from '../engine/create-run.js'
import { errorMessage, invariant, PanError } from '../errors.js'
import { gitHead, gitWorktreeAdd, isGitRepository } from '../git.js'
import {
  ensureDir,
  fileExists,
  readJson,
  readText,
  resolveInside,
  sha256,
  toRepoRelative,
  withOperationMutex,
  writeTextAtomic,
} from '../io.js'
import { bestOfNCandidatePath } from '../project-config.js'
import { loadPipelineConfig } from '../pipeline-config.js'
import { projectPersonaVariants } from '../projection.js'
import { runSetupCommands } from '../setup-commands.js'
import { keywordRunSuffixFrom } from '../naming.js'
import { makeUniqueRunId, now } from '../state.js'
import { loadWorkflow, workflowPersonaNames } from '../workflow.js'
import {
  agentSuffix,
  type BestOfNConfigsFile,
  bestOfNDir,
  bestOfNMutexPath,
  type BestOfNPendingCandidate,
  type BestOfNState,
  CANDIDATE_WORKFLOW,
  CONSOLIDATION_WORKFLOW,
  parseBestOfNConfigs,
  persistBestOfNState,
} from './state.js'

export interface InitBestOfNOptions {
  requestPath: string
  configsPath: string
  candidateWorkflow?: string
  consolidationWorkflow?: string
  operatorArtifacts?: boolean
}

/** Inputs every candidate slot of one session shares. */
interface SessionPlan {
  configs: BestOfNConfigsFile
  head: string
  candidateWorkflow: string
  storedRequest: string
  requestLabel: string
  defaults: Record<string, string>
  candidatePersonas: string[]
  operatorArtifacts: boolean
}

/**
 * Create one best-of-N session: N detached worktrees, their run-scoped agent
 * variants, and N autonomous candidate runs.
 *
 * The session record is published as `initializing` before the first worktree
 * exists and is updated after every resource, so a failed initialization stays
 * visible to `status` and removable by `clean`. A failure leaves the created
 * worktrees in place, because removing them is destructive and operator-owned.
 */
export function initBestOfN(
  root: string,
  options: InitBestOfNOptions,
): BestOfNState {
  invariant(
    isGitRepository(root),
    'Best-of-N requires a Git repository, because each candidate runs in a ' +
      'worktree.',
    { code: 'BEST_OF_N_REQUIRES_GIT' },
  )

  const head = gitHead(root)

  invariant(
    head,
    'Best-of-N requires at least one commit to branch candidate worktrees from.',
    { code: 'BEST_OF_N_REQUIRES_GIT' },
  )

  const configsSource = resolveInside(root, options.configsPath)

  invariant(
    fileExists(configsSource),
    `Configs file does not exist: ${options.configsPath}`,
    { code: 'BEST_OF_N_CONFIGS_NOT_FOUND' },
  )

  const requestSource = resolveInside(root, options.requestPath)

  invariant(
    fileExists(requestSource),
    `Request file does not exist: ${options.requestPath}`,
    { code: 'REQUEST_NOT_FOUND' },
  )

  const configsRaw = readText(configsSource)
  const configs = parseBestOfNConfigs(
    readJson(configsSource),
    options.configsPath,
  )
  const candidateWorkflow = options.candidateWorkflow ?? CANDIDATE_WORKFLOW
  const consolidationWorkflow =
    options.consolidationWorkflow ?? CONSOLIDATION_WORKFLOW

  // Both graphs are loaded before any worktree exists, so a missing or invalid
  // workflow fails while nothing has been created.
  const candidatePersonas = workflowPersonaNames(
    loadWorkflow(root, candidateWorkflow),
  )
  const consolidationPersonas = workflowPersonaNames(
    loadWorkflow(root, consolidationWorkflow),
  )

  const defaults = loadPipelineConfig(root).file.defaults

  for (const candidate of configs.candidates) {
    assertPersonaKeysKnown(
      candidate.personas,
      [...candidatePersonas, ...Object.keys(defaults)],
      `Candidate '${candidate.name}'`,
    )

    for (const persona of candidatePersonas) {
      invariant(
        candidate.personas[persona] ?? defaults[persona],
        `Candidate '${candidate.name}' maps no model for persona ` +
          `'${persona}', and config.json declares no default for it.`,
        { code: 'INVALID_BEST_OF_N_CONFIGS' },
      )
    }
  }

  // The consolidation config is validated with the same rigor as the
  // candidates. Deferring this to consolidation time would burn N completed
  // candidate runs before a bad config surfaces.
  assertPersonaKeysKnown(
    configs.consolidation.personas,
    [...consolidationPersonas, ...Object.keys(defaults)],
    `Consolidation config '${configs.consolidation.name}'`,
  )

  for (const persona of consolidationPersonas) {
    invariant(
      configs.consolidation.personas[persona] ?? defaults[persona],
      `Consolidation config '${configs.consolidation.name}' maps no model ` +
        `for persona '${persona}', and config.json declares no default for it.`,
      { code: 'INVALID_BEST_OF_N_CONFIGS' },
    )
  }

  const bonId = makeUniqueRunId(
    path.join(root, 'runtime', 'logs', 'best-of-n'),
    keywordRunSuffixFrom(
      path.basename(options.requestPath),
      readText(requestSource),
    ),
  )
  const directory = bestOfNDir(root, bonId)

  ensureDir(directory)

  const requestExtension = path.extname(requestSource) || '.md'
  const storedRequest = `runtime/logs/best-of-n/${bonId}/request${requestExtension}`

  copyFileSync(requestSource, resolveInside(root, storedRequest))
  writeTextAtomic(path.join(directory, 'configs.json'), configsRaw)

  const opened: BestOfNState = {
    schema_version: 1,
    bon_id: bonId,
    status: 'initializing',
    created_at: now(),
    updated_at: now(),
    candidate_workflow: candidateWorkflow,
    consolidation_workflow: consolidationWorkflow,
    configs: {
      source_path: toRepoRelative(root, configsSource),
      sha256: sha256(configsRaw),
    },
    request: {
      source_path: toRepoRelative(root, requestSource),
      stored_path: storedRequest,
      sha256: sha256(readText(requestSource)),
    },
    setup: configs.setup,
    operator_artifacts: options.operatorArtifacts ?? false,
    candidates: [],
    pending: [],
  }

  const plan: SessionPlan = {
    configs,
    head,
    candidateWorkflow,
    storedRequest,
    requestLabel: path.basename(options.requestPath),
    defaults,
    candidatePersonas,
    operatorArtifacts: options.operatorArtifacts ?? false,
  }

  // The record does not exist yet, so the mutex is taken directly rather than
  // through withBestOfNSession. It stays held until the session is ready, so no
  // other command can act on a session that is still under construction.
  return withOperationMutex(bestOfNMutexPath(root, bonId), () => {
    try {
      return createSessionCandidates(root, opened, plan)
    } catch (error) {
      throw initializationFailure(bonId, error)
    }
  })
}

/**
 * Create every worktree, agent variant, and candidate run of a published
 * session record, recording each resource as it is claimed.
 *
 * The caller holds the session mutex.
 */
function createSessionCandidates(
  root: string,
  opened: BestOfNState,
  plan: SessionPlan,
): BestOfNState {
  let state = persistBestOfNState(root, opened)

  for (const candidate of plan.configs.candidates) {
    const pending: BestOfNPendingCandidate = {
      slot: candidate.name,
      worktree_path: bestOfNCandidatePath(state.bon_id, candidate.name),
      agent_suffix: agentSuffix(state.bon_id, candidate.name),
    }

    // Claimed before the worktree exists, so a failure can never leave a
    // worktree or an agent variant that the lifecycle commands cannot find.
    state = persistBestOfNState(root, {
      ...state,
      pending: [...state.pending, pending],
    })

    const worktreePath = resolveInside(root, pending.worktree_path)

    gitWorktreeAdd(root, worktreePath, plan.head)
    runSetupCommands(plan.configs.setup, worktreePath, {
      label: `candidate '${pending.slot}'`,
      code: 'BEST_OF_N_SETUP_FAILED',
    })
    projectPersonaVariants(
      root,
      pending.agent_suffix,
      personaMapFor(plan.defaults, candidate.personas, plan.candidatePersonas),
      { write: true },
    )

    const run = createRun(root, {
      workflowSlug: plan.candidateWorkflow,
      requestPath: plan.storedRequest,
      title: `${pending.slot} · ${plan.requestLabel}`,
      workspace: pending.worktree_path,
      pipelineOverride: {
        label: `best-of-n:${state.bon_id}:${pending.slot}`,
        personas: candidate.personas,
        source_path: `runtime/logs/best-of-n/${state.bon_id}/configs.json`,
        source_sha256: state.configs.sha256,
      },
      cursorAgentSuffix: pending.agent_suffix,
      useWorkflowDeclaredGates: true,
      operatorArtifacts: plan.operatorArtifacts,
      bestOfN: { bon_id: state.bon_id, role: 'candidate', slot: pending.slot },
    })

    state = persistBestOfNState(root, {
      ...state,
      candidates: [...state.candidates, { ...pending, run_id: run.run_id }],
      pending: state.pending.filter((entry) => entry.slot !== pending.slot),
    })
  }

  return persistBestOfNState(root, { ...state, status: 'ready' })
}

/**
 * Name the partial session and its recovery commands, keeping the original
 * cause and error code so the CLI still reports what actually failed.
 */
function initializationFailure(bonId: string, error: unknown): PanError {
  return new PanError(
    `Best-of-N initialization failed for session ${bonId}: ` +
      `${errorMessage(error)}\n` +
      `The partial session is recorded at runtime/logs/best-of-n/${bonId}/` +
      `state.json. Inspect it with './bin/pan best-of-n status ${bonId}' and ` +
      `remove its worktrees with './bin/pan best-of-n clean ${bonId}'.`,
    {
      code: error instanceof PanError ? error.code : 'BEST_OF_N_INIT_FAILED',
      details: { bon_id: bonId, cause: errorMessage(error) },
    },
  )
}

/**
 * Reject persona names no workflow or default declares. A mapped model only
 * takes effect through a known persona, so an unknown key is a typo that would
 * otherwise be dropped silently and leave the default model running a stage
 * the operator meant to override.
 */
function assertPersonaKeysKnown(
  personas: Record<string, string>,
  known: string[],
  source: string,
): void {
  const knownSet = new Set(known)

  for (const persona of Object.keys(personas)) {
    invariant(
      knownSet.has(persona),
      `${source} maps unknown persona '${persona}'. Known personas: ` +
        `${[...knownSet].sort().join(', ')}.`,
      { code: 'INVALID_BEST_OF_N_CONFIGS' },
    )
  }
}

/**
 * Builds the persona-to-model map for `personas`, taking each model from
 * `overrides` first and `defaults` second. Throws `INVALID_PIPELINE_CONFIG`
 * when a persona has no model in either.
 */
export function personaMapFor(
  defaults: Record<string, string>,
  overrides: Record<string, string>,
  personas: string[],
): Record<string, string> {
  const merged: Record<string, string> = {}

  for (const persona of personas) {
    const model = overrides[persona] ?? defaults[persona]

    invariant(model, `No model is mapped for persona '${persona}'.`, {
      code: 'INVALID_PIPELINE_CONFIG',
    })

    merged[persona] = model
  }

  return merged
}

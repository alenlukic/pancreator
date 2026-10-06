/**
 * Invocation preparation: the card, the supervisor procedure, and the delivery
 * packet a stage worker receives.
 */

import path from 'node:path'

import { assertCohortRunUnblocked } from '../cohorts/chunks.js'
import {
  buildInvocationInputs,
  operatorStageRepairContext,
  remediationReturn,
  scopedReturnForStage,
  summarizePriorFailure,
} from '../context.js'
import { resolveBriefVocabulary } from '../briefs/scaffold.js'
import { invariant } from '../errors.js'
import { withOperationMutex } from '../io.js'
import {
  assertSupervisorCardAttested,
  renderSupervisorCard,
} from '../governance/supervisor-card.js'
import { makeStageArtifactId } from '../naming.js'
import { evidenceWorkerAttemptPaths, resolveRunLayout } from '../run-layout.js'
import { buildSuiteProfileSummary } from '../suite-profile.js'
import { buildFastWallStageSummary } from '../fast-wall-series.js'
import {
  OPERATOR_ARTIFACT_PROFILE_HEADINGS,
  operatorArtifactProfileForStage,
} from '../operator-artifact-profiles.js'
import {
  operatorArtifactsRequested,
  requestStageOperatorArtifacts,
} from '../operator-artifacts.js'
import {
  harnessPathPrefix,
  isDetachedInstallation,
  isSelfDevelopmentInstallation,
  isTargetInstallation,
  panCommand,
} from '../project-config.js'
import { registerPreparedInvocation } from '../hypervisor.js'
import { resolvePolicies } from '../policies.js'
import { resolvePrDescriptionContext } from '../pr-description.js'
import { resolveRequirements } from '../requirements/resolve.js'
import { resolvePersonaMapping } from '../pipeline-config.js'
import {
  cursorAgentName,
  cursorAgentTarget,
  policyDeliveryPlan,
  workerCardHost,
} from '../projection.js'
import { evidenceWorkerAttempts } from '../render.js'
import {
  operationMutexPath,
  loadState,
  nextStageSequence,
  now,
} from '../state.js'
import type { Invocation, PersonaExecutorKind } from '../types.js'
import { delegationPath } from '../validation.js'
import { loadStagePrompt, stageBySlug } from '../workflow.js'
import { snapshotEntryPath } from '../git.js'
import { PROTECTED_PATH_RULE } from '../workspace/protected-paths.js'

import {
  ensureMutatingWorkflowInitialized,
  loadRunPipelineConfig,
  loadRunWorkflow,
  persistRun,
  readInvocation,
  recordRunAdvisories,
  runPipelineConfigAdvisories,
  workspaceDirectory,
  workspaceSnapshotForRun,
} from './core.js'
import { writeFunctionIndex } from '../function-index.js'
import {
  ensureWorkflowRepositoryCheckBaselines,
  ensureWorkspaceProvisioned,
  repositoryCheckBaselineGaps,
} from './baselines.js'
import { pauseForLimit } from './limits.js'
import { runStageEntryGate } from './entry-gate.js'
import {
  recordDefaultModelEvidence,
  runUsesModelEvidenceContract,
  startDetachedWorkerModelProbe,
} from './model-evidence.js'
import {
  harnessBaseline,
  pauseForRepositoryCheckBaselineGaps,
  pauseForVerificationRecommendation,
  pendingVerificationRecommendation,
  type PrepareInvocationOptions,
  type PrepareInvocationResult,
  refreshReturningVerifyProfiles,
  resolveStageForAttempt,
  scheduleEvidenceWorkers,
  stageFieldContract,
  writeLabeledDelegationArtifact,
} from './prepare-helpers.js'
import {
  buildInvocationDelegation,
  writeInvocationArtifacts,
} from './prepare-artifacts.js'

/** Agent-registry bookkeeping a lifecycle call owes once its state is durable. */
interface PreparedInvocationRegistration {
  run_id: string
  invocation_id: string
  persona: string
  executor: PersonaExecutorKind
  model: string | null
}

/**
 * Prepares the next worker invocation of a running run under its operation
 * mutex: refreshes the supervisor card and requires its attestation, records
 * pipeline-config advisories, spends a stage attempt, runs the workspace,
 * baseline, and entry-gate preflights, then writes the invocation card and
 * artifacts and persists `invocation_prepared`. Returns the already-prepared
 * invocation when one is pending. Returns a null invocation when a limit,
 * verification recommendation, baseline gap, or entry gate paused or rerouted
 * the run.
 *
 * The agent registry entry is written after the mutex is released. Throws
 * `RUN_NOT_RUNNING`, `INVALID_RUN_ACTION`, or `COHORT_PREDECESSOR_UNSATISFIED`,
 * among others.
 */
export function prepareInvocation(
  root: string,
  runId: string,
  options: PrepareInvocationOptions = {},
): PrepareInvocationResult {
  // The agent registry is bookkeeping, not run state, and the hypervisor
  // reconcile already tolerates a registry one event behind. Collect the write
  // here and perform it once the mutex is released, so the command returns as
  // soon as the run state is durable.
  const deferred: { registration: PreparedInvocationRegistration | null } = {
    registration: null,
  }
  const result = withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(
      state.status === 'running',
      `Run is not running: ${state.status}`,
      {
        code: 'RUN_NOT_RUNNING',
      },
    )

    // A cohort-bound run is blocked here, not only at `pan cohort start`, so
    // advancing the run directly cannot bypass the ordering blocker.
    assertCohortRunUnblocked(root, state)

    // Refresh the supervisor card first: a changed policy set re-binds the
    // supervisor before any stage work, and an unattested card stops here.
    const supervisorCard = renderSupervisorCard(
      root,
      state,
      loadRunWorkflow(root, state),
    )

    if (supervisorCard.changed) {
      persistRun(root, state, 'supervisor_card_rendered', {
        path: supervisorCard.state.path,
        sha256: supervisorCard.state.sha256,
        first: supervisorCard.first,
        policies: supervisorCard.policies.map((policy) => policy.id),
      })
    }

    // A run created before the card existed gains it on this prepare and is
    // bound from the next lifecycle action on.
    if (!supervisorCard.first) {
      assertSupervisorCardAttested(root, state, 'prepare')
    }

    // Load once, so the advisories and the persona mapping read one snapshot.
    const pipelineConfig = loadRunPipelineConfig(root, state)
    const advisories = runPipelineConfigAdvisories(root, state, pipelineConfig)

    if (advisories.length > 0) {
      recordRunAdvisories(
        state,
        {
          kind: 'pipeline_config',
          source: 'prepare',
          ...(state.current_stage ? { stage: state.current_stage } : {}),
        },
        advisories,
      )
      persistRun(root, state, 'pipeline_config_advisory', {
        stage: state.current_stage,
        advisories,
      })
    }

    if (options.operatorArtifacts) {
      const stageSlug = state.current_stage

      invariant(
        stageSlug,
        'Run has no current stage to request artifacts for.',
        {
          code: 'INVALID_RUN_ACTION',
        },
      )

      if (requestStageOperatorArtifacts(state, stageSlug)) {
        persistRun(root, state, 'operator_artifacts_requested', {
          scope: 'stage',
          stage: stageSlug,
        })
      }
    }

    if (
      state.pending_action.type === 'invoke_agent' &&
      state.current_invocation
    ) {
      return {
        state,
        invocation: readInvocation(root, state.current_invocation.json_path),
        advisories,
      }
    }

    invariant(
      state.pending_action.type === 'prepare_invocation',
      'Run is not ready to prepare an invocation.',
      {
        code: 'INVALID_RUN_ACTION',
        details: { pending: state.pending_action },
      },
    )

    const workflow = loadRunWorkflow(root, state)
    const stage = resolveStageForAttempt(
      root,
      state,
      stageBySlug(workflow, state.current_stage),
    )

    const mapping = resolvePersonaMapping(pipelineConfig, stage.persona)
    const model = mapping.model_spec
    const externalExecutor =
      mapping.executor !== 'cursor' ? mapping.executor : undefined

    // An invocation that was prepared but never submitted did no work, so it
    // must not spend an attempt. This happens whenever a card is superseded —
    // most often after an operator pause — and previously the discarded card
    // permanently consumed one of the stage's retries.
    const recordedAttempt = state.attempts[stage.slug] ?? 0
    const lastAttemptSubmitted =
      recordedAttempt === 0 ||
      state.stage_history.some(
        (item) => item.stage === stage.slug && item.attempt === recordedAttempt,
      )
    const attempt = lastAttemptSubmitted ? recordedAttempt + 1 : recordedAttempt

    // An operator refinement round is not a failed attempt. It raises the
    // ceiling instead of consuming budget reserved for failures, so directing a
    // plan through several revisions cannot exhaust the retry allowance the
    // stage still needs if it later fails on its own.
    const grantedRevisions = state.operator_revisions?.[stage.slug] ?? 0
    const attemptCeiling = state.limits.max_stage_attempts + grantedRevisions

    if (attempt > attemptCeiling) {
      const reason =
        `Stage '${stage.slug}' exceeded ${attemptCeiling} attempts ` +
        `(${state.limits.max_stage_attempts} configured` +
        (grantedRevisions > 0
          ? ` plus ${grantedRevisions} operator revision${grantedRevisions === 1 ? '' : 's'}`
          : '') +
        ').'

      const candidateFailed = pauseForLimit(root, state, reason)

      persistRun(
        root,
        state,
        candidateFailed ? 'candidate_failed' : 'run_paused',
        { reason },
      )

      return { state, invocation: null, advisories }
    }

    state.attempts[stage.slug] = attempt

    const recommendation = pendingVerificationRecommendation(root, state)

    if (recommendation) {
      pauseForVerificationRecommendation(root, state, recommendation)
      persistRun(root, state, 'run_paused', { reason: state.pause_reason })

      return { state, invocation: null, advisories }
    }

    ensureMutatingWorkflowInitialized(root, state, stage)
    const environmentBlocked =
      ensureWorkspaceProvisioned(root, state, workflow, options.onProgress) ||
      ensureWorkflowRepositoryCheckBaselines(
        root,
        state,
        workflow,
        stage,
        options.onProgress,
      )

    if (environmentBlocked) {
      persistRun(root, state, 'run_paused', { reason: state.pause_reason })

      return { state, invocation: null, advisories }
    }

    const baselineGaps = repositoryCheckBaselineGaps(root, state, stage)

    if (baselineGaps.length > 0) {
      pauseForRepositoryCheckBaselineGaps(root, state, stage, baselineGaps)
      persistRun(root, state, 'run_paused', { reason: state.pause_reason })

      return { state, invocation: null, advisories }
    }

    // INDEX-001: a worker on Pancreator's own source reads the function index
    // of the workspace it edits, so the harness regenerates it here rather
    // than asking any worker to. The pages are gitignored, so the workspace
    // fingerprint does not move, and a failure only leaves the index as it was.
    if (isSelfDevelopmentInstallation(root)) {
      try {
        writeFunctionIndex(workspaceDirectory(root, state))
      } catch {
        // The index is orientation, never a precondition of the stage.
      }
    }

    // The release gate runs here, on the workspace verify approved and before
    // the release steward commits anything, so a failure routes to repair
    // without a release commit to unwind. The gate records its result once
    // per visit; the ship submission reuses it.
    if (runStageEntryGate(root, state, stage, options.onProgress) !== 'pass') {
      return { state, invocation: null, advisories }
    }

    const invocationId = makeStageArtifactId(
      nextStageSequence(root, runId),
      stage.slug,
      attempt,
    )

    if (
      refreshReturningVerifyProfiles(
        root,
        state,
        workflow,
        stage,
        invocationId,
        options.onProgress,
      ) !== 'pass'
    ) {
      return { state, invocation: null, advisories }
    }

    const layout = resolveRunLayout(root, runId)

    const outputPath = layout.output(invocationId).relative
    const briefSourcePath = layout.artifactJson(
      `${invocationId}.brief.json`,
    ).relative
    const briefRenderedPath = layout.operatorHtml(invocationId).relative
    const prDescriptionPath =
      layout.operatorMarkdown('pr-description.md').relative

    const jsonPath = layout.invocation(invocationId, '.json').relative
    const markdownPath = layout.invocation(invocationId, '.md').relative
    const supervisorProcedurePath = layout.invocation(
      invocationId,
      '.supervisor.md',
    ).relative
    const delegationArtifactPath = delegationPath(runId, invocationId, root)

    const artifactsRequested = operatorArtifactsRequested(state, stage.slug)
    const workspace = workspaceSnapshotForRun(root, state)
    // A worker whose `run_when` condition fails stays off this visit, and the
    // card says why (`VERIFY-001`: QA runs only for a live criterion).
    const { workers: scheduledWorkers, skips: evidenceWorkerSkips } =
      scheduleEvidenceWorkers(root, state, stage)
    // A return visit that serves a small repair runs the stage worker alone;
    // the stage declares the limits and the harness decides from the record.
    const scopedDecision =
      stage.persona !== 'orchestrator'
        ? scopedReturnForStage(
            root,
            state,
            stage,
            workspace.entries
              .filter((entry) => entry.slice(0, 2).includes('D'))
              .map(snapshotEntryPath),
            scheduledWorkers,
          )
        : undefined
    const scopedReturn = scopedDecision?.scoped ?? undefined
    // A full-topology return visit reviews the remediation rather than the
    // whole change, so a worker's return-visit scope replaces its scope.
    const returnVisit =
      scheduledWorkers && !scopedReturn
        ? remediationReturn(root, state, stage)
        : undefined
    // Parallel evidence workers run as top-level named agents so their
    // persona-model mappings hold. Resolving them at prepare time makes a
    // missing mapping fail here rather than silently downgrade at launch.
    const evidenceWorkers =
      scheduledWorkers &&
      scheduledWorkers.length > 0 &&
      stage.persona !== 'orchestrator' &&
      !scopedReturn
        ? scheduledWorkers.map((worker) => {
            const workerMapping = resolvePersonaMapping(
              pipelineConfig,
              worker.persona,
            )
            const agentTarget = cursorAgentTarget(
              root,
              worker.persona,
              state.cursor_agent_suffix,
            )

            const paths = evidenceWorkerAttemptPaths(
              root,
              runId,
              invocationId,
              worker.role,
            )

            return {
              persona: worker.persona,
              role: worker.role,
              // An empty blast radius bounds nothing, so the brief says to
              // execute the scope in full and the first-visit scope stays.
              scope:
                returnVisit &&
                returnVisit.blast_radius.length > 0 &&
                worker.return_scope
                  ? worker.return_scope
                  : worker.scope,
              agent: (agentTarget.split('/').pop() ?? worker.persona).replace(
                /\.md$/u,
                '',
              ),
              model: workerMapping.model_spec,
              ...paths,
              attempts: [{ attempt: 1, ...paths, recorded_at: now() }],
            }
          })
        : undefined

    const contracts = state.operator_involvement?.contracts ?? []
    const policies = resolvePolicies(root, {
      persona: stage.persona,
      workflow: workflow.slug,
      stage: stage.slug,
      contracts,
      operator_artifacts: artifactsRequested ? 'requested' : 'suppressed',
    })
    const prDescription =
      stage.persona === 'release-steward' &&
      stage.slug === 'ship' &&
      (artifactsRequested || isSelfDevelopmentInstallation(root))
        ? resolvePrDescriptionContext(workspaceDirectory(root, state), policies)
        : undefined

    const requirements = resolveRequirements(root, {
      persona: stage.persona,
      workflow: workflow.slug,
      stage: stage.slug,
      contracts,
      invocation: {
        output_path: outputPath,
        artifact_paths: artifactsRequested
          ? [briefRenderedPath, ...(prDescription ? [prDescriptionPath] : [])]
          : prDescription
            ? [prDescriptionPath]
            : [],
        ...(prDescription
          ? { artifact_targets: { pr_description: prDescriptionPath } }
          : {}),
      },
      operator_artifacts: artifactsRequested ? 'requested' : 'suppressed',
    })
    const nextAction =
      stage.persona === 'orchestrator'
        ? `Complete this stage in the current chat with model '${model}' ` +
          `when available, write ${outputPath}, then submit it.`
        : externalExecutor
          ? `Run the delegate command from the supervisor procedure to ` +
            `execute the '${stage.persona}' stage under the ` +
            `'${externalExecutor}' executor with model '${model}', then ` +
            `submit ${outputPath}.`
          : // The next action must name the first executable step in this
            // invocation's real dependency graph. Naming the consolidating
            // worker while its evidence workers are still unrun sends the
            // supervisor past a precondition the card only states further
            // down, and the worker then correctly reports `blocked`.
            ((evidenceWorkers ?? []).length > 0
              ? `Launch the ${(evidenceWorkers ?? []).length} parallel evidence ` +
                `worker(s) first — ` +
                (evidenceWorkers ?? [])
                  .map((worker) => `${worker.agent} -> ${worker.evidence_path}`)
                  .join(', ') +
                ` — and confirm every report exists and is non-empty. Only ` +
                `then launch `
              : scopedReturn
                ? `Scoped return visit: no evidence worker runs, and the ` +
                  `stage worker records the ` +
                  scopedReturn.dimensions
                    .map((item) => item.role)
                    .join(' and ') +
                  ` dimensions itself. Launch `
                : 'Launch ') +
            `the named Cursor agent for persona '${stage.persona}' ` +
            `(never an ad-hoc subagent; only the named definition runs ` +
            `'${model}') with this card, write delegation evidence to ` +
            `${delegationArtifactPath}, then submit ${outputPath}.`

    const delegation = buildInvocationDelegation({
      root,
      runId,
      state,
      workflow,
      stage,
      externalExecutor,
      invocationId,
      outputPath,
      jsonPath,
      markdownPath,
      delegationArtifactPath,
      supervisorProcedurePath,
    })

    const artifactProfile = operatorArtifactProfileForStage(
      stage.slug,
      workflow.slug,
    )
    // An operator return to this stage supersedes the last recorded attempt
    // of it, so the note is the reason and the older record is not.
    const stageRepair = operatorStageRepairContext(state, stage)
    const priorFailure = stageRepair
      ? null
      : summarizePriorFailure(state, stage, root)
    const briefVocabulary = artifactsRequested
      ? resolveBriefVocabulary(root)
      : undefined

    const requiredData = { ...(stage.required_data ?? {}) }
    const fieldContract = stageFieldContract(
      root,
      workflow.slug,
      stage.slug,
      requirements.validation_requirements,
      artifactsRequested,
    )

    if (stage.persona === 'coder' && attempt > 1) {
      requiredData['implementation.remediation'] = 'array'
    }

    // VERIFY-001: QA cases are owed only on a visit that runs QA, either as
    // an evidence worker or as a dimension a scoped return assigns.
    if (
      requiredData.verify === 'object' &&
      [...(evidenceWorkers ?? []), ...(scopedReturn?.dimensions ?? [])].some(
        (worker) => worker.role === 'qa',
      )
    ) {
      requiredData['verify.qa_cases'] = 'array'
    }

    if (
      stage.persona === 'release-steward' &&
      stage.slug === 'ship' &&
      isSelfDevelopmentInstallation(root)
    ) {
      Object.assign(requiredData, {
        'release.versioning': 'object',
        'release.versioning.current_version': 'string',
        'release.versioning.recommendation': 'string',
        'release.versioning.proposed_version': 'string',
        'release.versioning.baseline_commit': 'string',
        'release.versioning.rationale': 'string',
        'release.versioning.compatibility': 'string',
        'release.versioning.updated_files': 'array',
        'release.versioning.release_index_action': 'string',
      })

      if (state.managed_worktree) {
        Object.assign(requiredData, {
          'release.local_release': 'object',
          'release.local_release.fetched_main': 'string',
          'release.local_release.release_commit': 'string',
          'release.local_release.index_commit': 'string',
          'release.local_release.branch': 'string',
          'release.local_release.pr_description_path': 'string',
        })
      }
    }

    // Advisory: the profiled full run before ship, when the run recorded one.
    const suiteProfile = stage.context.suite_profile
      ? buildSuiteProfileSummary(root, state)
      : null
    const fastWall = stage.context.suite_profile
      ? buildFastWallStageSummary(root, state)
      : null

    const invocation: Invocation = {
      $operator: {
        headline: `${stage.title} is ready`,
        summary:
          `The harness prepared attempt ${attempt} with model '${model}'` +
          (externalExecutor
            ? ` under the '${externalExecutor}' executor`
            : '') +
          `, ${policies.length} scoped policies, and a workspace fingerprint.`,
        next_action: nextAction,
      },
      schema_version: 1,
      invocation_id: invocationId,
      run_id: runId,
      attempt,
      created_at: now(),
      workspace_root: state.workspace_root || '.',
      installation_mode: isSelfDevelopmentInstallation(root)
        ? 'self_development'
        : isDetachedInstallation(root)
          ? 'detached'
          : 'embedded',
      ...(state.managed_worktree
        ? { managed_worktree: state.managed_worktree }
        : {}),
      ...(state.workspace_root && state.workspace_root !== '.'
        ? { harness_root: root }
        : {}),
      ...(state.gate_overrides ? { gate_overrides: state.gate_overrides } : {}),
      ...(state.operator_involvement
        ? { operator_involvement: state.operator_involvement }
        : {}),
      ...(state.verification ? { verification: state.verification } : {}),
      workflow: {
        slug: workflow.slug,
        snapshot_path: state.workflow_snapshot.path,
        snapshot_sha256: state.workflow_snapshot.sha256,
      },
      stage: {
        slug: stage.slug,
        title: stage.title,
        persona: stage.persona,
        ...(stage.executor ? { executor: stage.executor } : {}),
        ...(externalExecutor ? { persona_executor: externalExecutor } : {}),
        model,
        model_config: pipelineConfig.name,
        workspace_policy: stage.workspace_policy,
        gate: stage.gate,
      },
      prompt: loadStagePrompt(root, stage),
      ...(priorFailure ? { prior_failure: priorFailure } : {}),
      ...(stageRepair ? { operator_stage_repair: stageRepair } : {}),
      inputs: buildInvocationInputs({
        root,
        state,
        stage,
        attempt,
        invocationId,
        workspaceFingerprint: workspace.fingerprint,
        workspace,
        ...(prDescription ? { prDescription } : {}),
      }),
      ...(evidenceWorkers ? { evidence_workers: evidenceWorkers } : {}),
      ...(evidenceWorkerSkips.length > 0 && stage.persona !== 'orchestrator'
        ? { evidence_worker_skips: evidenceWorkerSkips }
        : {}),
      ...(scopedReturn ? { scoped_return: scopedReturn } : {}),
      ...(suiteProfile ? { suite_profile: suiteProfile } : {}),
      ...(fastWall ? { fast_wall: fastWall } : {}),
      policies,
      policy_delivery: policyDeliveryPlan(root, policies, {
        executor: externalExecutor ?? 'cursor',
        host: workerCardHost(root),
        mode: isSelfDevelopmentInstallation(root)
          ? 'self_development'
          : isDetachedInstallation(root)
            ? 'detached'
            : 'embedded',
      }),
      requirements,
      rubric: stage.criteria,
      output: {
        path: outputPath,
        template: 'library/templates/stage-output.example.json',
        schema: 'library/schemas/stage-output.schema.json',
        // The exact command, with the JSON snapshot the scaffold interface
        // accepts, so a delegated worker never reconstructs it from the
        // requirement table and never reaches for the Markdown contract.
        ...(stage.persona === 'orchestrator'
          ? {}
          : {
              scaffold_command:
                `${panCommand(root)} output scaffold ${runId} ` +
                `--invocation ${jsonPath} --output ${outputPath}`,
            }),
        required_data: requiredData,
        ...(prDescription
          ? {
              artifacts: [
                ...(artifactsRequested
                  ? [
                      {
                        path: briefRenderedPath,
                        description:
                          'Primary self-contained HTML brief for the operator.',
                      },
                    ]
                  : []),
                {
                  path: prDescriptionPath,
                  description:
                    'Pull-request description validated against target authority.',
                },
              ],
            }
          : {}),
        ...(fieldContract ? { field_contract: fieldContract } : {}),
        ...(artifactsRequested && briefVocabulary
          ? {
              operator_brief: {
                source_path: briefSourcePath,
                rendered_path: briefRenderedPath,
                ...(layout.version === 'v2'
                  ? {
                      source_lifecycle: 'transient' as const,
                      source_transient: true,
                    }
                  : {}),
                schema: 'library/schemas/operator-brief.schema.json',
                renderer: 'pan briefs render',
                profile: artifactProfile,
                required_headings: [
                  ...OPERATOR_ARTIFACT_PROFILE_HEADINGS[artifactProfile],
                ],
                allowed_card_types: briefVocabulary.card_types,
                allowed_section_semantics: briefVocabulary.section_semantics,
              },
            }
          : {}),
      },
      boundaries: [
        'You MUST read this invocation card before broader repository context.',
        ...(isTargetInstallation(root)
          ? [
              `Harness-relative paths beginning runtime/, library/, or governance/ are rooted at ${harnessPathPrefix(root)}/ when accessed from the target repository in Cursor.`,
            ]
          : []),
        `You MUST respect workspace policy '${stage.workspace_policy}'.`,
        PROTECTED_PATH_RULE,
        ...(stage.workspace_policy === 'release_metadata_only'
          ? [
              ...(isSelfDevelopmentInstallation(root)
                ? [
                    'You MAY also edit only CHANGELOG.md, VERSION, package.json, package-lock.json, README.md, and version-bearing Markdown under docs/ as required by VERSION-001.',
                    'You MAY run the declared local release commands to checkpoint eligible source, rebase, and create the release and index commits.',
                  ]
                : []),
              'You MAY repair Pancreator runtime governance and artifact files for this run. You MUST NOT modify target source during ship.',
            ]
          : ['You MUST write only the declared output and evidence.']),
        ...(stage.persona === 'orchestrator'
          ? []
          : externalExecutor
            ? [
                `The harness authors delegation evidence at ${delegationArtifactPath} itself. You MUST NOT write that artifact or workspace-root .delegation.md.`,
              ]
            : [
                `The delegation artifact at ${delegationArtifactPath} is supervisor-owned delivery evidence. You MUST NOT write or modify it, and MUST NOT write workspace-root .delegation.md.`,
              ]),
        'You MUST NOT alter workflow state directly.',
        'While a mutating workflow is active, external edits to tracked files SHOULD be avoided because they make stage attribution ambiguous; pause the run before operator-authored changes.',
        ...(stage.workspace_policy === 'release_metadata_only' &&
        isSelfDevelopmentInstallation(root)
          ? [
              'You MUST NOT push, open or merge a pull request, publish, deploy, rewrite history, or perform other destructive source-control actions.',
            ]
          : [
              'You MUST NOT push, publish, deploy, or perform destructive source-control actions.',
            ]),
      ],
      ...(delegation ? { delegation } : {}),
      ...(!externalExecutor &&
      stage.persona !== 'orchestrator' &&
      runUsesModelEvidenceContract(state)
        ? { model_evidence_required: true }
        : {}),
      ...((state.workspace_directives ?? []).length > 0
        ? { attributed_changes: state.workspace_directives }
        : {}),
      workspace_before: workspace,
      ...harnessBaseline(root, state),
    }

    writeInvocationArtifacts({
      root,
      runId,
      state,
      stage,
      invocation,
      invocationId,
      delegation,
      evidenceWorkers,
      artifactsRequested,
      artifactProfile,
      briefSourcePath,
      supervisorProcedurePath,
      markdownPath,
      jsonPath,
    })

    const preparedAt = now()

    state.current_invocation = {
      id: invocationId,
      json_path: jsonPath,
      markdown_path: markdownPath,
      output_path: outputPath,
      prepared_at: preparedAt,
      last_activity_at: preparedAt,
    }
    state.pending_action = {
      type: 'invoke_agent',
      persona: stage.persona,
      path: markdownPath,
    }

    persistRun(root, state, 'invocation_prepared', {
      invocation_id: invocationId,
      stage: stage.slug,
      attempt,
      // Audits count scoped and declined return visits from this record.
      ...(scopedDecision
        ? {
            scoped_return: scopedDecision.scoped !== null,
            ...(scopedDecision.scoped === null
              ? { scoped_return_declined: scopedDecision.reason }
              : {}),
          }
        : {}),
      // Audits count the evidence workers a run condition kept off a visit.
      ...(invocation.evidence_worker_skips
        ? {
            evidence_workers_skipped: invocation.evidence_worker_skips.map(
              (skip) => skip.role,
            ),
          }
        : {}),
    })
    recordDefaultModelEvidence(root, state, invocation)
    deferred.registration = {
      run_id: runId,
      invocation_id: invocationId,
      persona: stage.persona,
      executor: invocation.stage.persona_executor ?? 'cursor',
      model: invocation.stage.model,
    }

    return { state, invocation, advisories }
  })

  if (deferred.registration) {
    registerPreparedInvocation(root, deferred.registration)
  }

  // The delegation artifact and the probe belong to the delivery the
  // supervisor is about to perform, and both need the mutex this block no
  // longer holds: the probe records its marker through its own transaction.
  // A Cursor stage already names its projected agent on the invocation, so a
  // bare prepare can produce the complete delivery packet. `--agent` remains
  // the explicit label override, and for an evidence-role agent it answers
  // that role's allocation as well.
  if (
    result.invocation &&
    (options.prepareDelegation === true || options.agent !== undefined)
  ) {
    const invocation = result.invocation
    const evidenceWorker =
      options.agent === undefined
        ? undefined
        : (invocation.evidence_workers ?? []).find(
            (worker) => worker.agent === options.agent,
          )
    // One agent name can serve an evidence role and the stage worker at
    // once, because both names come from the same persona projection.
    // Answering only the evidence question then dropped the stage's own
    // delegation artifact, so each question is answered on its own.
    const stageAgentPath = invocation.delegation?.cursor_agent_path
    const delegatesStage =
      options.agent === undefined ||
      (stageAgentPath !== undefined &&
        path.basename(stageAgentPath, path.extname(stageAgentPath)) ===
          options.agent)

    let prepared: PrepareInvocationResult = result

    if (evidenceWorker) {
      const evidenceAttempt = evidenceWorkerAttempts(evidenceWorker).at(-1)

      invariant(evidenceAttempt, 'Prepared evidence worker has no attempt.', {
        code: 'EVIDENCE_ATTEMPT_MISSING',
      })

      prepared = {
        ...prepared,
        prepared_evidence: {
          role: evidenceWorker.role,
          agent: evidenceWorker.agent,
          prompt_path: evidenceAttempt.brief_path,
          evidence_path: evidenceAttempt.evidence_path,
          attempt: evidenceAttempt.attempt,
        },
      }
    }

    if (!evidenceWorker || delegatesStage) {
      // Only a referenced-mode delegation writes an artifact, and every such
      // delegation names its projected agent, so the label is never derived
      // from a persona: a persona slug is not an agent a supervisor can launch.
      const written = writeLabeledDelegationArtifact(
        root,
        invocation,
        options.agent ?? cursorAgentName(stageAgentPath),
      )
      const probe =
        written.artifact_path === null
          ? null
          : startDetachedWorkerModelProbe(root, runId, invocation.invocation_id)

      prepared = {
        ...prepared,
        prepared_delegation: {
          ...written,
          model_evidence: probe?.evidence ?? null,
          probe_pid: probe?.probe_pid ?? null,
        },
      }
    }

    return prepared
  }

  return result
}

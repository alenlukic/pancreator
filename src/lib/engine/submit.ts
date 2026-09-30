/**
 * Stage submission: validating a worker's output, running its gates, and
 * recording the outcome and transition.
 */

import { rmSync } from 'node:fs'

import { invariant } from '../errors.js'
import {
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
  sha256,
  withOperationMutex,
  writeJsonAtomic,
} from '../io.js'
import { assertSupervisorCardAttested } from '../governance/supervisor-card.js'
import { resolveRunLayout } from '../run-layout.js'
import {
  buildFastWallReport,
  formatFastWallReport,
  FAST_WALL_CRITERION_ID,
} from '../fast-wall-series.js'
import { isSelfDevelopmentInstallation, panCommand } from '../project-config.js'
import { completeInvocationAgent } from '../hypervisor.js'
import { artifactJsonPath } from '../workflow-artifacts.js'
import { runHasContract } from '../operator-involvement.js'
import { unrecordedProfileClaimAdvisories } from '../repository-checks.js'
import {
  operationMutexPath,
  loadState,
  now,
  runDir,
  writeDecision,
} from '../state.js'
import type {
  RunAdvisory,
  RunState,
  StageHistoryItem,
  TaskRecord,
} from '../types.js'
import {
  attestationValidationPath,
  buildValidationArtifact,
  delegationPath,
  delegationValidationPath,
  evaluateDeterministicCriteria,
  expectedDelegationSource,
  relocateMisplacedDelegationArtifact,
  validateDelegationMarkdown,
  validateInvocationAttestation,
  validateStageOutput,
} from '../validation.js'
import { stageBySlug } from '../workflow.js'
import { gitWorkspaceSnapshot } from '../git.js'
import { buildCurrency, buildCurrencyAdvisory } from '../build-identity.js'
import { workerInvocationSuiteCost } from '../worker-profile.js'

import {
  loadRunWorkflow,
  type OperationProgressOptions,
  persistRun,
  readInvocation,
  readTaskRecord,
  recordGovernanceArtifactIssues,
  recordRunAdvisories,
  workspaceDirectory,
} from './core.js'
import {
  pendingReleaseProfilePrefetch,
  startReleaseProfilePrefetch,
} from './prefetch.js'
import {
  classifyHorizonFailure,
  clearSameReasonTracker,
  collectHardFailureSignature,
  type HorizonFailureAction,
  isSameReasonTrackedStage,
  pauseForHorizonLadder,
  pauseForSameReasonFailure,
  recordSameReasonFailure,
} from './limits.js'
import { applyTransition } from './transition.js'
import { currentEntryGatePass } from './entry-gate.js'
import { settleSubmissionModelEvidence } from './model-evidence.js'
import { runHarnessAuthoritativeValidators } from './submit-validators.js'
import {
  blockingCriterionStateErrors,
  effectiveOutcome,
  emitSuiteCostInboxItem,
  emitVerifyWarningsInboxItem,
  materializeOperatorBrief,
  materializeOutputSubmission,
  submittedInvocationId,
} from './submit-helpers.js'
import { recordOperatorFeedback } from './recovery.js'
import {
  incompleteEvidenceReports,
  observeSubmissionDelegation,
} from './submit-checks.js'

export interface SubmitOutputResult {
  state: RunState
  record: TaskRecord
  /** Observations this submission recorded. None of them stops the run. */
  advisories: RunAdvisory[]
  idempotent?: boolean
}

/**
 * Accepts a worker's stage output for the active invocation under the run's
 * operation mutex: checks the supervisor card attestation, model evidence,
 * delegation evidence, and evidence reports, validates the output, reruns the
 * stage's deterministic gates, decides the outcome, and appends stage history.
 * Then routes the run: to supervisor assessment, operator approval, the next
 * stage through the transition, or a pause for an environment block, a
 * same-reason repeat, or an exhausted long-horizon ladder. Writes the task
 * record and persists `stage_output_submitted`.
 *
 * Resubmitting an invocation that already has a task record returns that record
 * unchanged with `idempotent` set. Throws `RUN_NOT_RUNNING`,
 * `INVALID_RUN_ACTION`, `MODEL_EVIDENCE_MISMATCH`, `EVIDENCE_REPORT_MISSING`,
 * or `INVALID_REVISION` without consuming an attempt. The agent registry update
 * and any prefetch process start after the mutex is released.
 */
export function submitOutput(
  root: string,
  runId: string,
  submittedPath: string,
  options: OperationProgressOptions = {},
): SubmitOutputResult {
  // Both of these run after the mutex is released: the registry write is
  // bookkeeping the run state does not depend on, and the prefetch child is
  // work nothing joins.
  const deferred: {
    completedInvocationId: string | null
    prefetch: { profile: string; workspace_fingerprint: string } | null
  } = { completedInvocationId: null, prefetch: null }
  const result = withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)
    const submittedRaw = readJson(resolveInside(root, submittedPath))

    const materialized = materializeOutputSubmission(
      root,
      state,
      submittedRaw,
      state.current_invocation?.id ?? null,
    )
    const submittedValue = materialized.value
    const priorForRevision = materialized.revisedFrom

    const invocationId = submittedInvocationId(submittedValue)
    const existing = invocationId
      ? state.stage_history.find((item) => item.invocation_id === invocationId)
      : undefined

    if (existing?.record_path) {
      const recordPath = artifactJsonPath(runId, existing.invocation_id, root)

      return {
        state,
        record: readTaskRecord(root, recordPath),
        advisories: [],
        idempotent: true,
      }
    }

    invariant(
      state.status === 'running',
      `Run is not running: ${state.status}`,
      {
        code: 'RUN_NOT_RUNNING',
      },
    )
    assertSupervisorCardAttested(root, state, 'submit')
    invariant(
      state.pending_action.type === 'invoke_agent',
      'Run is not awaiting stage output.',
      { code: 'INVALID_RUN_ACTION' },
    )
    invariant(state.current_invocation, 'Run has no active invocation.', {
      code: 'INVALID_RUN_ACTION',
    })

    const workflow = loadRunWorkflow(root, state)
    const stage = stageBySlug(workflow, state.current_stage)
    const invocation = readInvocation(root, state.current_invocation.json_path)

    const modelEvidence = settleSubmissionModelEvidence(root, state, invocation)
    const modelEvidenceAdvisories = modelEvidence.advisories

    // A recorded model that contradicts the run snapshot is the one model
    // failure that is not an advisory: the stage ran on a model this run did
    // not declare, so its verdict is not the one the run asked for. Like a
    // missing evidence report, it rejects outright without consuming an
    // attempt.
    invariant(
      modelEvidence.mismatches.length === 0,
      `Model evidence for invocation '${invocation.invocation_id}' ` +
        `contradicts the run snapshot: ${modelEvidence.mismatches.join('; ')}. ` +
        `Relaunch the affected worker on the declared model, or re-probe ` +
        `with ${panCommand(root)} models --probe --run ${runId} ` +
        `--invocation ${invocation.invocation_id} --await-probe.`,
      {
        code: 'MODEL_EVIDENCE_MISMATCH',
        details: {
          run_id: runId,
          invocation_id: invocation.invocation_id,
          mismatches: modelEvidence.mismatches,
        },
      },
    )
    // One path records an advisory and collects it for the submit result.
    // Each advisory kind arrived in its own change, and the third author
    // recorded to run state only, so `pan status` listed a conflict the
    // submit result that recorded it did not.
    const advisories: RunAdvisory[] = []
    const advise = (kind: RunAdvisory['kind'], messages: string[]): void => {
      advisories.push(
        ...recordRunAdvisories(
          state,
          {
            kind,
            source: 'submit',
            stage: stage.slug,
            invocation_id: invocation.invocation_id,
          },
          messages,
        ),
      )
    }

    advise('model_evidence', modelEvidenceAdvisories)

    if (modelEvidenceAdvisories.length > 0) {
      persistRun(root, state, 'model_evidence_advisory', {
        invocation_id: invocation.invocation_id,
        stage: stage.slug,
        advisories: modelEvidenceAdvisories,
      })
    }

    const incompleteReports = incompleteEvidenceReports(root, invocation)

    advise('evidence_report', incompleteReports)

    const personaExecutor = invocation.stage.persona_executor ?? 'cursor'

    const delegationObservation = observeSubmissionDelegation(
      root,
      runId,
      stage,
      invocation,
      personaExecutor,
      advise,
    )

    if (priorForRevision) {
      invariant(
        priorForRevision.stage === stage.slug,
        `Revision targets a '${priorForRevision.stage}' attempt, but the ` +
          `active stage is '${stage.slug}'.`,
        { code: 'INVALID_REVISION' },
      )
    }

    const governanceArtifactWarnings: string[] = []
    const attestationErrors: string[] = []

    if (stage.persona !== 'orchestrator') {
      if (personaExecutor === 'cursor') {
        relocateMisplacedDelegationArtifact(
          root,
          runId,
          invocation.invocation_id,
        )
      }

      const delegationArtifactPath = delegationPath(
        runId,
        invocation.invocation_id,
        root,
      )
      const delegationAbsolute = resolveInside(root, delegationArtifactPath)

      if (!fileExists(delegationAbsolute)) {
        governanceArtifactWarnings.push(
          `Delegation artifact is missing: ${delegationArtifactPath}`,
        )
      } else {
        // Referenced delivery compares evidence with the compact prompt the
        // supervisor was given; verbatim delivery with the whole card; a
        // resumed external delegation with the persisted revision directive.
        // An invocation prepared before referenced mode existed carries no
        // delivery prompt, so it keeps full-card equality.
        const deliveredSource = expectedDelegationSource(root, invocation)
        const mode = deliveredSource.mode
        const deliveredSourcePath = deliveredSource.path
        const deliveredAbsolute = resolveInside(root, deliveredSourcePath)

        const delegationMarkdown = readText(delegationAbsolute)
        const delegationValidation = fileExists(deliveredAbsolute)
          ? validateDelegationMarkdown(
              readText(deliveredAbsolute),
              delegationMarkdown,
              mode,
            )
          : {
              passed: false,
              checks: [
                {
                  id: 'delegation.delivered_body_present',
                  passed: false,
                  message: `Delivered body is missing: ${deliveredSourcePath}`,
                },
              ],
            }
        const delegationValidationArtifactPath = delegationValidationPath(
          runId,
          invocation.invocation_id,
          root,
        )
        const delegationValidationArtifact = buildValidationArtifact({
          run_id: runId,
          invocation_id: invocation.invocation_id,
          kind: 'delegation',
          status: delegationValidation.passed ? 'pass' : 'fail',
          checks: delegationValidation.checks,
          artifact_path: delegationArtifactPath,
        })

        writeJsonAtomic(
          resolveInside(root, delegationValidationArtifactPath),
          delegationValidationArtifact,
        )

        if (!delegationValidation.passed) {
          governanceArtifactWarnings.push(
            `Delegation validation failed: ${delegationValidationArtifact.summary}`,
          )
        }
      }

      // Referenced delivery gives the harness no way to observe the read itself,
      // so the declared attestation is the observable and it is checked exactly.
      // The contract file is re-hashed here as well: the worker is told not to
      // recompute the digest, so the harness owns that comparison.
      const attestation = validateInvocationAttestation(
        invocation,
        submittedValue,
        { root },
      )
      const attestationArtifactPath = attestationValidationPath(
        runId,
        invocation.invocation_id,
        root,
      )
      const attestationArtifact = buildValidationArtifact({
        run_id: runId,
        invocation_id: invocation.invocation_id,
        kind: 'attestation',
        status: attestation.passed ? 'pass' : 'fail',
        checks: attestation.checks,
        artifact_path: state.current_invocation.output_path,
      })

      writeJsonAtomic(
        resolveInside(root, attestationArtifactPath),
        attestationArtifact,
      )

      if (!attestation.passed) {
        attestationErrors.push(
          `Invocation read attestation failed: ${attestationArtifact.summary}`,
        )
      }
    }

    const briefErrors = materializeOperatorBrief(root, invocation)
    // A failed render leaves the HTML absent, which would otherwise raise a
    // second "artifact does not exist" error and a third validator target-missing
    // error, both blaming the worker for one harness-side render failure. Keep
    // the root diagnostic and drop the derivatives.
    const briefRenderFailed = briefErrors.length > 0
    const briefRenderedPath = invocation.output.operator_brief?.rendered_path
    const validation = validateStageOutput(
      root,
      stage,
      invocation,
      submittedValue,
    )

    if (briefRenderFailed && briefRenderedPath) {
      validation.errors = validation.errors.filter(
        (message) => !message.includes(briefRenderedPath),
      )
    }
    writeJsonAtomic(
      resolveInside(root, state.current_invocation.output_path),
      submittedValue,
    )

    // OPERATOR-001: record a platform-guidance conflict as an advisory, so
    // `pan status` lists it for the supervisor.
    const guidanceConflicts =
      validation.output.platform_guidance_conflicts ?? []

    if (guidanceConflicts.length > 0) {
      const messages = guidanceConflicts.map(
        (conflict) =>
          `Platform guidance conflict: "${conflict.guidance}" covered ` +
          `${conflict.covered_step}; the worker followed ` +
          `${conflict.authority_followed}.`,
      )

      advise('platform_guidance', messages)
      persistRun(root, state, 'platform_guidance_conflict', {
        invocation_id: invocation.invocation_id,
        stage: stage.slug,
        conflicts: guidanceConflicts,
      })
    }

    // Claim, attestation, and artifact validators run before any repository
    // check gate. A shell gate can only confirm a success — `effectiveOutcome`
    // decides failure from a declared non-success result, a failed hard
    // self-criterion, a failed attestation, or a blocking harness validator
    // before deterministic results are consulted. When one of those has
    // already decided the outcome, running the gate commands (QA's full suite
    // above all) spends minutes proving nothing, so they are recorded as
    // skipped with the deciding reason instead of executed.
    // The commit base lets the scope criterion tell a commit of content the
    // stage already held from a change to the workspace.
    const workspaceAfter = gitWorkspaceSnapshot(
      workspaceDirectory(root, state),
      { commitBase: invocation.workspace_before.head },
    )
    const profileClaimAdvisories = unrecordedProfileClaimAdvisories(
      root,
      runId,
      workspaceAfter.fingerprint,
      submittedValue,
    )

    advise(
      'repository_check_claim',
      profileClaimAdvisories.map((advisory) => advisory.message),
    )

    const harnessValidation = runHarnessAuthoritativeValidators(
      root,
      runId,
      invocation,
      workspaceAfter.fingerprint,
      submittedValue as Record<string, unknown>,
      state as unknown as Record<string, unknown>,
    )
    const filterBriefDerivatives = (messages: string[]): string[] =>
      briefRenderFailed && briefRenderedPath
        ? messages.filter((message) => !message.includes(briefRenderedPath))
        : messages

    // A missing or mismatched attestation blocks every stage, because it means
    // the harness cannot show that the worker held the contract it acted on.
    // A required or authoritative harness validator failure blocks whichever
    // stage its policy binds it to — the enforcement and failure route the
    // card declares must be the enforcement the engine applies. Advisory
    // validator failures stay governance warnings on every stage, or the
    // advisory enforcement declared on the card would be false. Ship
    // additionally blocks on operator-brief and stage-output diagnostics.
    const blockingValidatorErrors = filterBriefDerivatives(
      harnessValidation.blocking_errors,
    ).map((message) => `Validator: ${message}`)
    const blockingCriterionErrors = blockingCriterionStateErrors(
      validation.issues,
    ).map((message) => `Stage output: ${message}`)
    const blockingValidationErrors =
      stage.slug === 'ship'
        ? [
            ...attestationErrors,
            ...briefErrors.map((message) => `Operator brief: ${message}`),
            ...validation.errors.map((message) => `Stage output: ${message}`),
            ...blockingValidatorErrors,
          ]
        : [
            ...attestationErrors,
            ...blockingCriterionErrors,
            ...blockingValidatorErrors,
          ]

    const declaredNonSuccess =
      isRecord(submittedValue) &&
      (submittedValue.result === 'failure' ||
        submittedValue.result === 'blocked')
        ? (submittedValue.result as string)
        : null
    const selfEvaluations = new Map(
      validation.output.criteria.map((item) => [item.id, item]),
    )
    const failedHardSelfCriterion = stage.criteria.find(
      (criterion) =>
        criterion.hard && selfEvaluations.get(criterion.id)?.result === 'fail',
    )

    const rejectingValidatorIds = [
      ...new Set(
        harnessValidation.blocking_errors
          .map(
            (message) => /^harness validator (\S+) failed/u.exec(message)?.[1],
          )
          .filter((value): value is string => typeof value === 'string'),
      ),
    ]
    const gateSkipReason = declaredNonSuccess
      ? `the stage reported result '${declaredNonSuccess}'`
      : attestationErrors.length > 0
        ? 'the invocation read attestation failed'
        : rejectingValidatorIds.length > 0
          ? `harness validator ${rejectingValidatorIds.join(', ')} rejected the output`
          : blockingValidationErrors.length > 0
            ? 'a blocking artifact or stage-output validator rejected the output'
            : failedHardSelfCriterion
              ? `hard criterion '${failedHardSelfCriterion.id}' was self-evaluated as failed`
              : null
    const entryGatePass = currentEntryGatePass(state, stage)
    const evaluated = evaluateDeterministicCriteria(
      root,
      runDir(root, runId),
      state,
      stage,
      invocation.workspace_before,
      workspaceDirectory(root, state),
      state.gate_overrides ?? {},
      invocation.invocation_id,
      validation.output,
      options.onProgress,
      gateSkipReason,
      workspaceAfter,
      entryGatePass ? { [entryGatePass.id]: entryGatePass } : {},
      invocation.harness_before,
    )

    advise('gate_bypass', evaluated.advisories)

    // The ceiling is soft, so `pan tests wall` passes over it and the
    // criterion result cannot carry the breach. The report itself does.
    const suiteCostResult = evaluated.results.find(
      (result) =>
        result.id === FAST_WALL_CRITERION_ID && result.skipped !== true,
    )
    const suiteCostReport = suiteCostResult ? buildFastWallReport(root) : null

    if (suiteCostResult && suiteCostReport?.status === 'over_ceiling') {
      const message = formatFastWallReport(suiteCostReport)
      const intakePath = emitSuiteCostInboxItem(
        root,
        state,
        message,
        suiteCostResult.evidence_path,
      )

      advise('suite_cost', [`${message} Intake: ${intakePath}.`])
      persistRun(root, state, 'suite_cost_advisory', {
        stage: stage.slug,
        invocation_id: invocation.invocation_id,
        criterion: FAST_WALL_CRITERION_ID,
        intake_path: intakePath,
        evidence_path: suiteCostResult.evidence_path ?? null,
      })
    }

    // A source stage's worker iterates on the impacted profile. A gate
    // profile it runs itself, or a file it reads through the shell, spends
    // turns and context the exit gate and the file tools already cover, so
    // each submission records that count where the run audit reads it.
    const workerCost =
      stage.workspace_policy === 'source_allowed'
        ? workerInvocationSuiteCost(
            root,
            runId,
            invocation.invocation_id,
            Date.parse(
              state.current_invocation.prepared_at ?? invocation.created_at,
            ),
          )
        : null

    if (workerCost) {
      advise('suite_cost', [workerCost.message])
      persistRun(root, state, 'suite_cost_advisory', {
        scope: 'worker_invocation',
        stage: stage.slug,
        invocation_id: invocation.invocation_id,
        worker_gate_profiles: workerCost.worker_gate_profiles,
        shell_browsing_calls: workerCost.shell_browsing_calls,
        transcript_found: workerCost.transcript_found,
      })
    }

    // A self-development release lane can execute a build compiled from a
    // tree other than the one it releases, so the run records which build
    // actually answered. The disagreement is an advisory rather than a gate:
    // the redirection that closes it is read from the executing build, so a
    // gate here would refuse the first release that carries the mechanism.
    const buildCurrencyRecord =
      stage.slug === 'ship' && isSelfDevelopmentInstallation(root)
        ? buildCurrency(workspaceDirectory(root, state))
        : undefined

    if (buildCurrencyRecord && !buildCurrencyRecord.current) {
      advise('build_currency', [buildCurrencyAdvisory(buildCurrencyRecord)])
    }

    governanceArtifactWarnings.push(
      ...attestationErrors,
      ...briefErrors.map((message) => `Operator brief: ${message}`),
      ...validation.errors.map((message) => `Stage output: ${message}`),
      ...filterBriefDerivatives(harnessValidation.errors).map(
        (message) => `Validator: ${message}`,
      ),
    )
    recordGovernanceArtifactIssues(
      root,
      state,
      stage.slug,
      invocation.invocation_id,
      'validator',
      governanceArtifactWarnings,
    )

    const explicitlyDeclaredProductFailure =
      isRecord(submittedValue) &&
      (submittedValue.result === 'failure' ||
        submittedValue.result === 'blocked')
    const outcomeOutput =
      stage.slug !== 'ship' &&
      validation.errors.length > 0 &&
      !explicitlyDeclaredProductFailure
        ? { ...validation.output, result: 'success' as const }
        : validation.output
    const outcome = effectiveOutcome(
      stage,
      outcomeOutput,
      blockingValidationErrors,
      evaluated.results,
      harnessValidation.validatorOutcome,
    )
    const allValidationErrors = [
      ...validation.errors,
      ...harnessValidation.errors,
    ]

    const briefContract = invocation.output.operator_brief

    let briefSourceRecord: StageHistoryItem['operator_brief_source']

    if (
      (briefContract?.source_lifecycle === 'transient' ||
        briefContract?.source_transient === true) &&
      briefErrors.length === 0 &&
      allValidationErrors.length === 0
    ) {
      // The checksum lives in stage history rather than a separate evidence
      // file, so deleting the source is a net file-count reduction.
      const sourceAbsolute = resolveInside(root, briefContract.source_path)

      briefSourceRecord = {
        source_path: briefContract.source_path,
        source_sha256: sha256(readText(sourceAbsolute)),
        rendered_path: briefContract.rendered_path,
        status: 'rendered_and_validated',
      }
      rmSync(sourceAbsolute, { force: true })
    }

    const historyItem: StageHistoryItem = {
      stage: stage.slug,
      attempt: invocation.attempt,
      invocation_id: invocation.invocation_id,
      ...(invocation.stage.persona_executor
        ? { executor: invocation.stage.persona_executor }
        : {}),
      output_path: state.current_invocation.output_path,
      outcome,
      submitted_at: now(),
      ...(priorForRevision
        ? { revised_from: priorForRevision.invocation_id }
        : {}),
      workspace_fingerprint: evaluated.workspace.fingerprint,
      workspace_before_fingerprint: invocation.workspace_before.fingerprint,
      output_bytes: Buffer.byteLength(JSON.stringify(submittedValue)),
      validation_errors: allValidationErrors,
      governance_artifact_warnings: governanceArtifactWarnings,
      deterministic: evaluated.results,
      self_criteria: validation.output.criteria,
      ...(briefSourceRecord
        ? { operator_brief_source: briefSourceRecord }
        : {}),
      ...(buildCurrencyRecord ? { build_currency: buildCurrencyRecord } : {}),
    }

    state.stage_history.push(historyItem)

    const verifyWarningsPath =
      outcome === 'success'
        ? emitVerifyWarningsInboxItem(root, state, validation.output)
        : null

    let nextState: string | null
    const environmentBlocked = evaluated.results.some(
      (result) => result.environment_blocked,
    )

    // A successful outcome needs no environment pause: with a soft repository
    // gate the stage can pass while infrastructure evidence remains, and
    // pausing a passing stage would contradict its own record.
    if (environmentBlocked && outcome !== 'success') {
      const reason =
        `Stage '${stage.slug}' encountered only timeout or collection artifacts ` +
        'on infrastructure that already failed before implementation.'

      state.status = 'paused'
      state.pause_reason = reason
      state.pending_action = { type: 'operator_decision' }
      writeDecision(
        root,
        state,
        'QA environment needs an operator decision',
        reason,
        [
          'Repair the environment, then resume the QA stage.',
          `Or redirect the run with: ${panCommand(root)} set-stage ${state.run_id} <stage> --note "<directive>"`,
        ],
      )
      nextState = 'paused'
    } else if (outcome === 'success' && stage.gate === 'supervisor') {
      const assessmentId = `assessment-${invocation.invocation_id}`
      const layout = resolveRunLayout(root, runId)
      const assessmentPath = layout.assessment(
        `${invocation.invocation_id}.assessment.json`,
      ).relative
      const cardPath = layout.assessment(
        `${invocation.invocation_id}.assessment-request.json`,
      ).relative

      writeJsonAtomic(resolveInside(root, cardPath), {
        $operator: {
          headline: `${stage.title} needs supervisor evaluation`,
          status: 'awaiting_evaluation',
          next_action: `Write ${assessmentPath} and run pan assess.`,
        },
        schema_version: 1,
        assessment_id: assessmentId,
        invocation_id: invocation.invocation_id,
        run_id: runId,
        stage: stage.slug,
        output_path: state.current_invocation.output_path,
        criteria: stage.criteria.filter(
          (criterion) => criterion.type === 'judgment',
        ),
        deterministic_results: evaluated.results,
        required_output_path: assessmentPath,
      })

      state.pending_action = {
        type: 'supervisor_assessment',
        path: cardPath,
        output_path: assessmentPath,
      }
      state.status = 'awaiting_supervisor'
      nextState = 'awaiting supervisor evaluation'
    } else {
      if (outcome === 'success' && isSameReasonTrackedStage(stage)) {
        clearSameReasonTracker(state, stage.slug)
      }

      let sameReasonPauseTriggered = false
      let horizonFailure: HorizonFailureAction | null = null
      let horizonSignature: string[] = []

      if (
        outcome === 'failure' &&
        (runHasContract(state.operator_involvement, 'long_horizon') ||
          isSameReasonTrackedStage(stage))
      ) {
        horizonSignature = collectHardFailureSignature(
          stage,
          validation.output.criteria,
          evaluated.results,
          allValidationErrors,
        )

        if (runHasContract(state.operator_involvement, 'long_horizon')) {
          horizonFailure = classifyHorizonFailure(
            state,
            stage,
            horizonSignature,
          )
        } else {
          sameReasonPauseTriggered = recordSameReasonFailure(
            state,
            stage.slug,
            horizonSignature,
          )
        }
      }

      if (horizonFailure?.kind === 'retry') {
        applyTransition(root, state, stage, 'failure', {
          overrideTarget: stage.slug,
        })
        nextState = state.current_stage
      } else if (horizonFailure?.kind === 'route') {
        applyTransition(root, state, stage, 'failure')
        nextState = state.current_stage
      } else if (horizonFailure?.kind === 'strategy') {
        recordOperatorFeedback(
          root,
          state,
          stage,
          horizonFailure.target,
          'revise',
          state.horizon_ladder?.directive ??
            'Change strategy and do not repeat the prior approach.',
          'away',
        )
        applyTransition(root, state, stage, 'failure', {
          overrideTarget: horizonFailure.target,
        })
        nextState = state.current_stage
      } else if (horizonFailure?.kind === 'exhausted') {
        pauseForHorizonLadder(
          root,
          state,
          stage,
          horizonSignature,
          horizonFailure.reason,
        )
        nextState = 'paused'
      } else if (sameReasonPauseTriggered) {
        pauseForSameReasonFailure(root, state, stage)
        nextState = 'paused'
      } else if (stage.gate === 'operator') {
        // An operator gate owns the transition, not only the happy path. A failed
        // review that routes straight back to implementation would spend the
        // operator's decision without ever asking for it.
        const directorCheckpoint =
          stage.checkpoint &&
          runHasContract(state.operator_involvement, 'technical_director')
            ? stage.checkpoint
            : undefined

        state.pending_action = {
          type: 'operator_approval',
          stage: stage.slug,
          outcome,
          proposed_transition: stage.transitions[outcome],
          ...(directorCheckpoint ? { checkpoint: directorCheckpoint } : {}),
        }
        state.status = 'awaiting_operator'
        nextState = directorCheckpoint
          ? `awaiting operator decision at the ${directorCheckpoint} checkpoint`
          : 'awaiting operator approval'
      } else {
        applyTransition(root, state, stage, outcome)
        nextState =
          state.status === 'running' ? state.current_stage : state.status
      }
    }

    const record: TaskRecord = {
      schema_version: 1,
      run_id: runId,
      invocation_id: invocation.invocation_id,
      stage: {
        slug: stage.slug,
        title: stage.title,
        // The invocation records the persona that actually ran, which for a
        // verdict-routed stage can differ from the workflow default.
        persona: invocation.stage.persona,
      },
      outcome,
      summary: validation.output.summary,
      artifacts: validation.output.artifacts,
      risks: validation.output.risks,
      unknowns: validation.output.unknowns,
      evaluation: {
        validation_errors: validation.errors,
        governance_artifact_warnings: governanceArtifactWarnings,
        deterministic: evaluated.results,
        self: validation.output.criteria,
      },
      workspace_fingerprint: evaluated.workspace.fingerprint,
      ...(delegationObservation
        ? {
            delegation_observation: {
              source: delegationObservation.source,
              ...(delegationObservation.watch.record_present ||
              delegationObservation.watch.background_marked
                ? { watch: delegationObservation.watch }
                : {}),
              ...(delegationObservation.foreground_return.record_present
                ? { foreground_return: delegationObservation.foreground_return }
                : {}),
            },
          }
        : {}),
      next_state: nextState,
      timestamp: now(),
    }
    const recordJsonPath = artifactJsonPath(
      runId,
      invocation.invocation_id,
      root,
    )

    writeJsonAtomic(resolveInside(root, recordJsonPath), record)

    historyItem.record_path = recordJsonPath

    persistRun(root, state, 'stage_output_submitted', {
      stage: stage.slug,
      invocation_id: invocation.invocation_id,
      outcome,
      next_state: nextState,
      ...(verifyWarningsPath
        ? { verify_warnings_inbox: verifyWarningsPath }
        : {}),
    })
    deferred.completedInvocationId = invocation.invocation_id
    deferred.prefetch = pendingReleaseProfilePrefetch(
      root,
      state,
      workflow,
      stage,
      outcome,
      evaluated.workspace.fingerprint,
    )

    return { state, record, advisories }
  })

  if (deferred.completedInvocationId) {
    completeInvocationAgent(root, runId, deferred.completedInvocationId)
  }

  if (deferred.prefetch) {
    startReleaseProfilePrefetch(
      root,
      result.state,
      deferred.prefetch.profile,
      deferred.prefetch.workspace_fingerprint,
    )
  }

  return result
}

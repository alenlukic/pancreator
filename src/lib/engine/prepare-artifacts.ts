/**
 * The delegation contract and the card artifacts of a prepared invocation.
 */

import { scaffoldOperatorBrief } from '../briefs.js'
import { resolveInside, writeJsonAtomic, writeTextAtomic } from '../io.js'
import { supervisorAttestCommand } from '../governance/supervisor-card.js'
import { redlineRecordPath } from '../watch.js'
import type { WorkflowOperatorArtifactProfile } from '../operator-artifact-profiles.js'
import { panCommand } from '../project-config.js'
import { resolvePolicies } from '../policies.js'
import { cursorAgentTarget } from '../projection.js'
import {
  buildInvocationContractManifest,
  renderEvidenceWorkerBrief,
  renderInvocationDeliveryPrompt,
  renderInvocationMarkdown,
  renderSupervisorProcedureMarkdown,
} from '../render.js'
import type {
  ExternalPersonaExecutorKind,
  Invocation,
  InvocationDelegationContract,
  InvocationEvidenceWorker,
  RunState,
  StageDefinition,
  WorkflowDefinition,
} from '../types.js'
import {
  buildValidationArtifact,
  deliveryPromptPath,
  invocationValidationPath,
  validateInvocationMarkdown,
} from '../validation.js'

import { recordGovernanceArtifactIssues } from './core.js'

/** The `prepareInvocation` locals its delegation contract reads. */
interface InvocationDelegationInput {
  root: string
  runId: string
  state: RunState
  workflow: WorkflowDefinition
  stage: StageDefinition
  externalExecutor: ExternalPersonaExecutorKind | undefined
  invocationId: string
  outputPath: string
  jsonPath: string
  markdownPath: string
  delegationArtifactPath: string
  supervisorProcedurePath: string
}

/**
 * The delegation contract a stage worker's card carries, or undefined for a
 * stage the supervisor completes itself.
 */
export function buildInvocationDelegation(
  input: InvocationDelegationInput,
): InvocationDelegationContract | undefined {
  const {
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
  } = input

  // The supervisor delegates from the continuation loop, where it holds no
  // card of its own. Resolving its policies here puts the delivery contract
  // on the artifact it must already read to perform the delegation. For an
  // external executor the harness moves the bytes itself, so delivery is
  // `verbatim` by construction and no compact delivery prompt is generated.
  // Resolved here rather than in the procedure renderer, so the recorded
  // invocation carries the exact command the supervisor ran.
  const outputValidateCommand =
    `${panCommand(root)} output validate --run ${runId} ` +
    `--file ${outputPath} --invocation ${jsonPath}`
  const supervisorCardReference = state.supervisor_card
    ? {
        path: state.supervisor_card.path,
        sha256: state.supervisor_card.sha256,
        attest_command: supervisorAttestCommand(
          root,
          runId,
          state.supervisor_card.sha256,
        ),
        ...(state.supervisor_card.policy_sections
          ? { policy_sections: state.supervisor_card.policy_sections }
          : {}),
      }
    : null
  const delegation =
    stage.persona === 'orchestrator'
      ? undefined
      : externalExecutor
        ? {
            persona: stage.persona,
            executor: externalExecutor,
            delegate_command: `${panCommand(root)} delegate ${runId}`,
            canonical_markdown_path: markdownPath,
            invocation_validation_path: invocationValidationPath(
              runId,
              invocationId,
              root,
            ),
            delegation_artifact_path: delegationArtifactPath,
            supervisor_procedure_path: supervisorProcedurePath,
            submit_command: `${panCommand(root)} submit ${runId} ${outputPath}`,
            output_validate_command: outputValidateCommand,
            mode: 'verbatim' as const,
            ...(supervisorCardReference
              ? { supervisor_card: supervisorCardReference }
              : {}),
            policies: resolvePolicies(root, {
              persona: 'orchestrator',
              workflow: workflow.slug,
              stage: stage.slug,
            }).filter(
              (policy) =>
                policy.id === 'INVOCATION-001' || policy.id === 'EXECUTOR-001',
            ),
          }
        : {
            persona: stage.persona,
            cursor_agent_path: cursorAgentTarget(
              root,
              stage.persona,
              state.cursor_agent_suffix,
            ),
            canonical_markdown_path: markdownPath,
            invocation_validation_path: invocationValidationPath(
              runId,
              invocationId,
              root,
            ),
            delegation_artifact_path: delegationArtifactPath,
            supervisor_procedure_path: supervisorProcedurePath,
            submit_command: `${panCommand(root)} submit ${runId} ${outputPath}`,
            output_validate_command: outputValidateCommand,
            watch_command: `${panCommand(root)} watch ${runId} --invocation ${invocationId}`,
            redline_record_path: redlineRecordPath(root, runId),
            mode: 'referenced' as const,
            ...(supervisorCardReference
              ? { supervisor_card: supervisorCardReference }
              : {}),
            delivery_prompt_path: deliveryPromptPath(runId, invocationId, root),
            // DELEGATE-001 governs the launch and the watch that follows
            // it, so it travels on the document that carries those steps.
            // The card alone put it 300 lines away from the moment the
            // platform says not to wait.
            policies: resolvePolicies(root, {
              persona: 'orchestrator',
              workflow: workflow.slug,
              stage: stage.slug,
            }).filter(
              (policy) =>
                policy.id === 'INVOCATION-001' || policy.id === 'DELEGATE-001',
            ),
          }

  return delegation
}

/** The `prepareInvocation` locals its card artifacts read. */
interface InvocationArtifactsInput {
  root: string
  runId: string
  state: RunState
  stage: StageDefinition
  invocation: Invocation
  invocationId: string
  delegation: InvocationDelegationContract | undefined
  evidenceWorkers: InvocationEvidenceWorker[] | undefined
  artifactsRequested: boolean
  artifactProfile: WorkflowOperatorArtifactProfile
  briefSourcePath: string
  supervisorProcedurePath: string
  markdownPath: string
  jsonPath: string
}

/**
 * Write a prepared invocation's operator-brief scaffold, evidence-worker
 * briefs, supervisor procedure, delivery prompt, validation record, and
 * card.
 */
export function writeInvocationArtifacts(
  input: InvocationArtifactsInput,
): void {
  const {
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
  } = input

  if (artifactsRequested) {
    scaffoldOperatorBrief(root, {
      source_path: briefSourcePath,
      profile: artifactProfile,
      title: `${stage.title} brief`,
      source: `${runId}/${invocationId}`,
    })
  }

  for (const worker of evidenceWorkers ?? []) {
    writeTextAtomic(
      resolveInside(root, worker.brief_path),
      renderEvidenceWorkerBrief(invocation, worker),
    )
  }

  const renderedMarkdown = renderInvocationMarkdown(invocation)
  // The supervisor procedure lives beside the card so the worker-visible
  // contract never carries a lifecycle command. It must exist before
  // invocation validation, which verifies both documents together.
  const supervisorProcedureMarkdown = delegation
    ? renderSupervisorProcedureMarkdown(invocation)
    : null

  if (supervisorProcedureMarkdown !== null) {
    writeTextAtomic(
      resolveInside(root, supervisorProcedurePath),
      supervisorProcedureMarkdown,
    )
  }

  // The manifest describes the rendered bytes, so it can only be attached
  // after rendering. The card therefore never contains its own digest, and the
  // compact delivery prompt is where the digest and section index live.
  // External-executor delegations skip both: the harness pipes the card bytes
  // to the executor itself, so referenced delivery — and the read attestation
  // that polices it — has nothing to defend against.
  if (delegation?.mode === 'referenced' && delegation.delivery_prompt_path) {
    invocation.contract_manifest = buildInvocationContractManifest(
      markdownPath,
      renderedMarkdown,
      invocation.policies,
    )
    writeTextAtomic(
      resolveInside(root, delegation.delivery_prompt_path),
      renderInvocationDeliveryPrompt(invocation, invocation.contract_manifest),
    )
  }

  const invocationValidation = validateInvocationMarkdown(
    invocation,
    renderedMarkdown,
    supervisorProcedureMarkdown ?? undefined,
  )
  const invocationValidationArtifactPath = invocationValidationPath(
    runId,
    invocationId,
    root,
  )
  const invocationValidationArtifact = buildValidationArtifact({
    run_id: runId,
    invocation_id: invocationId,
    kind: 'invocation',
    status: invocationValidation.passed ? 'pass' : 'fail',
    checks: invocationValidation.checks,
    artifact_path: markdownPath,
  })

  writeJsonAtomic(
    resolveInside(root, invocationValidationArtifactPath),
    invocationValidationArtifact,
  )

  if (!invocationValidation.passed) {
    recordGovernanceArtifactIssues(
      root,
      state,
      stage.slug,
      invocationId,
      'invocation',
      [`Invocation validation failed: ${invocationValidationArtifact.summary}`],
      invocationValidationArtifactPath,
    )
  }

  writeJsonAtomic(resolveInside(root, jsonPath), invocation)
  writeTextAtomic(resolveInside(root, markdownPath), renderedMarkdown)
}

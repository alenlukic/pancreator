/**
 * The result and option types of invocation preparation, and the steps it
 * takes before it builds a card: the verification and baseline-gap pauses, the
 * attempt's stage, the returning verify-profile refresh, the scheduled evidence
 * workers, the field contract, and the labeled delegation artifact.
 */

import path from 'node:path'

import { agentRecordedProfilePasses } from '../agent-ledger-evidence.js'
import {
  liveCriteriaDecision,
  runAcceptanceProofs,
  runDeclaredChangePaths,
} from '../acceptance-proof.js'
import { remediationReturn } from '../context.js'
import { invariant } from '../errors.js'
import {
  isRecord,
  readJson,
  readText,
  resolveInside,
  writeTextAtomic,
} from '../io.js'
import { resolveRunLayout } from '../run-layout.js'
import { panCommand } from '../project-config.js'
import { loadVerificationFile } from '../verification.js'
import {
  recordAgentRepositoryCheckForRuns,
  recordProfileGatePass,
  repositoryCheckProfileName,
  runRepositoryCheck,
} from '../repository-checks.js'
import { now, writeDecision } from '../state.js'
import type {
  EvidenceWorkerSkip,
  Invocation,
  RunModelEvidence,
  RunState,
  StageDefinition,
  StageEvidenceWorkerDefinition,
  WorkflowDefinition,
  WorkspaceSnapshot,
} from '../types.js'
import { gitWorkspaceSnapshot } from '../git.js'

import {
  type OperationProgressOptions,
  persistRun,
  recordRunAdvisories,
  workspaceDirectory,
  workspaceSnapshotForRun,
} from './core.js'
import { collectStageRepositoryCheckProfiles } from './profiles.js'
import { applyTransition } from './transition.js'

export interface PrepareInvocationResult {
  state: RunState
  invocation: Invocation | null
  /** Non-blocking observations about the run. None of them stops the run. */
  advisories: string[]
  /** What `--agent` had the harness write and start, when it was passed. */
  prepared_delegation?: PreparedDelegation
  /** Evidence-role launch selected and allocated by `--agent`. */
  prepared_evidence?: PreparedEvidenceDelegation
}

/** Delivery artifacts `pan prepare --agent <name>` owns for one invocation. */
export interface PreparedDelegation {
  /** The labeled delegation artifact, or null when none was written. */
  artifact_path: string | null
  /** Why no artifact was written, when none was. */
  skipped: string | null
  /** In-flight worker model evidence, or null when no probe started. */
  model_evidence: RunModelEvidence | null
  probe_pid: number | null
}

export interface PreparedEvidenceDelegation {
  role: string
  agent: string
  prompt_path: string
  evidence_path: string
  attempt: number
}

export interface PrepareInvocationOptions extends OperationProgressOptions {
  operatorArtifacts?: boolean
  /**
   * Named agent this invocation is delegated to. The harness then writes the
   * labeled delegation artifact and starts the worker model probe, which the
   * supervisor otherwise assembles and runs by hand.
   */
  agent?: string
  /** CLI prepare owns a complete delegation packet even without --agent. */
  prepareDelegation?: boolean
}

/**
 * The harness root baseline an invocation carries when the run works
 * somewhere else. A worktree run and an eval run both leave the harness
 * checkout outside every workspace snapshot, so without this baseline no gate
 * can see a write into the one tree the run must not touch.
 */
export function harnessBaseline(
  root: string,
  state: RunState,
): { harness_before?: WorkspaceSnapshot } {
  return path.resolve(workspaceDirectory(root, state)) === path.resolve(root)
    ? {}
    : { harness_before: gitWorkspaceSnapshot(root) }
}

interface VerificationRecommendation {
  stage: string
  invocation_id: string
  level: string
  reason: string
}

/**
 * The newest un-surfaced verification-level recommendation from a successful
 * intake or plan attempt. Workers MAY recommend a different level when the
 * change warrants it; the operator decides, once per recommendation.
 */
export function pendingVerificationRecommendation(
  root: string,
  state: RunState,
): VerificationRecommendation | null {
  const verification = state.verification

  if (!verification) {
    return null
  }

  const surfaced = new Set(state.verification_recommendations_surfaced ?? [])

  for (const item of [...state.stage_history].reverse()) {
    if (
      (item.stage !== 'intake' && item.stage !== 'plan') ||
      item.outcome !== 'success' ||
      surfaced.has(item.invocation_id)
    ) {
      continue
    }

    let value: unknown

    try {
      value = readJson(resolveInside(root, item.output_path))
    } catch {
      continue
    }

    if (!isRecord(value) || !isRecord(value.data)) {
      continue
    }

    const recommendation = value.data.verification_recommendation

    if (
      !isRecord(recommendation) ||
      typeof recommendation.level !== 'string' ||
      typeof recommendation.reason !== 'string' ||
      recommendation.level === verification.level
    ) {
      continue
    }

    let knownLevels: string[]

    try {
      knownLevels = Object.keys(loadVerificationFile(root).levels)
    } catch {
      return null
    }

    if (!knownLevels.includes(recommendation.level)) {
      continue
    }

    return {
      stage: item.stage,
      invocation_id: item.invocation_id,
      level: recommendation.level,
      reason: recommendation.reason,
    }
  }

  return null
}

export function pauseForVerificationRecommendation(
  root: string,
  state: RunState,
  recommendation: VerificationRecommendation,
): void {
  const reason =
    `The ${recommendation.stage} worker recommends verification level ` +
    `'${recommendation.level}' instead of this run's ` +
    `'${state.verification?.level}': ${recommendation.reason}`

  state.status = 'paused'
  state.pause_reason = reason
  state.pending_action = { type: 'operator_decision' }
  ;(state.verification_recommendations_surfaced ??= []).push(
    recommendation.invocation_id,
  )

  writeDecision(root, state, 'Verification level recommendation', reason, [
    `Apply it with: ${panCommand(root)} verification ${state.run_id} set ${recommendation.level}`,
    `Or keep '${state.verification?.level}' and continue: ${panCommand(root)} resume ${state.run_id}`,
  ])
}

export function pauseForRepositoryCheckBaselineGaps(
  root: string,
  state: RunState,
  stage: StageDefinition,
  gaps: string[],
): void {
  const reason =
    `Stage '${stage.slug}' cannot be delegated because a repository-check ` +
    `baseline does not support its gate. ${gaps.join(' ')}`

  state.status = 'paused'
  state.pause_reason = reason
  state.pending_action = { type: 'operator_decision' }

  writeDecision(
    root,
    state,
    'Workflow paused by a repository-check baseline gap',
    reason,
    [
      'Inspect the named baseline evidence under ' +
        `${resolveRunLayout(root, state.run_id).evidence('.').relative}`,
      `Recapture the baselines by resuming this run from the first source stage: ${panCommand(root)} resume ${state.run_id} --stage <stage>`,
      `Or abort with: ${panCommand(root)} abort ${state.run_id}`,
    ],
  )
}

export function stageFieldContract(
  root: string,
  workflowSlug: string,
  stageSlug: string,
  requirements: NonNullable<
    Invocation['requirements']
  >['validation_requirements'],
  artifactsRequested: boolean,
): Invocation['output']['field_contract'] {
  const source = readJson(
    path.join(root, 'library', 'schemas', 'stage-output-requirements.json'),
  )

  invariant(
    isRecord(source) &&
      source.schema_version === 1 &&
      isRecord(source.criterion_results) &&
      Object.values(source.criterion_results).every(
        (value) => typeof value === 'string',
      ) &&
      isRecord(source.stages),
    'stage-output-requirements.json MUST contain a schema_version 1 stage map.',
    { code: 'INVALID_STAGE_OUTPUT_REQUIREMENTS' },
  )

  // The design and prototype workflows both run a stage called `intake`, and
  // a different validator owns each one. A workflow-qualified key selects the
  // owning entry; every slug only one workflow uses stays unqualified.
  const contractKey =
    source.stages[`${workflowSlug}:${stageSlug}`] === undefined
      ? stageSlug
      : `${workflowSlug}:${stageSlug}`
  const stage = source.stages[contractKey]

  if (stage === undefined) {
    return undefined
  }

  invariant(
    isRecord(stage) &&
      Array.isArray(stage.validators) &&
      Array.isArray(stage.fields),
    `stage-output-requirements.json stages.${contractKey} MUST declare validators and fields.`,
    { code: 'INVALID_STAGE_OUTPUT_REQUIREMENTS' },
  )

  const requirementByRegistryId = new Map(
    requirements.map((requirement) => [requirement.registry_id, requirement]),
  )
  const validators = stage.validators.flatMap((validator) => {
    invariant(
      isRecord(validator) &&
        typeof validator.registry_id === 'string' &&
        (validator.enforcement === 'blocks' ||
          validator.enforcement === 'advises'),
      `stage-output-requirements.json stages.${contractKey} contains an invalid validator.`,
      { code: 'INVALID_STAGE_OUTPUT_REQUIREMENTS' },
    )

    if (
      validator.registry_id === 'PR-DESCRIPTION-VALIDATE-001' &&
      !artifactsRequested
    ) {
      return []
    }

    const requirement = requirementByRegistryId.get(validator.registry_id)

    invariant(
      requirement,
      `Stage ${stageSlug} does not resolve ${validator.registry_id}.`,
      { code: 'INVALID_STAGE_OUTPUT_REQUIREMENTS' },
    )

    const enforcement =
      requirement.enforcement === 'advisory'
        ? ('advises' as const)
        : ('blocks' as const)

    invariant(
      validator.enforcement === enforcement,
      `Stage ${stageSlug} declares ${validator.registry_id} as ` +
        `${validator.enforcement}, but resolved registry metadata says ${enforcement}.`,
      { code: 'INVALID_STAGE_OUTPUT_REQUIREMENTS' },
    )

    return [{ registry_id: validator.registry_id, enforcement }]
  })

  return {
    criterion_results: source.criterion_results as Record<string, string>,
    validators,
    fields: stage.fields as NonNullable<
      Invocation['output']['field_contract']
    >['fields'],
  }
}

/** Longest agent label the delegation contract accepts ahead of the body. */
const DELEGATION_AGENT_NAME_MAX_LENGTH = 60

/**
 * Refuse an agent name the delegation contract would reject as a label.
 *
 * The artifact is compared against the delivered body after one permitted
 * leading label line, so a multi-line or Markdown-structured name would turn
 * a convenience into a submission failure the supervisor debugs later.
 */
export function assertDelegationAgentName(agent: string): void {
  invariant(
    agent.trim().length > 0 &&
      agent.length <= DELEGATION_AGENT_NAME_MAX_LENGTH &&
      !/[\n\r]/u.test(agent) &&
      !/^\s*(?:[#>*\-+]|\d+[.)]|```|\|)/u.test(agent),
    `--agent MUST be one short plain-text agent name of at most ` +
      `${DELEGATION_AGENT_NAME_MAX_LENGTH} characters that starts no ` +
      `Markdown structure; got '${agent}'.`,
    { code: 'INVALID_ARGUMENT' },
  )
}

/**
 * Write the delegation evidence the supervisor would otherwise assemble by
 * hand: the delivered prompt body under one `Agent:` label.
 *
 * Only referenced delivery is written here. An external-executor stage has
 * the harness author the artifact at `pan delegate`, and an orchestrator
 * stage delegates to nobody, so both keep today's behavior.
 */
export function writeLabeledDelegationArtifact(
  root: string,
  invocation: Invocation,
  agent: string | null,
): { artifact_path: string | null; skipped: string | null } {
  const delegation = invocation.delegation

  if (!delegation) {
    return {
      artifact_path: null,
      skipped: `Stage '${invocation.stage.slug}' delegates to no worker.`,
    }
  }

  if (delegation.mode !== 'referenced' || !delegation.delivery_prompt_path) {
    return {
      artifact_path: null,
      skipped:
        `Stage '${invocation.stage.slug}' delivers its card through the ` +
        `'${delegation.executor ?? 'external'}' executor, which authors its ` +
        'own delegation evidence at `pan delegate`.',
    }
  }

  // A referenced delegation always names its projected agent, and a label a
  // supervisor cannot launch (a persona slug, an empty string) is worse than
  // no artifact, so a missing name fails here rather than being guessed.
  invariant(
    agent !== null && agent.trim().length > 0,
    `Stage '${invocation.stage.slug}' delegation names no projected agent ` +
      'to label its delegation artifact with.',
    { code: 'DELEGATION_AGENT_UNRESOLVED' },
  )

  const body = readText(resolveInside(root, delegation.delivery_prompt_path))

  writeTextAtomic(
    resolveInside(root, delegation.delegation_artifact_path),
    `Agent: ${agent.trim()}\n\n${body}`,
  )

  return {
    artifact_path: delegation.delegation_artifact_path,
    skipped: null,
  }
}

/**
 * The stage definition for the current attempt, with verdict-conditional
 * persona routing applied. A stage with `persona_by_verdict` reads the latest
 * output of its source stage and swaps in the mapped persona when the recorded
 * verdict matches. An absent source output, an unreadable file, or an unmapped
 * verdict keeps the default persona, so verdict routing degrades to the
 * stage's own declaration instead of failing the run.
 */
export function resolveStageForAttempt(
  root: string,
  state: RunState,
  stage: StageDefinition,
): StageDefinition {
  const byVerdict = stage.persona_by_verdict

  if (!byVerdict) {
    return stage
  }

  const item = [...state.stage_history]
    .reverse()
    .find((entry) => entry.stage === byVerdict.source_stage)

  if (!item) {
    return stage
  }

  let verdict: unknown

  try {
    const output = readJson(resolveInside(root, item.output_path))

    verdict =
      isRecord(output) && isRecord(output.data)
        ? byVerdict.path
            .split('.')
            .reduce<unknown>(
              (value, key) => (isRecord(value) ? value[key] : undefined),
              output.data,
            )
        : undefined
  } catch {
    return stage
  }

  const persona =
    typeof verdict === 'string' ? byVerdict.map[verdict] : undefined

  return persona ? { ...stage, persona } : stage
}

/** Refresh stale interior checks before a post-remediation verification. */
/**
 * Refresh every interior profile whose evidence the intervening remediation
 * superseded, before a returning verify stage delegates (`VERIFY-001`).
 *
 * A profile that fails here says the repair is incomplete, which is an
 * ordinary workflow outcome rather than a programmer error. Throwing left
 * `pan prepare` with no route and no durable record, so the failure returns
 * the run along the stage's own failure transition instead, with the
 * execution recorded in the run's repository-check ledger.
 */
export function refreshReturningVerifyProfiles(
  root: string,
  state: RunState,
  workflow: WorkflowDefinition,
  stage: StageDefinition,
  invocationId: string,
  onProgress?: (message: string) => void,
): 'pass' | 'routed' | 'paused' {
  // The card's return marker and this refresh MUST answer "is this a return
  // visit" the same way. They used different predicates, so a history of
  // verify(failure), remediate(success), verify(blocked) rendered a brief
  // that forbade profile execution while the harness refreshed nothing.
  const returnVisit = remediationReturn(root, state, stage)

  if (!returnVisit) {
    return 'pass'
  }

  const remediation = state.stage_history.find(
    (item) => item.invocation_id === returnVisit.remediation_invocation_id,
  )

  if (!remediation) {
    return 'pass'
  }

  const workspace = workspaceSnapshotForRun(root, state)
  const currentProfiles = new Set<string>()

  // Evidence produced before remediation is stale by ordering even when the
  // fixture or a no-op repair leaves the Git fingerprint unchanged. Only the
  // remediation submission itself can make a profile current for this return.
  for (const result of remediation.deterministic) {
    const profile = result.command
      ? repositoryCheckProfileName(result.command)
      : null

    if (
      profile &&
      result.passed &&
      result.workspace_fingerprint === workspace.fingerprint
    ) {
      currentProfiles.add(profile)
    }
  }

  // A refresh this function already performed is current evidence too. The
  // return predicate now spans a blocked retry, so without this the same
  // profiles would execute again at every prepare of the same workspace.
  for (const pass of agentRecordedProfilePasses(root, state.run_id)) {
    if (pass.fingerprint === workspace.fingerprint) {
      currentProfiles.add(pass.profile)
    }
  }

  for (const profile of collectStageRepositoryCheckProfiles(
    workflow.stages,
    state,
  )) {
    if (currentProfiles.has(profile.name)) {
      continue
    }

    onProgress?.(
      `refreshing post-remediation '${profile.name}' evidence before verify`,
    )
    const startedAt = now()
    const result = runRepositoryCheck(root, profile.name, {
      timeout_ms: profile.timeout_ms,
      workspace: state.workspace_root || '.',
    })

    // A profile the repository does not declare has nothing to refresh. Its
    // stage gate skips it the same way, so it never blocks a return visit.
    if (result.status === 'not_configured') {
      continue
    }

    if (result.status !== 'passed') {
      recordAgentRepositoryCheckForRuns(
        root,
        [state.run_id],
        result,
        startedAt,
        'harness',
        null,
        false,
        null,
        invocationId,
      )

      return routeFailedVerifyProfileRefresh(
        root,
        state,
        stage,
        profile.name,
        result,
        onProgress,
      )
    }

    const pass = recordProfileGatePass(root, profile.name, result, {
      run_ids: [state.run_id],
      fingerprint_before: workspace.fingerprint,
      started_at: startedAt,
      initiator: 'harness',
    })

    if (!pass) {
      // The profile passed but the workspace moved under it, so the pass
      // proves nothing about the tree verify is about to read. That is the
      // same unusable outcome as a failure and takes the same durable route.
      recordAgentRepositoryCheckForRuns(
        root,
        [state.run_id],
        result,
        startedAt,
        'harness',
        null,
        false,
        null,
        invocationId,
      )

      return routeFailedVerifyProfileRefresh(
        root,
        state,
        stage,
        profile.name,
        result,
        onProgress,
        'the workspace moved while the refresh ran, so its pass could not be recorded',
      )
    }

    recordAgentRepositoryCheckForRuns(
      root,
      [state.run_id],
      result,
      startedAt,
      'harness',
      pass.evidence_path,
      false,
      null,
      invocationId,
    )
  }

  return 'pass'
}

/**
 * Send a run whose post-remediation profile refresh failed back along the
 * verify stage's own failure transition, the same route a failing verdict
 * takes. A workflow limit that intercepts the route pauses the run for the
 * operator, exactly as it does for a failed entry gate.
 */
function routeFailedVerifyProfileRefresh(
  root: string,
  state: RunState,
  stage: StageDefinition,
  profileName: string,
  result: ReturnType<typeof runRepositoryCheck>,
  onProgress?: (message: string) => void,
  cause = `the profile ended with status '${result.status}'`,
): 'routed' | 'paused' {
  const target = stage.transitions.failure
  const reason =
    `Post-remediation '${profileName}' refresh did not produce usable ` +
    `evidence before verify: ${cause}. The repaired workspace does not ` +
    'satisfy a profile this stage reads, so the run returns for repair ' +
    'rather than verifying against superseded evidence.'

  onProgress?.(reason)
  recordRunAdvisories(
    state,
    { kind: 'verify_profile_refresh', source: 'prepare', stage: stage.slug },
    [reason],
  )

  if (!target) {
    state.status = 'paused'
    state.pause_reason = reason
    state.pending_action = { type: 'operator_decision', operator_only: true }
    writeDecision(root, state, 'Post-remediation refresh failed', reason, [
      `Send the run back for repair with: ${panCommand(root)} resume ${state.run_id} --stage <stage>`,
      `Or abort with: ${panCommand(root)} abort ${state.run_id}`,
    ])
    persistRun(root, state, 'run_paused', { reason, stage: stage.slug })

    return 'paused'
  }

  applyTransition(root, state, stage, 'failure')

  if (state.status !== 'running') {
    persistRun(root, state, 'run_paused', { reason: state.pause_reason })

    return 'paused'
  }

  persistRun(root, state, 'verify_profile_refresh_failed', {
    stage: stage.slug,
    profile: profileName,
    routed_to: target,
  })

  return 'routed'
}

/**
 * The declared evidence workers this visit launches, and the ones a
 * `run_when` condition keeps off it with the reason.
 *
 * `live_criteria` reads the run's criterion proofs: its own plan output, the
 * child specifications of a release run, or the request specification. QA
 * runs for a `live` criterion and whenever no proof can be read, so a legacy
 * or unplanned request keeps the full topology. It also runs when the plan's
 * files or an implementation's changed files touch a user-facing surface.
 */
export function scheduleEvidenceWorkers(
  root: string,
  state: RunState,
  stage: StageDefinition,
): {
  workers: StageEvidenceWorkerDefinition[] | undefined
  skips: EvidenceWorkerSkip[]
} {
  if (!stage.evidence_workers) {
    return { workers: undefined, skips: [] }
  }

  const conditional = stage.evidence_workers.some(
    (worker) => worker.run_when === 'live_criteria',
  )
  const record = state as unknown as Record<string, unknown>
  const decision = conditional
    ? liveCriteriaDecision(
        runAcceptanceProofs(root, record),
        runDeclaredChangePaths(root, record),
      )
    : null
  const skips: EvidenceWorkerSkip[] = []
  const workers = stage.evidence_workers.filter((worker) => {
    if (worker.run_when !== 'live_criteria' || decision?.run !== false) {
      return true
    }

    skips.push({
      persona: worker.persona,
      role: worker.role,
      run_when: worker.run_when,
      reason: decision.reason,
    })

    return false
  })

  return { workers, skips }
}

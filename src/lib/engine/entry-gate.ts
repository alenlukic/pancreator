/**
 * Stage entry gates: the recorded pass a gate reuses, the lane-coverage and
 * verified-source checks, and the repair route a failing gate takes.
 */

import { agentRecordedProfilePasses } from '../agent-ledger-evidence.js'
import { invariant } from '../errors.js'
import { panCommand } from '../project-config.js'
import { effectiveRepositoryCheckProfile } from '../verification.js'
import {
  loadRepositoryChecks,
  repositoryCheckProfileName,
} from '../repository-checks.js'
import { runDir, writeDecision } from '../state.js'
import type {
  DeterministicResult,
  RunState,
  StageDefinition,
  StageEntryGateRecord,
  WorkflowDefinition,
} from '../types.js'
import {
  FINGERPRINT_BOUND_STATE_CRITERIA,
  runEntryGateCriterion,
} from '../validation.js'
import { gitSourceContentFingerprint } from '../git.js'
import { RELEASE_LANDING_METADATA_PATHS } from '../versioning.js'
import { entryGateWaiver } from '../waivers.js'

import {
  loadRunWorkflow,
  persistRun,
  workspaceDirectory,
  workspaceSnapshotForRun,
} from './core.js'
import { FULL_PROFILE } from './profiles.js'
import { applyTransition } from './transition.js'

/**
 * A gate result that lets the stage proceed: a pass, or a gate the run
 * configuration, verification level, or an unconfigured profile disabled. The
 * same reading `effectiveOutcome` applies to a submitted gate.
 */
export function entryGateSatisfied(result: DeterministicResult): boolean {
  return result.passed || result.disabled === true
}

/**
 * The recorded entry-gate pass that still covers the current visit of a stage,
 * or null. A pass covers the visit while no other stage has submitted since it
 * was recorded: the ship worker's own attempts and operator pauses do not
 * close the visit, leaving the stage does.
 */
export function currentEntryGatePass(
  state: RunState,
  stage: StageDefinition,
): DeterministicResult | null {
  const record = state.entry_gates?.[stage.slug]

  if (
    !record ||
    !entryGateSatisfied(record.last_result) ||
    record.passed_at_history_length === undefined ||
    record.passed_at_history_length > state.stage_history.length
  ) {
    return null
  }

  const sinceThen = state.stage_history.slice(record.passed_at_history_length)

  return sinceThen.every((item) => item.stage === stage.slug)
    ? record.last_result
    : null
}

/**
 * Forget open entry-gate routes, visit passes, and loop counts. An operator
 * who redirects or resumes the run decides its next step explicitly, so a
 * route or pass recorded for the prior path must not reroute a later success
 * or stand in for a gate the run has not run on its new path, and the repair
 * loops start over from the operator's decision.
 */
export function clearEntryGateRoutes(state: RunState): void {
  for (const record of Object.values(state.entry_gates ?? {})) {
    delete record.routed_to
    delete record.repair_stage
    delete record.passed_at_history_length
    record.failures = 0
  }
}

/** How a failed entry gate's declared repair route must be taken. */
type EntryGateRepairRoute =
  | { kind: 'direct_return' }
  | { kind: 'through_success_path' }
  | { kind: 'unsatisfiable'; blocking: string[] }

/** Longest success chain the route check walks before giving up. */
const ROUTE_REACHABILITY_LIMIT = 16

/**
 * Decide how an entry-gate repair returns to the stage that ordered it.
 *
 * A repair that cannot change the workspace leaves every criterion of the
 * gate stage as it found them, so the run returns directly. A repair that can
 * change the workspace invalidates any fingerprint-bound criterion the gate
 * stage declares, and the direct return would then fail the very criterion
 * the repair was ordered to get past. That route runs through the repair
 * stage's own success path, which retakes the evidence. When that path cannot
 * reach the gate stage at all, the route is reported instead of taken.
 */
function entryGateRepairRoute(
  workflow: WorkflowDefinition,
  gateStage: StageDefinition,
  repairSlug: string,
): EntryGateRepairRoute {
  const repairStage = workflow.stages.find((item) => item.slug === repairSlug)

  if (!repairStage || repairStage.workspace_policy !== 'source_allowed') {
    return { kind: 'direct_return' }
  }

  const blocking = gateStage.criteria
    .filter(
      (criterion) =>
        criterion.hard === true &&
        FINGERPRINT_BOUND_STATE_CRITERIA.has(criterion.id),
    )
    .map((criterion) => criterion.id)

  if (blocking.length === 0) {
    return { kind: 'direct_return' }
  }

  return successPathReaches(workflow, repairStage, gateStage.slug)
    ? { kind: 'through_success_path' }
    : { kind: 'unsatisfiable', blocking }
}

function successPathReaches(
  workflow: WorkflowDefinition,
  from: StageDefinition,
  targetSlug: string,
): boolean {
  let current: StageDefinition | undefined = from

  for (let step = 0; step < ROUTE_REACHABILITY_LIMIT; step += 1) {
    const next: string | undefined = current?.transitions.success

    if (next === undefined) {
      return false
    }

    if (next === targetSlug) {
      return true
    }

    current = workflow.stages.find((item) => item.slug === next)

    if (!current) {
      return false
    }
  }

  return false
}

function boundedCriterionList(criterionIds: string[]): string {
  return criterionIds.map((id) => `'${id}'`).join(', ')
}

/**
 * Run the stage's entry gate, when it declares one, before the worker is
 * delegated.
 *
 * Returns `'pass'` when the stage may proceed (the gate passed now, passed
 * earlier on this visit, or is disabled), `'routed'` when the failure moved
 * the run to the declared repair stage, and `'paused'` when the failure count
 * exceeded `max_loops` and the run now waits for an operator decision that
 * away mode cannot take.
 */
/**
 * Profiles whose commands prove a test lane on their own. A lane named here is
 * covered when one of its profiles passed at the gate's workspace. The
 * integration lane has no entry: the only profile short of `full` that runs
 * it selects by import closure, so a failure there is always a gap.
 */
const LANE_COVERING_PROFILES: Readonly<Record<string, readonly string[]>> = {
  unit: ['fast'],
  regression: ['fast'],
  secondary: ['secondary'],
}

/**
 * Repository-check profiles, other than the `full` release profile, that some
 * gate of this run passed at `fingerprint`: stage gates the run recorded and
 * profile passes recorded against the run.
 */
function profilesPassedAtFingerprint(
  root: string,
  state: RunState,
  fingerprint: string,
): string[] {
  const profiles = new Set<string>()

  for (const item of state.stage_history) {
    for (const result of item.deterministic ?? []) {
      const profile = result.command
        ? repositoryCheckProfileName(result.command)
        : null

      if (
        profile &&
        profile !== FULL_PROFILE &&
        result.passed &&
        !result.disabled &&
        !result.skipped &&
        result.workspace_fingerprint === fingerprint
      ) {
        profiles.add(profile)
      }
    }
  }

  for (const pass of agentRecordedProfilePasses(root, state.run_id)) {
    if (pass.fingerprint === fingerprint && pass.profile !== FULL_PROFILE) {
      profiles.add(pass.profile)
    }
  }

  return [...profiles].sort()
}

/**
 * The lanes of a failed entry gate that no earlier gate of the run proved at
 * the same workspace. A lane is covered by a profile listed for it in
 * `LANE_COVERING_PROFILES`, or, for a lane spelled as a command, by a passed
 * profile that declares that exact command.
 */
function entryGateLaneGap(
  root: string,
  state: RunState,
  result: DeterministicResult,
): StageEntryGateRecord['lane_gap'] {
  const lanes = result.failed_lanes ?? []

  if (lanes.length === 0) {
    return undefined
  }

  const verified = profilesPassedAtFingerprint(
    root,
    state,
    result.workspace_fingerprint,
  )
  let declared: Record<string, { commands: string[] }> = {}

  try {
    declared = loadRepositoryChecks(root).profiles
  } catch {
    // An unreadable profile file leaves only the lane table to decide.
  }

  const normalize = (command: string): string =>
    command.trim().replaceAll(/\s+/gu, ' ')
  const uncovered = lanes.filter(
    (lane) =>
      !(LANE_COVERING_PROFILES[lane] ?? []).some((profile) =>
        verified.includes(profile),
      ) &&
      !verified.some((profile) =>
        (declared[profile]?.commands ?? []).some(
          (command) => normalize(command) === lane,
        ),
      ),
  )

  return uncovered.length > 0
    ? { lanes: uncovered, verified_profiles: verified }
    : undefined
}

/**
 * The source content an executed, passing entry gate verified, or undefined
 * when the gate proved nothing about the tree: waived, disabled by the
 * verification level, skipped, or not a repository-check profile.
 */
function entryGateVerifiedSource(
  root: string,
  state: RunState,
  criterion: StageDefinition['criteria'][number],
  result: DeterministicResult,
): StageEntryGateRecord['verified_source'] {
  if (
    !result.passed ||
    result.waived ||
    result.disabled ||
    result.skipped ||
    result.overridden
  ) {
    return undefined
  }

  const { profile } = effectiveRepositoryCheckProfile(
    state.verification,
    criterion,
  )

  if (!profile) {
    return undefined
  }

  const fingerprint = gitSourceContentFingerprint(
    workspaceDirectory(root, state),
    RELEASE_LANDING_METADATA_PATHS,
  )

  return fingerprint ? { fingerprint, profile } : undefined
}

export function runStageEntryGate(
  root: string,
  state: RunState,
  stage: StageDefinition,
  onProgress?: (message: string) => void,
): 'pass' | 'routed' | 'paused' {
  const gate = stage.entry_gate

  if (!gate) {
    return 'pass'
  }

  if (currentEntryGatePass(state, stage)) {
    return 'pass'
  }

  const criterion = stage.criteria.find((item) => item.id === gate.criterion)

  invariant(
    criterion !== undefined,
    `Stage '${stage.slug}' entry gate names unknown criterion '${gate.criterion}'.`,
    { code: 'INVALID_WORKFLOW' },
  )

  const records = (state.entry_gates ??= {})
  const previous = records[stage.slug]
  const waiver = entryGateWaiver(state, stage.slug, criterion.id)

  if (waiver) {
    const waived: DeterministicResult = {
      id: criterion.id,
      type: 'shell',
      hard: Boolean(criterion.hard),
      passed: true,
      waived: true,
      waiver_id: waiver.waiver_id,
      explanation:
        `Entry gate waived by operator directive '${waiver.waiver_id}'; ` +
        `the criterion did not run. Directive: ${waiver.artifact_path}.`,
      ...(criterion.command ? { command: criterion.command } : {}),
      workspace_fingerprint: workspaceSnapshotForRun(root, state).fingerprint,
    }

    records[stage.slug] = {
      criterion_id: criterion.id,
      executions: previous?.executions ?? 0,
      failures: 0,
      last_result: waived,
      passed_at_history_length: state.stage_history.length,
    }
    onProgress?.(
      `entry gate ${criterion.id} for stage '${stage.slug}' is waived by ${waiver.waiver_id}`,
    )
    persistRun(root, state, 'entry_gate_waived', {
      stage: stage.slug,
      criterion: criterion.id,
      waiver_id: waiver.waiver_id,
      artifact_path: waiver.artifact_path,
    })

    return 'pass'
  }

  const executions = (previous?.executions ?? 0) + 1
  const artifactId = `${stage.slug}-entry-${executions}`

  onProgress?.(
    `running entry gate ${criterion.id} for stage '${stage.slug}' before delegation (timeout ${criterion.timeout_ms ?? 'default'}ms)`,
  )

  const result = runEntryGateCriterion(
    root,
    runDir(root, state.run_id),
    state,
    stage,
    criterion,
    workspaceDirectory(root, state),
    artifactId,
    onProgress,
  )

  if (entryGateSatisfied(result)) {
    const verifiedSource = entryGateVerifiedSource(
      root,
      state,
      criterion,
      result,
    )

    records[stage.slug] = {
      criterion_id: criterion.id,
      executions,
      failures: 0,
      last_result: result,
      passed_at_history_length: state.stage_history.length,
      ...(verifiedSource ? { verified_source: verifiedSource } : {}),
    }
    persistRun(root, state, 'entry_gate_passed', {
      stage: stage.slug,
      criterion: criterion.id,
      ...(result.evidence_path ? { evidence_path: result.evidence_path } : {}),
      ...(verifiedSource
        ? {
            verified_source_fingerprint: verifiedSource.fingerprint,
            verified_profile: verifiedSource.profile,
          }
        : {}),
    })

    return 'pass'
  }

  const failures = (previous?.failures ?? 0) + 1
  const record: NonNullable<RunState['entry_gates']>[string] = {
    criterion_id: criterion.id,
    executions,
    failures,
    last_result: result,
  }

  records[stage.slug] = record

  const laneGap = entryGateLaneGap(root, state, result)

  if (laneGap) {
    record.lane_gap = laneGap
  }

  const evidence = result.evidence_path
    ? ` Evidence: ${result.evidence_path}.`
    : ''

  if (failures > gate.max_loops) {
    const reason =
      `Entry gate '${criterion.id}' of stage '${stage.slug}' failed ` +
      `${failures} times; the workflow allows ${gate.max_loops} repair ` +
      `loop${gate.max_loops === 1 ? '' : 's'} through '${gate.failure}'. ` +
      `${result.explanation}${evidence}`

    state.status = 'paused'
    state.pause_reason = reason
    state.pending_action = { type: 'operator_decision', operator_only: true }
    writeDecision(
      root,
      state,
      `Release gate failed ${failures} times`,
      reason,
      [
        `Inspect the gate evidence${result.evidence_path ? ` at ${result.evidence_path}` : ''}.`,
        `Send the run back for repair with: ${panCommand(root)} resume ${state.run_id} --stage ${gate.failure}`,
        `Or abort with: ${panCommand(root)} abort ${state.run_id}`,
        'Away mode cannot take this decision.',
      ],
    )
    persistRun(root, state, 'run_paused', {
      reason,
      stage: stage.slug,
      criterion: criterion.id,
      failures,
    })

    return 'paused'
  }

  const workflow = loadRunWorkflow(root, state)
  const route = entryGateRepairRoute(workflow, stage, gate.failure)

  if (route.kind === 'unsatisfiable') {
    const reason =
      `Entry gate '${criterion.id}' of stage '${stage.slug}' failed, and the ` +
      `declared repair route through '${gate.failure}' cannot return the run ` +
      `to a stage that satisfies ${boundedCriterionList(route.blocking)}. ` +
      `${result.explanation}${evidence}`

    state.status = 'paused'
    state.pause_reason = reason
    state.pending_action = { type: 'operator_decision', operator_only: true }
    writeDecision(
      root,
      state,
      `Entry gate repair route is unsatisfiable`,
      reason,
      [
        `Inspect the gate evidence${result.evidence_path ? ` at ${result.evidence_path}` : ''}.`,
        `Send the run to a stage that can restore the evidence with: ${panCommand(root)} resume ${state.run_id} --stage <stage>`,
        `Or abort with: ${panCommand(root)} abort ${state.run_id}`,
      ],
    )
    persistRun(root, state, 'run_paused', {
      reason,
      stage: stage.slug,
      criterion: criterion.id,
      failures,
    })

    return 'paused'
  }

  onProgress?.(
    `entry gate ${criterion.id} failed (${failures}/${gate.max_loops} loops); routing to '${gate.failure}'`,
  )

  // A direct return skips the stages whose evidence the repair invalidates.
  // When the gate stage declares such a criterion, the repair stage follows
  // its own success transition instead, which retakes that evidence at the
  // post-repair workspace before the gate runs again.
  record.repair_stage = gate.failure

  if (route.kind === 'direct_return') {
    record.routed_to = gate.failure
  }

  applyTransition(root, state, stage, 'failure', {
    overrideTarget: gate.failure,
  })

  if (state.status !== 'running') {
    // A workflow limit intercepted the route. The route is closed because
    // the operator now chooses where the run continues.
    delete record.routed_to
    delete record.repair_stage
    persistRun(root, state, 'run_paused', { reason: state.pause_reason })

    return 'paused'
  }

  persistRun(root, state, 'entry_gate_failed', {
    stage: stage.slug,
    criterion: criterion.id,
    failures,
    routed_to: gate.failure,
    ...(result.evidence_path ? { evidence_path: result.evidence_path } : {}),
    ...(laneGap ? { lane_gap: true, lanes: laneGap.lanes } : {}),
  })

  return 'routed'
}

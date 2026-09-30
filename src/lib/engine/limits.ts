/**
 * Attempt limits, same-reason failure tracking, and the long-horizon failure
 * ladder.
 */

import path from 'node:path'

import { fileExists, isRecord, readJson, writeJsonAtomic } from '../io.js'
import { resolveRunLayout } from '../run-layout.js'
import { panCommand } from '../project-config.js'
import { now, writeDecision } from '../state.js'
import type {
  CriterionEvaluation,
  DeterministicResult,
  RunState,
  SameReasonFailureTrackers,
  StageDefinition,
  StageFailureTracker,
} from '../types.js'

function failAutonomousCandidate(
  root: string,
  state: RunState,
  reason: string,
): boolean {
  if (state.best_of_n?.role !== 'candidate') {
    return false
  }

  state.status = 'failed'
  state.current_stage = null
  state.pause_reason = null
  state.pending_action = { type: 'none' }

  writeDecision(root, state, 'Autonomous candidate failed', reason, [])

  return true
}

export function pauseForLimit(
  root: string,
  state: RunState,
  reason: string,
): boolean {
  if (failAutonomousCandidate(root, state, reason)) {
    return true
  }

  state.status = 'paused'
  state.pause_reason = reason
  state.pending_action = { type: 'operator_decision' }

  writeDecision(root, state, 'Workflow paused by circuit breaker', reason, [
    `Resume from a chosen stage with: ${panCommand(root)} resume ${state.run_id} --stage <stage>`,
    `Or abort with: ${panCommand(root)} abort ${state.run_id}`,
  ])

  return false
}

const VALIDATION_ONLY_SIGNATURE = ['__validation__']

/**
 * Verification stages loop through remediation rather than themselves, so the
 * same-reason breaker tracks them explicitly alongside self-looping stages.
 */
export function isSameReasonTrackedStage(stage: StageDefinition): boolean {
  return stage.slug === 'verify' || stage.transitions.failure === stage.slug
}

function sameReasonTrackers(state: RunState): SameReasonFailureTrackers {
  return (state.same_reason_failures ??= {})
}

export function clearSameReasonTracker(
  state: RunState,
  stageSlug: string,
): void {
  const trackers = state.same_reason_failures

  if (!trackers?.[stageSlug]) {
    return
  }

  delete trackers[stageSlug]

  if (Object.keys(trackers).length === 0) {
    delete state.same_reason_failures
  }
}

export function clearAllSameReasonTrackers(state: RunState): void {
  if (!state.same_reason_failures) {
    return
  }

  delete state.same_reason_failures
}

export function collectHardFailureSignature(
  stage: StageDefinition,
  selfCriteria: CriterionEvaluation[],
  deterministic: DeterministicResult[],
  validationErrors: string[],
): string[] {
  const self = new Map(selfCriteria.map((item) => [item.id, item]))
  const det = new Map(deterministic.map((item) => [item.id, item]))
  const failed = stage.criteria
    .filter((criterion) => {
      if (!criterion.hard) {
        return false
      }

      if (criterion.type === 'judgment') {
        return self.get(criterion.id)?.result === 'fail'
      }

      const result = det.get(criterion.id)

      return result?.passed === false && !result.disabled
    })
    .map((criterion) => criterion.id)
    .sort()

  if (failed.length === 0 && validationErrors.length > 0) {
    return [...VALIDATION_ONLY_SIGNATURE]
  }

  return failed
}

function isSameReasonSignature(current: string[], prior: string[]): boolean {
  if (prior.length === 0) {
    return false
  }

  const currentSet = new Set(current)

  return prior.every((criterionId) => currentSet.has(criterionId))
}

export type HorizonFailureAction =
  | { kind: 'retry' }
  | { kind: 'route'; target: string }
  | { kind: 'strategy'; target: string }
  | { kind: 'exhausted'; reason: string }

function sameHorizonSignature(current: string[], prior: string[]): boolean {
  return (
    prior.length > 0 &&
    current.length === prior.length &&
    current.every((criterion, index) => criterion === prior[index])
  )
}

function horizonDependentTaskIds(root: string, state: RunState): string[] {
  const binding = state.horizon

  if (!binding) {
    return []
  }

  const sessionPath = path.join(
    root,
    'runtime',
    'logs',
    'horizon',
    binding.session_id,
    'session.json',
  )

  if (!fileExists(sessionPath)) {
    return []
  }

  const value = readJson(sessionPath)

  if (!isRecord(value) || !Array.isArray(value.tasks)) {
    return []
  }

  const direct = new Map<string, string[]>()

  for (const task of value.tasks) {
    if (!isRecord(task) || typeof task.id !== 'string') {
      continue
    }

    direct.set(
      task.id,
      Array.isArray(task.depends_on)
        ? task.depends_on.filter(
            (dependency): dependency is string =>
              typeof dependency === 'string',
          )
        : [],
    )
  }

  const found = new Set<string>()
  const pending = [binding.task_id]

  while (pending.length > 0) {
    const dependency = pending.shift() as string

    for (const [taskId, dependencies] of direct) {
      if (found.has(taskId) || !dependencies.includes(dependency)) {
        continue
      }

      found.add(taskId)
      pending.push(taskId)
    }
  }

  return [...found].sort()
}

export function pauseForHorizonLadder(
  root: string,
  state: RunState,
  stage: StageDefinition,
  signature: string[],
  reason: string,
): void {
  const ladder = (state.horizon_ladder ??= {
    retries_spent: 0,
    strategy_switches_spent: 0,
    replans_spent: 0,
    last_failure_signature: [],
    approaches_tried: [],
  })
  const artifact = resolveRunLayout(root, state.run_id).artifactJson(
    `horizon-failure-${stage.slug}-${state.transition_count + 1}.json`,
  )
  const failure = {
    schema_version: 1,
    run_id: state.run_id,
    task_id: state.horizon?.task_id ?? null,
    session_id: state.horizon?.session_id ?? null,
    rung: 'scoped_replan',
    stage: stage.slug,
    approaches_tried: ladder.approaches_tried,
    error_class: signature.length > 0 ? signature.join(',') : 'unknown',
    dependent_tasks: horizonDependentTaskIds(root, state),
    reason,
    recorded_at: now(),
  }

  writeJsonAtomic(artifact.absolute, failure)
  ladder.pause_kind = 'ladder_exhausted'
  ladder.failure_record_path = artifact.relative
  ladder.last_failure_signature = signature
  state.status = 'paused'
  state.pause_reason = reason
  state.pending_action = { type: 'operator_decision' }
  state.current_invocation = null

  writeDecision(root, state, 'Long-horizon ladder exhausted', reason, [
    `Failure record: ${artifact.relative}`,
    state.horizon
      ? 'The owning long-horizon session may re-plan or defer this task.'
      : `Resume from a chosen stage with: ${panCommand(root)} resume ${state.run_id} --stage <stage>`,
  ])
}

export function classifyHorizonFailure(
  state: RunState,
  stage: StageDefinition,
  signature: string[],
): HorizonFailureAction {
  const ladder = (state.horizon_ladder ??= {
    retries_spent: 0,
    strategy_switches_spent: 0,
    replans_spent: 0,
    last_failure_signature: [],
    approaches_tried: [],
  })
  const repeated = sameHorizonSignature(
    signature,
    ladder.last_failure_signature,
  )
  ladder.last_failure_signature = signature

  if (!repeated && ladder.retries_spent < 2) {
    ladder.retries_spent += 1

    // A stage whose failure transition names another live stage already
    // declares its repair route (verify -> remediate). The retry rung then
    // spends its attempt on that route rather than on re-running the failed
    // stage against an unchanged workspace, which can only reproduce the
    // same verdict: two sessions spent a verifier, a reviewer, and a QA run
    // per task on exactly that re-run before any remediation began.
    const route = stage.transitions.failure
    const repairs =
      typeof route === 'string' &&
      route !== stage.slug &&
      !['succeeded', 'failed', 'canceled', 'paused'].includes(route)

    ladder.approaches_tried.push(
      repairs
        ? `retry ${ladder.retries_spent} via '${route}' from '${stage.slug}'`
        : `retry ${ladder.retries_spent} at stage '${stage.slug}'`,
    )

    return repairs ? { kind: 'route', target: route } : { kind: 'retry' }
  }

  if (ladder.strategy_switches_spent === 0) {
    ladder.strategy_switches_spent = 1
    const target = stage.transitions.failure
    const reason = repeated
      ? `failure signature repeated (${signature.join(', ') || 'unknown'})`
      : 'the two-retry bound was spent'

    ladder.directive = `Change strategy after ${reason}; do not repeat the prior approach.`
    ladder.approaches_tried.push(`strategy switch from '${stage.slug}'`)

    if (
      target &&
      target !== stage.slug &&
      !['succeeded', 'failed', 'canceled', 'paused'].includes(target)
    ) {
      return { kind: 'strategy', target }
    }

    return {
      kind: 'exhausted',
      reason: `Stage '${stage.slug}' has no declared repair route for the long-horizon strategy switch.`,
    }
  }

  return {
    kind: 'exhausted',
    reason:
      `Stage '${stage.slug}' exhausted the long-horizon retry and strategy-switch rungs ` +
      `for signature (${signature.join(', ') || 'unknown'}).`,
  }
}

export function recordSameReasonFailure(
  state: RunState,
  stageSlug: string,
  signature: string[],
): boolean {
  const trackers = sameReasonTrackers(state)
  const existing = trackers[stageSlug]

  if (existing && isSameReasonSignature(signature, existing.last_signature)) {
    const updated: StageFailureTracker = {
      last_signature: signature,
      repeat_count: existing.repeat_count + 1,
    }

    trackers[stageSlug] = updated

    return updated.repeat_count >= 2
  }

  trackers[stageSlug] = {
    last_signature: signature,
    repeat_count: 1,
  }

  return false
}

export function pauseForSameReasonFailure(
  root: string,
  state: RunState,
  stage: StageDefinition,
): void {
  const tracker = isSameReasonTrackedStage(stage)
    ? state.same_reason_failures?.[stage.slug]
    : undefined
  const signature = tracker?.last_signature.join(', ') ?? 'unknown'
  const reason =
    `Stage '${stage.slug}' failed twice consecutively for the same ` +
    `deterministic reason (${signature}).`

  if (failAutonomousCandidate(root, state, reason)) {
    return
  }

  state.status = 'paused'
  state.pause_reason = reason
  state.pending_action = { type: 'operator_decision' }

  writeDecision(root, state, 'Same-reason retry limit reached', reason, [
    `Resume from a chosen stage with: ${panCommand(root)} resume ${state.run_id} --stage <stage>`,
    `Waive or redirect the gate with: ${panCommand(root)} waive-gate ${state.run_id} --note "<directive>" [--to <stage>]`,
    `Or abort with: ${panCommand(root)} abort ${state.run_id}`,
  ])
}

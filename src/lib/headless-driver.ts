import { existsSync } from 'node:fs'
import path from 'node:path'

import { maybeStartDelivery, type DeliveryAutostartResult } from './cohorts.js'
import {
  decideRun,
  delegateEvidenceWorkers,
  delegateInvocation,
  getRunState,
  prepareInvocation,
  submitOutput,
} from './engine.js'
import { personaExecutorOf } from './executors/mapping.js'
import {
  attestSupervisorCard,
  redlineCurrent,
} from './governance/supervisor-card.js'
import { readJson } from './io.js'
import { writeRedlineRecord } from './watch.js'
import type {
  Invocation,
  PendingAction,
  PersonaExecutorKind,
  RunState,
} from './types.js'

export interface HeadlessDriverDecision {
  decision: string
  note?: string
}

export interface HeadlessDriverDecisionContext {
  state: RunState
  action: Extract<
    PendingAction,
    { type: 'operator_approval' | 'operator_decision' }
  >
  stage: string
}

export type HeadlessDriverDecisionResolution =
  | HeadlessDriverDecision
  | { reason: string }

export type HeadlessDriverStop =
  | { type: 'terminal'; status: RunState['status'] }
  | {
      type: 'operator_pause'
      action: 'operator_approval' | 'operator_decision'
      stage: string
      operator_only: boolean
      reason: string
    }
  | { type: 'unresolved'; reason: string }
  | { type: 'step_limit'; limit: number; reason: string }

export interface HeadlessDriverOptions {
  onProgress?: (message: string) => void
  maxSteps?: number
  resolveDecision?: (
    context: HeadlessDriverDecisionContext,
  ) => HeadlessDriverDecisionResolution | null
  canDelegateExecutor?: (executor: PersonaExecutorKind) => boolean
  unsupportedExecutorReason?: (
    state: RunState,
    invocation: Invocation,
    executor: PersonaExecutorKind,
  ) => string
  attestSupervisorCard?: boolean
  attestedBy?: string
}

export interface HeadlessDriverResult {
  state: RunState
  stop: HeadlessDriverStop
  handoff_reason: string | null
  steps: number
  decisions_applied: Array<{ stage: string; decision: string }>
  last_autostart: DeliveryAutostartResult | null
  supervisor_card_attested_by: string | null
}

function readInvocation(root: string, state: RunState): Invocation | null {
  const pointer = state.current_invocation

  return pointer
    ? (readJson(path.resolve(root, pointer.json_path)) as Invocation)
    : null
}

/**
 * Advance exactly one run through harness-owned actions.
 *
 * All counters and stop state are local to this call. A caller that drives a
 * second run starts from a new function invocation and inherits no memory.
 */
export function driveRun(
  root: string,
  runId: string,
  options: HeadlessDriverOptions = {},
): HeadlessDriverResult {
  const maxSteps = options.maxSteps ?? 40
  const decisionsApplied: Array<{ stage: string; decision: string }> = []
  let lastAutostart: DeliveryAutostartResult | null = null
  let supervisorCardAttestedBy: string | null = null
  let handoffReason: string | null = null
  let stop: HeadlessDriverStop | null = null
  let steps = 0

  for (; steps < maxSteps; steps += 1) {
    const state = getRunState(root, runId)
    const action = state.pending_action

    if (['succeeded', 'failed', 'canceled'].includes(state.status)) {
      stop = { type: 'terminal', status: state.status }
      break
    }

    if (
      action.type === 'operator_approval' ||
      action.type === 'operator_decision'
    ) {
      const stage =
        'stage' in action && typeof action.stage === 'string'
          ? action.stage
          : (state.current_stage ?? '')
      const resolution = options.resolveDecision?.({ state, action, stage })

      if (!resolution || 'reason' in resolution) {
        handoffReason =
          resolution && 'reason' in resolution
            ? resolution.reason
            : `the run needs an operator ${action.type.replace('_', ' ')} at stage '${stage}'`
        stop = {
          type: 'operator_pause',
          action: action.type,
          stage,
          operator_only:
            'operator_only' in action && action.operator_only === true,
          reason: state.pause_reason ?? handoffReason,
        }
        break
      }

      options.onProgress?.(
        `applying resolved decision ${resolution.decision} at ${stage}`,
      )
      const decided = decideRun(
        root,
        runId,
        resolution.decision,
        resolution.note ?? '',
      )
      decisionsApplied.push({ stage, decision: resolution.decision })
      const autostart = maybeStartDelivery(root, decided, {
        actor: 'operator',
        action: resolution.decision,
      })

      if (autostart) {
        lastAutostart = autostart
        options.onProgress?.(
          autostart.status === 'failed'
            ? `delivery autostart failed: ${autostart.error}`
            : autostart.kind === 'cohort'
              ? `cohort ${autostart.cohort_id} ${autostart.status}: ${autostart.chunks.length} chunk run(s), ${autostart.deferred_chunks.length} deferred`
              : `delivery run ${autostart.run_id} ${autostart.status} in ${autostart.worktree}`,
        )
      }
      continue
    }

    if (state.status !== 'running') {
      handoffReason = `the run is '${state.status}' with pending action '${action.type}'`
      stop = { type: 'unresolved', reason: handoffReason }
      break
    }

    const card = state.supervisor_card

    if (card && card.attested_sha256 !== card.sha256) {
      if (!options.attestSupervisorCard) {
        handoffReason = `the supervisor card ${card.path} is not attested at its current digest; a supervisor must read it and attest before the harness prepares an invocation`
        stop = { type: 'unresolved', reason: handoffReason }
        break
      }

      options.onProgress?.(
        `attesting the supervisor card ${card.path} on the operator's behalf`,
      )
      attestSupervisorCard(root, runId, card.sha256)
      writeRedlineRecord(root, runId, 'pan-start')
      supervisorCardAttestedBy = options.attestedBy ?? 'headless-driver'
      continue
    }

    if (card && !redlineCurrent(root, state).current) {
      if (!options.attestSupervisorCard) {
        handoffReason = `supervisor session ${card.session_generation} has written no platform-guidance redline; a supervisor must run pan status --redline before the harness prepares an invocation`
        stop = { type: 'unresolved', reason: handoffReason }
        break
      }

      options.onProgress?.(
        "writing the platform-guidance redline on the operator's behalf",
      )
      writeRedlineRecord(root, runId, 'pan-start')
      continue
    }

    if (action.type === 'prepare_invocation') {
      options.onProgress?.('preparing the next invocation')
      prepareInvocation(root, runId, { onProgress: options.onProgress })
      continue
    }

    if (action.type === 'invoke_agent') {
      const invocation = readInvocation(root, state)

      if (!invocation) {
        handoffReason = 'the run has no current invocation to delegate'
        stop = { type: 'unresolved', reason: handoffReason }
        break
      }

      const executor =
        invocation.stage.persona_executor ??
        personaExecutorOf(invocation.stage.model)

      if (options.canDelegateExecutor?.(executor) === false) {
        handoffReason =
          options.unsupportedExecutorReason?.(state, invocation, executor) ??
          `stage '${invocation.stage.slug}' persona '${invocation.stage.persona}' maps to the ${executor} executor, which this driver cannot delegate`
        stop = { type: 'unresolved', reason: handoffReason }
        break
      }

      if ((invocation.evidence_workers ?? []).length > 0) {
        // An evidence worker is a stage worker for this purpose: the stage
        // cannot be delegated until its reports exist. A caller that declines
        // a Cursor stage declines its Cursor evidence workers by the same
        // predicate, which leaves the eval loop's behaviour unchanged.
        const workers = delegateEvidenceWorkers(root, runId, {
          onProgress: options.onProgress,
          headless: options.canDelegateExecutor?.('cursor') ?? true,
        })
        const failed = workers.filter((worker) => !worker.ok)

        if (failed.length > 0) {
          const current = getRunState(root, runId)

          // A failed executor preflight pauses the run from inside the
          // delegation, and that pause is the operator's to resolve, so it is
          // returned with its own reason rather than as an unresolved stop.
          if (current.status === 'paused') {
            handoffReason = `delegation paused the run: ${current.pause_reason ?? 'unknown reason'}`
            stop = {
              type: 'operator_pause',
              action: 'operator_decision',
              stage: current.current_stage ?? invocation.stage.slug,
              operator_only: true,
              reason: current.pause_reason ?? handoffReason,
            }
            break
          }

          handoffReason = `evidence worker(s) did not produce a report: ${failed
            .map(
              (worker) =>
                `${worker.role} (${worker.skipped ?? worker.error ?? 'failed'})`,
            )
            .join(', ')}`
          stop = { type: 'unresolved', reason: handoffReason }
          break
        }
      }

      options.onProgress?.(`delegating ${invocation.stage.slug} to ${executor}`)
      const delegated = delegateInvocation(root, runId, {
        onProgress: options.onProgress,
        headless: true,
      })

      if (!delegated.execution) {
        handoffReason = `delegation paused the run: ${delegated.state.pause_reason ?? 'unknown reason'}`
        stop = {
          type: 'operator_pause',
          action: 'operator_decision',
          stage: delegated.state.current_stage ?? invocation.stage.slug,
          operator_only: true,
          reason: delegated.state.pause_reason ?? handoffReason,
        }
        break
      }

      const outputPath = delegated.state.current_invocation?.output_path

      if (!outputPath || !existsSync(path.resolve(root, outputPath))) {
        handoffReason = `the external executor left no output at ${outputPath ?? '(unknown)'}`
        stop = { type: 'unresolved', reason: handoffReason }
        break
      }

      options.onProgress?.(`submitting ${outputPath}`)
      submitOutput(root, runId, outputPath, {
        onProgress: options.onProgress,
      })
      continue
    }

    handoffReason = `pending action '${action.type}' needs the Cursor supervisor`
    stop = { type: 'unresolved', reason: handoffReason }
    break
  }

  const state = getRunState(root, runId)

  if (!stop) {
    if (['succeeded', 'failed', 'canceled'].includes(state.status)) {
      stop = { type: 'terminal', status: state.status }
    } else {
      handoffReason = `the drive loop reached its ${maxSteps}-step bound`
      stop = { type: 'step_limit', limit: maxSteps, reason: handoffReason }
    }
  }

  return {
    state,
    stop,
    handoff_reason: handoffReason,
    steps,
    decisions_applied: decisionsApplied,
    last_autostart: lastAutostart,
    supervisor_card_attested_by: supervisorCardAttestedBy,
  }
}

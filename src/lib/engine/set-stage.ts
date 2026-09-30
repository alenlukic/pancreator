/**
 * Operator stage redirection and run verification settings.
 */

import { invariant } from '../errors.js'
import {
  fileExists,
  isRecord,
  readJson,
  resolveInside,
  withOperationMutex,
  writeTextAtomic,
} from '../io.js'
import { resolveRunLayout } from '../run-layout.js'
import { panCommand } from '../project-config.js'
import {
  disabledEvidenceProducers,
  resolveVerification,
  type RatifiedAcceptanceCriterion,
} from '../verification.js'
import { evidenceWorkerAttempts } from '../render.js'
import { operationMutexPath, loadState, now, writeDecision } from '../state.js'
import type { RunActionActor, RunState } from '../types.js'
import { delegationPath } from '../validation.js'
import { stageBySlug } from '../workflow.js'

import { loadRunWorkflow, persistRun, readInvocation } from './core.js'
import { clearAllSameReasonTrackers } from './limits.js'
import { clearEntryGateRoutes } from './entry-gate.js'
import { resetAttemptsFrom } from './recovery.js'

/** One launched evidence worker whose declared report does not exist yet. */
export interface InFlightEvidenceWorker {
  role: string
  attempt: number
  evidence_path: string
  /** The platform handle, when the launch recorded one. */
  handle: string | null
}

/**
 * Evidence workers of the current invocation that were launched and have
 * written no report.
 *
 * A stage return abandons them: the invocation they write into stops being
 * current, so their reports land where nothing reads them. Durable state
 * cannot see a process, so a launch is read from the delegation artifact the
 * supervisor persists before launching and from any recorded handle.
 */
export function inFlightEvidenceWorkers(
  root: string,
  state: RunState,
): InFlightEvidenceWorker[] {
  const current = state.current_invocation

  if (!current) {
    return []
  }

  const invocation = readInvocation(root, current.json_path)
  const launched = (state.delegated_workers ?? []).filter(
    (record) => record.invocation_id === invocation.invocation_id,
  )
  const delegated =
    launched.length > 0 ||
    fileExists(
      resolveInside(
        root,
        delegationPath(state.run_id, invocation.invocation_id, root),
      ),
    )

  if (!delegated) {
    return []
  }

  const inFlight: InFlightEvidenceWorker[] = []

  for (const worker of invocation.evidence_workers ?? []) {
    for (const attempt of evidenceWorkerAttempts(worker)) {
      if (fileExists(resolveInside(root, attempt.evidence_path))) {
        continue
      }

      inFlight.push({
        role: worker.role,
        attempt: attempt.attempt,
        evidence_path: attempt.evidence_path,
        handle:
          launched.find(
            (record) =>
              record.role === worker.role && record.attempt === attempt.attempt,
          )?.handle ?? null,
      })
    }
  }

  return inFlight
}

export interface SetRunStageOptions {
  /**
   * Return the stage even though launched evidence workers have written no
   * report. The operator owns that call; the harness only refuses to make it
   * silently.
   */
  abandonWorkers?: boolean
}

/**
 * Move a run to an operator-selected stage outside normal workflow transitions.
 * An obsolete worker may continue writing because durable state cannot observe
 * process lifetime, so stopping it first is prudent. That operational risk does
 * not constrain the operator's authority to redirect the run.
 */
function setRunStageWithActor(
  root: string,
  runId: string,
  stageSlug: string,
  note: string,
  actor: RunActionActor,
  options: SetRunStageOptions = {},
): RunState {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(note.trim().length > 0, 'Stage repair note MUST be non-empty.', {
      code: 'REPAIR_NOTE_REQUIRED',
    })
    invariant(
      actor === 'operator' ||
        state.pending_action.type !== 'operator_decision' ||
        state.pending_action.operator_only !== true,
      'Away mode cannot redirect a run paused for an operator-only decision.',
      { code: 'AWAY_ACTION_FORBIDDEN' },
    )

    const abandoned = options.abandonWorkers
      ? []
      : inFlightEvidenceWorkers(root, state)

    invariant(
      abandoned.length === 0,
      `Returning to '${stageSlug}' abandons ${abandoned.length} launched ` +
        `evidence worker${abandoned.length === 1 ? '' : 's'} that have ` +
        `written no report: ` +
        abandoned
          .map(
            (worker) =>
              `${worker.role} (attempt ${worker.attempt}` +
              `${worker.handle ? `, handle ${worker.handle}` : ''})`,
          )
          .join(', ') +
        `. Their reports would land against an invocation nothing reads. ` +
        `Stop them, or repeat the command with --abandon-workers.`,
      {
        code: 'EVIDENCE_WORKERS_IN_FLIGHT',
        details: { in_flight: abandoned },
      },
    )

    const workflow = loadRunWorkflow(root, state)
    stageBySlug(workflow, stageSlug)

    const fromStage = state.current_stage ?? state.status
    const sourceAttempt = state.current_stage
      ? (state.attempts[state.current_stage] ?? 0)
      : 0

    const feedback = state.operator_feedback ?? []
    const index = feedback.length + 1
    const relativePath = resolveRunLayout(root, state.run_id).decision(
      `${actor}-feedback-${index}.md`,
    ).relative

    const body = [
      actor === 'operator'
        ? '# Operator stage repair'
        : '# Away-mode stage repair',
      '',
      `**Run** \`${state.run_id}\` · **Previous state** \`${fromStage}\` · ` +
        `**Target stage** \`${stageSlug}\``,
      '',
      '## Repair reason',
      '',
      note.trim(),
      '',
      `This ${actor}-directed repair bypassed normal workflow transitions. ` +
        'Treat the reason above as required input for this stage.',
      '',
    ].join('\n')

    writeTextAtomic(resolveInside(root, relativePath), `${body}\n`)

    feedback.push({
      decision: 'set-stage',
      source: actor,
      from_stage: fromStage,
      to_stage: stageSlug,
      attempt: sourceAttempt,
      note,
      path: relativePath,
      timestamp: now(),
    })
    state.operator_feedback = feedback

    resetAttemptsFrom(workflow, state, stageSlug)
    clearAllSameReasonTrackers(state)
    clearEntryGateRoutes(state)
    state.status = 'running'
    state.current_stage = stageSlug
    state.pending_action = { type: 'prepare_invocation' }
    state.current_invocation = null
    state.pause_reason = null
    state.operator_pause = null
    state.accepted_workspace_fingerprint = null
    state.transition_count = 0
    state.consecutive_failures = 0

    persistRun(
      root,
      state,
      actor === 'operator' ? 'operator_stage_set' : 'away_stage_set',
      {
        from_stage: fromStage,
        to_stage: stageSlug,
        note_path: relativePath,
        actor,
      },
    )

    return state
  })
}

export function setRunStage(
  root: string,
  runId: string,
  stageSlug: string,
  note: string,
  options: SetRunStageOptions = {},
): RunState {
  return setRunStageWithActor(root, runId, stageSlug, note, 'operator', options)
}

/** Apply an away-mode stage repair without recording operator authorship. */
export function setRunStageAsAway(
  root: string,
  runId: string,
  stageSlug: string,
  note: string,
  options: SetRunStageOptions = {},
): RunState {
  return setRunStageWithActor(root, runId, stageSlug, note, 'away', options)
}

/**
 * The ratified acceptance criteria of a run, read from its own accepted plan
 * output. A run that carries no plan stage reports none.
 */
function ratifiedAcceptanceCriteria(
  root: string,
  state: RunState,
): RatifiedAcceptanceCriterion[] {
  const planOutput = [...state.stage_history]
    .reverse()
    .find(
      (item) => item.stage === 'plan' && item.outcome === 'success',
    )?.output_path

  if (!planOutput || !fileExists(resolveInside(root, planOutput))) {
    return []
  }

  let value: unknown = null

  try {
    value = readJson(resolveInside(root, planOutput))
  } catch {
    return []
  }

  const data = isRecord(value) && isRecord(value.data) ? value.data : {}
  const criteria = Array.isArray(data.acceptance_criteria)
    ? data.acceptance_criteria
    : []

  return criteria.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string') {
      return []
    }

    const verification = verificationProse(item.verification)

    return verification ? [{ id: item.id, verification }] : []
  })
}

/**
 * The verification prose of one ratified criterion.
 *
 * The plan contract records `verification` as `{ method, expected }`, so the
 * consequence report matched nothing while it accepted only a bare string:
 * every real plan output produced an empty stranded list. Both shapes resolve,
 * because a criterion names its profile in either half.
 */
function verificationProse(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? value : null
  }

  if (!isRecord(value)) {
    return null
  }

  const prose = [value.method, value.expected]
    .filter((part): part is string => typeof part === 'string')
    .join(' — ')

  return prose.trim().length > 0 ? prose : null
}

/**
 * Change a run's verification level. The new level is resolved fresh from
 * config plus built-ins and replaces the run's snapshot, so later gates run
 * under the new mapping. Baselines are not recaptured: a gate whose new
 * profile was never baselined is judged on its own result.
 */
export function setRunVerification(
  root: string,
  runId: string,
  levelName: string,
  note = '',
  options: { confirmed?: boolean } = {},
): RunState {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(
      state.status !== 'succeeded' &&
        state.status !== 'failed' &&
        state.status !== 'canceled',
      'Run is already terminal.',
      { code: 'RUN_TERMINAL' },
    )

    const resolved = resolveVerification(root, levelName)
    // A level change that strands a ratified criterion is discovered today at
    // the gate that demands the evidence, which is far past the point where
    // the operator could have chosen differently.
    const stranded = disabledEvidenceProducers(
      ratifiedAcceptanceCriteria(root, state),
      state.verification,
      resolved,
    )

    invariant(
      stranded.length === 0 || options.confirmed === true,
      `Verification level '${resolved.level}' disables the evidence ` +
        `producer of ${stranded.length} ratified acceptance ` +
        `criterion/criteria: ` +
        stranded
          .map((item) => `${item.criterion_id} (${item.profile}, ${item.gate})`)
          .join('; ') +
        '. Re-run with --confirm to apply the level and accept that those ' +
        'criteria lose their evidence producer.',
      {
        code: 'VERIFICATION_CONSEQUENCE_UNCONFIRMED',
        details: { level: resolved.level, disabled_evidence: stranded },
      },
    )

    const previous = state.verification?.level ?? 'workflow-declared'
    const reason =
      `Operator set verification level '${resolved.level}' ` +
      `(was '${previous}').${note.trim().length > 0 ? ` ${note.trim()}` : ''}`

    state.verification = resolved
    state.updated_at = now()

    writeDecision(root, state, 'Verification level changed', reason, [
      `Continue with: ${panCommand(root)} resume ${state.run_id}`,
    ])

    persistRun(root, state, 'verification_level_changed', {
      from: previous,
      to: resolved.level,
      ...(stranded.length > 0 ? { disabled_evidence: stranded } : {}),
      ...(note.trim().length > 0 ? { note: note.trim() } : {}),
    })

    return state
  })
}

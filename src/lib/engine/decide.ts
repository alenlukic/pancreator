/**
 * Supervisor assessments and operator decisions.
 */

import { invariant } from '../errors.js'
import {
  readJson,
  resolveInside,
  withOperationMutex,
  writeJsonAtomic,
} from '../io.js'
import { runHasContract } from '../operator-involvement.js'
import { operationMutexPath, loadState, writeDecision } from '../state.js'
import type {
  ReleaseLandingRecord,
  RunActionActor,
  RunState,
  SupervisorAssessment,
} from '../types.js'
import { stageBySlug } from '../workflow.js'
import { gitIsAncestor, INTEGRATION_BRANCH } from '../git.js'
import { workspaceRepositoryRoot } from '../worktrees.js'
import { latestLandedSession } from '../landing-log.js'

import {
  loadRunWorkflow,
  parseSupervisorAssessment,
  persistRun,
} from './core.js'
import { clearSameReasonTracker } from './limits.js'
import { applyTransition } from './transition.js'
import {
  recordOperatorFeedback,
  recoveryRouteFor,
  resetAttemptsFrom,
} from './recovery.js'

/**
 * Records the supervisor's assessment of the active invocation under the run's
 * operation mutex. A pass or fail applies the stage transition; an escalation
 * pauses the run for an operator decision and writes a decision record, except
 * on a best-of-N candidate, where it counts as a failure. Writes the assessment
 * to the pending output path, persists the run, and returns the new state with
 * the parsed assessment. Throws `INVALID_RUN_ACTION` when the run is not
 * awaiting an assessment and `INVALID_ASSESSMENT` when the assessment is
 * malformed or names another invocation.
 */
export function assessStage(
  root: string,
  runId: string,
  assessmentPath: string,
): { state: RunState; assessment: SupervisorAssessment } {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(
      state.status === 'awaiting_supervisor' &&
        state.pending_action.type === 'supervisor_assessment',
      'Run is not awaiting supervisor assessment.',
      { code: 'INVALID_RUN_ACTION' },
    )
    invariant(state.current_invocation, 'Run has no active invocation.', {
      code: 'INVALID_RUN_ACTION',
    })

    const assessment = parseSupervisorAssessment(
      readJson(resolveInside(root, assessmentPath)),
      assessmentPath,
    )

    invariant(
      assessment.invocation_id === state.current_invocation.id,
      'Assessment invocation_id MUST match the active invocation.',
      { code: 'INVALID_ASSESSMENT' },
    )

    const workflow = loadRunWorkflow(root, state)
    const stage = stageBySlug(workflow, state.current_stage)

    writeJsonAtomic(
      resolveInside(root, state.pending_action.output_path),
      assessment,
    )

    if (
      assessment.verdict === 'escalate' &&
      state.best_of_n?.role === 'candidate'
    ) {
      state.status = 'running'
      applyTransition(root, state, stage, 'failure')
    } else if (assessment.verdict === 'escalate') {
      state.status = 'paused'
      state.pause_reason = assessment.summary
      state.pending_action = { type: 'operator_decision' }

      writeDecision(
        root,
        state,
        'Supervisor escalated a judgment',
        assessment.summary,
        assessment.action_items ?? [],
      )
    } else {
      state.status = 'running'
      applyTransition(
        root,
        state,
        stage,
        assessment.verdict === 'pass' ? 'success' : 'failure',
      )
    }

    persistRun(root, state, 'supervisor_assessment_recorded', {
      stage: stage.slug,
      verdict: assessment.verdict,
    })

    return { state, assessment }
  })
}

/**
 * Close a run at ship as succeeded after an operator directed its release onto
 * pan-dev outside the stage. The landing is read from the landing log, never
 * from the operator's words, and must sit on pan-dev.
 */
function recordLandedDecision(
  root: string,
  state: RunState,
  note: string,
  actor: RunActionActor,
): RunState {
  invariant(actor === 'operator', 'Away mode cannot record a landing.', {
    code: 'AWAY_ACTION_FORBIDDEN',
  })

  const workflow = loadRunWorkflow(root, state)
  const stage = stageBySlug(workflow, state.current_stage)

  invariant(
    stage.slug === 'ship',
    `A landing closes a run only at ship; this run is at '${stage.slug}'.`,
    { code: 'LANDED_STAGE_INVALID' },
  )
  invariant(
    note.trim().length > 0,
    'A landed decision MUST carry the operator directive in --note.',
    { code: 'LANDED_NOTE_REQUIRED' },
  )

  const landed = state.managed_worktree
    ? latestLandedSession(root, state.run_id, state.managed_worktree.name)
    : null

  invariant(
    landed !== null,
    `runtime/release/landing.jsonl holds no landed release for run ${state.run_id}` +
      (state.managed_worktree
        ? ` on worktree '${state.managed_worktree.name}'.`
        : ', and the run has no managed worktree.'),
    { code: 'RELEASE_LANDING_NOT_FOUND' },
  )
  invariant(
    gitIsAncestor(
      workspaceRepositoryRoot(root),
      landed.tip_after,
      INTEGRATION_BRANCH,
    ),
    `The landed commit ${landed.tip_after} is not on ${INTEGRATION_BRANCH}.`,
    { code: 'RELEASE_LANDING_NOT_ON_INTEGRATION' },
  )

  const record: ReleaseLandingRecord = {
    version: landed.version,
    release_commit: landed.release_commit,
    index_commit: landed.index_commit,
    tip_before: landed.tip_before,
    tip_after: landed.tip_after,
    verified_profiles: landed.verified_profiles,
    verification_basis: landed.verification_basis,
    landed_at: landed.landed_at,
    landing_token: landed.token,
    directive_note: note,
    recorded_at: new Date().toISOString(),
  }

  state.release_landing = record
  persistRun(root, state, 'release_landed', { stage: stage.slug, ...record })
  state.status = 'running'
  applyTransition(root, state, stage, 'success', {
    overrideTarget: 'succeeded',
    operatorDirected: true,
  })
  persistRun(root, state, 'operator_decision_recorded', {
    stage: stage.slug,
    decision: 'landed',
    note,
    actor,
    target_stage: null,
  })

  return state
}

function decideRunWithActor(
  root: string,
  runId: string,
  decision: string,
  note = '',
  targetStage: string | null = null,
  actor: RunActionActor,
): RunState {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    // A landing outside the stage also closes a run that paused at ship, for
    // example on a landing mutex timeout the operator then resolved by hand.
    const landedAtShip =
      decision === 'landed' &&
      state.current_stage === 'ship' &&
      state.status === 'paused'

    // A refusal that names only the precondition leaves the operator to infer
    // the route from a status it cannot see, so it names both.
    invariant(
      landedAtShip ||
        (state.status === 'awaiting_operator' &&
          state.pending_action.type === 'operator_approval'),
      `Run is not awaiting operator approval: its status is '${state.status}'. ` +
        recoveryRouteFor(root, state, 'decide'),
      { code: 'INVALID_RUN_ACTION', details: { status: state.status } },
    )
    invariant(
      decision === 'approve' ||
        decision === 'reject' ||
        decision === 'revise' ||
        decision === 'landed',
      'Decision MUST be approve, reject, revise, or landed.',
      { code: 'INVALID_DECISION' },
    )

    if (decision === 'landed') {
      return recordLandedDecision(root, state, note, actor)
    }

    const workflow = loadRunWorkflow(root, state)
    const stage = stageBySlug(workflow, state.current_stage)
    // A pending action recorded before outcome-aware gates carries no outcome,
    // and only a successful stage could stop then, so success is the safe default.
    const approvedOutcome =
      state.pending_action.type === 'operator_approval'
        ? (state.pending_action.outcome ?? 'success')
        : 'success'

    invariant(
      decision !== 'revise' || note.trim().length > 0,
      'A revise decision MUST carry the operator directive in --note.',
      { code: 'REVISION_NOTE_REQUIRED' },
    )

    state.status = 'running'

    if (decision === 'approve') {
      applyTransition(root, state, stage, approvedOutcome)

      // A non-empty approval note is a directive to the routed stage, not
      // just audit text: recording it only in the event log silently dropped
      // it from every later invocation while the operator reasonably believed
      // the run received it (HR-001, run 63322_Aug-18-1287_box-poller-p). On
      // a terminal or paused route there is no next card, so the note stays
      // audit evidence in the decision event below.
      const routedStage = state.current_stage

      if (
        actor === 'operator' &&
        note.trim().length > 0 &&
        routedStage !== null &&
        state.status === 'running'
      ) {
        recordOperatorFeedback(root, state, stage, routedStage, 'approve', note)
      }
    } else if (decision === 'revise') {
      recordOperatorFeedback(
        root,
        state,
        stage,
        stage.slug,
        'revise',
        note,
        actor,
      )
      clearSameReasonTracker(state, stage.slug)

      if (actor === 'operator') {
        // Re-run the same stage with the operator's directive as required input.
        // The stage did not fail, so this must not consume its retry budget.
        const revisions = state.operator_revisions ?? {}

        revisions[stage.slug] = (revisions[stage.slug] ?? 0) + 1
        state.operator_revisions = revisions

        applyTransition(root, state, stage, 'failure', {
          overrideTarget: stage.slug,
          operatorDirected: true,
        })
      } else {
        applyTransition(root, state, stage, 'failure', {
          overrideTarget: stage.slug,
        })
      }
    } else {
      let target = stage.transitions.failure

      if (targetStage) {
        invariant(actor === 'operator', 'Away mode cannot override a route.', {
          code: 'AWAY_ACTION_FORBIDDEN',
        })
        stageBySlug(workflow, targetStage)
        target = targetStage
        resetAttemptsFrom(workflow, state, target)
      }

      recordOperatorFeedback(root, state, stage, target, 'reject', note, actor)
      applyTransition(root, state, stage, 'failure', {
        overrideTarget: target,
        operatorDirected: actor === 'operator' && Boolean(targetStage),
      })
    }

    persistRun(
      root,
      state,
      actor === 'operator'
        ? 'operator_decision_recorded'
        : 'away_decision_applied',
      {
        stage: stage.slug,
        decision,
        note,
        actor,
        target_stage: decision === 'approve' ? null : state.current_stage,
        ...(decision === 'revise' && actor === 'operator'
          ? { operator_revision: state.operator_revisions?.[stage.slug] }
          : {}),
      },
    )

    return state
  })
}

/**
 * Applies an operator decision (`approve`, `reject`, `revise`, or `landed`) to
 * a run awaiting operator approval, under the run's operation mutex, and
 * persists the result. Approve takes the approved outcome's transition and
 * records any note as a directive to the routed stage; revise reruns the same
 * stage with the note as required input without spending its retry budget;
 * reject routes to the failure target or to `targetStage`; landed closes a
 * ship-stage run whose release reached pan-dev outside the stage.
 *
 * Throws `INVALID_RUN_ACTION` (naming the recovery route) when the run is not
 * awaiting approval, `INVALID_DECISION` for another decision, and
 * `REVISION_NOTE_REQUIRED` for a revise without a note.
 */
export function decideRun(
  root: string,
  runId: string,
  decision: string,
  note = '',
  targetStage: string | null = null,
): RunState {
  return decideRunWithActor(
    root,
    runId,
    decision,
    note,
    targetStage,
    'operator',
  )
}

/** Apply an away-mode gate decision without recording operator authorship. */
export function decideRunAsAway(
  root: string,
  runId: string,
  decision: string,
  note = '',
): RunState {
  return decideRunWithActor(root, runId, decision, note, null, 'away')
}

/**
 * Lift the operator-only mark from a paused run's pending decision so a
 * long-horizon arbiter override can act on it.
 *
 * The mark exists so away mode cannot take a decision the harness classified
 * as the operator's. HORIZON-001 names four hard blocks and nothing else, and
 * the session arbiter reasons about each stop against that list before it
 * acts. A stop it did not classify as a hard block is not the operator's, so
 * the mark is lifted with the arbiter's reasoning recorded on the run. The
 * run stays paused; the caller applies the override action next.
 */
export function liftOperatorOnlyPauseForHorizon(
  root: string,
  runId: string,
  reasoning: string,
): RunState {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(reasoning.trim().length > 0, 'Override reasoning is required.', {
      code: 'HORIZON_OVERRIDE_REASON_REQUIRED',
    })
    // A task's own run carries the session binding; the delivery, chunk, and
    // release runs its plan approval started carry only the contract. Both
    // belong to the session's task, so both accept the override.
    invariant(
      state.horizon !== undefined ||
        runHasContract(state.operator_involvement, 'long_horizon'),
      'Only a long-horizon run accepts an arbiter override.',
      { code: 'HORIZON_OVERRIDE_FORBIDDEN' },
    )

    if (
      state.pending_action.type !== 'operator_decision' ||
      state.pending_action.operator_only !== true
    ) {
      return state
    }

    state.pending_action = { type: 'operator_decision' }
    persistRun(root, state, 'horizon_override_lifted_operator_only', {
      reasoning,
      stage: state.current_stage,
      pause_reason: state.pause_reason ?? null,
    })

    return state
  })
}

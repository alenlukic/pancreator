/**
 * The worker handoff, prior attempts, operator feedback, and exception
 * references of an invocation.
 */

import { isRecord, readJson, resolveInside } from '../io.js'
import { resolveRunLayout } from '../run-layout.js'
import { writeWorkerHandoff } from '../worker-handoff.js'
import { activeOperatorGateWaivers } from '../waivers.js'
import type {
  InvocationReference,
  StageDefinition,
  RunState,
} from '../types.js'
import { addReference, type InvocationContextOptions } from './references.js'
import { addStageHistoryReference } from './stage-outputs.js'

/**
 * A source-editing worker that follows an earlier source attempt, whether a
 * retry, a remediation, or a return to implement, receives that attempt's
 * notes and reading map as a required input.
 */
export function selectWorkerHandoff(
  references: Map<string, InvocationReference>,
  options: InvocationContextOptions,
  stage: StageDefinition,
): void {
  const handoffPath = writeWorkerHandoff(
    options.root,
    options.state,
    stage.slug,
    options.invocationId,
  )

  if (handoffPath) {
    addReference(references, {
      path: handoffPath,
      description:
        'Handoff from the previous source-editing worker: its notes and the files and lines it read and edited',
      retrieval: 'required',
    })
  }
}

export function selectPriorAttempts(
  references: Map<string, InvocationReference>,
  root: string,
  state: RunState,
  stage: StageDefinition,
  attempt: number,
): void {
  const limit = stage.context.prior_attempts ?? 0

  if (limit === 0 || attempt <= 1) {
    return
  }

  const prior = [...state.stage_history]
    .reverse()
    .filter((item) => item.stage === stage.slug)
    .slice(0, limit)

  for (const item of prior) {
    addStageHistoryReference(
      references,
      item,
      `Prior ${stage.slug} attempt output (${item.outcome})`,
      'required',
    )

    // A supervisor-failed attempt looks successful in its own record; the
    // assessment is where the defects live, so a retry needs it in hand.
    const assessmentPath = resolveRunLayout(root, state.run_id).assessment(
      `${item.invocation_id}.assessment.json`,
    ).relative

    try {
      if (isRecord(readJson(resolveInside(root, assessmentPath)))) {
        addReference(references, {
          path: assessmentPath,
          description: `Supervisor assessment of prior ${stage.slug} attempt ${item.attempt}`,
          retrieval: 'required',
        })
      }
    } catch {
      // No assessment was recorded for this attempt.
    }
  }
}

export function selectOperatorFeedback(
  references: Map<string, InvocationReference>,
  state: RunState,
  stage: StageDefinition,
): void {
  const limit = stage.context.operator_feedback ?? 0
  const targeted = (state.operator_feedback ?? []).filter(
    (item) => item.to_stage === stage.slug,
  )

  const approvalDirectives = targeted.filter(
    (item) => item.decision === 'approve',
  )
  const remediationNotes =
    limit === 0
      ? []
      : targeted.filter((item) => item.decision !== 'approve').slice(-limit)
  const feedbackItems = [...approvalDirectives, ...remediationNotes].sort(
    (left, right) => left.timestamp.localeCompare(right.timestamp),
  )

  for (const feedback of feedbackItems) {
    const label =
      feedback.decision === 'set-stage'
        ? 'Operator stage repair'
        : feedback.decision === 'approve'
          ? 'Operator directive attached to approval'
          : 'Operator remediation feedback'

    addReference(references, {
      path: feedback.path,
      description: `${label} (${feedback.from_stage} → ${feedback.to_stage})`,
      retrieval: 'required',
    })
  }
}

export function selectExceptions(
  references: Map<string, InvocationReference>,
  state: RunState,
  stage: StageDefinition,
  workspaceFingerprint: string,
): void {
  for (const waiver of activeOperatorGateWaivers(state, workspaceFingerprint)) {
    addReference(references, {
      path: waiver.artifact_path,
      description: `Active operator gate waiver for ${waiver.stage}`,
      retrieval: 'required',
    })

    if (waiver.spotfix_case_path) {
      addReference(references, {
        path: waiver.spotfix_case_path,
        description: 'Open deferred spotfix case linked to an active waiver',
        retrieval: 'required',
      })
    }
  }

  if (stage.slug === 'ship' && state.governance_artifact_issues_path) {
    addReference(references, {
      path: state.governance_artifact_issues_path,
      description:
        'Governance and artifact diagnostics to review, repair when safe, and escalate only when materially concerning',
      retrieval: 'required',
    })
  }

  if (stage.context.include_workspace_ratifications) {
    const ratification = [...(state.operator_workspace_ratifications ?? [])]
      .reverse()
      .find((item) => item.workspace_fingerprint === workspaceFingerprint)

    if (ratification) {
      addReference(references, {
        path: ratification.artifact_path,
        description: `Current workspace ratification for ${ratification.stage}`,
        retrieval: 'required',
      })
    }
  }
}

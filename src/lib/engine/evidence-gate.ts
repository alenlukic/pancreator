/**
 * The evidence gate: a verify stage's consolidating worker runs only when
 * every declared evidence report states `pass`.
 *
 * Operator directive of 2026-10-18: "verifier should only run if reviewer
 * (and QA when applicable) already both report success." A verifier launched
 * over a failing report can only consolidate that failure, so the harness
 * records the failure itself, cites the reports as the failure record, and
 * routes the stage along its declared failure transition.
 */

import { invariant } from '../errors.js'
import { resolveInside, withOperationMutex, writeJsonAtomic } from '../io.js'
import { completeInvocationAgent } from '../hypervisor.js'
import { runHasContract } from '../operator-involvement.js'
import { loadState, now, operationMutexPath } from '../state.js'
import type { StageHistoryItem } from '../types.js'
import { evidenceGatePath } from '../watch/paths.js'
import { stageBySlug } from '../workflow.js'

import { loadRunWorkflow, persistRun, readInvocation } from './core.js'
import { routeLadderedFailure } from './failure-route.js'
import { isSameReasonTrackedStage } from './limits.js'
import { applyTransition } from './transition.js'

export const EVIDENCE_GATE_STALE = 'EVIDENCE_GATE_STALE'

/** One evidence role's newest report, as the gate judged it. */
export interface EvidenceGateRole {
  role: string
  attempt: number
  path: string
  verdict: 'pass' | 'fail' | null
}

export interface EvidenceGateResult {
  /** Harness-relative failure record that stands in for the stage output. */
  output_path: string
  /** Roles whose report did not state pass. */
  failing_roles: string[]
  /** The stage the run moved to, or the run status when it did not move. */
  next_state: string | null
}

function verdictLabel(role: EvidenceGateRole): string {
  return role.verdict ?? 'no verdict'
}

/**
 * Records a failed outcome for the current invocation on behalf of its
 * stage worker, which never launches, and routes the run along the stage's
 * failure transition through the same failure ladder a submission climbs.
 * Throws `EVIDENCE_GATE_STALE` when the invocation is no longer current, so a
 * late watch cannot move a run that already left the stage.
 */
export function recordEvidenceGateFailure(
  root: string,
  runId: string,
  invocationId: string,
  roles: EvidenceGateRole[],
): EvidenceGateResult {
  const failing = roles.filter((role) => role.verdict !== 'pass')

  invariant(
    failing.length > 0,
    'The evidence gate records a failure only when a report does not pass.',
    { code: 'EVIDENCE_GATE_NOT_FAILED' },
  )

  const result = withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)
    const current = state.current_invocation

    invariant(
      current?.id === invocationId && state.current_stage,
      `Invocation ${invocationId} is no longer current for run ${runId}, ` +
        'so the evidence gate cannot record its outcome.',
      { code: EVIDENCE_GATE_STALE },
    )

    const invocation = readInvocation(root, current.json_path)
    const workflow = loadRunWorkflow(root, state)
    const stage = stageBySlug(workflow, state.current_stage as string)
    const outputPath = evidenceGatePath(root, runId, invocationId)
    const summary =
      'Verifier skipped: ' +
      failing
        .map((role) => `${role.role} reported ${verdictLabel(role)}`)
        .join('; ') +
      '. Every evidence report must state pass before the consolidating ' +
      'worker runs, so the harness recorded this failure from the reports.'

    writeJsonAtomic(resolveInside(root, outputPath), {
      $operator: {
        headline: `${stage.title} failed at the evidence gate`,
        status: 'failure',
        next_action:
          'Remediate every failure the cited evidence reports record.',
      },
      schema_version: 1,
      invocation_id: invocationId,
      result: 'failure',
      summary,
      artifacts: roles.map((role) => ({
        path: role.path,
        description:
          `${role.role} evidence report, attempt ${role.attempt} ` +
          `(verdict: ${verdictLabel(role)})`,
      })),
      criteria: [],
      data: {
        verify: {
          verdict: 'fail_remedial',
          findings: failing.map((role) => ({
            id: `evidence-gate-${role.role}`,
            source: role.role,
            severity: 'blocker',
            statement:
              `The ${role.role} evidence report stated ` +
              `${verdictLabel(role)}; its findings are the failure record.`,
            evidence: [role.path],
          })),
          acceptance_results: [],
          gate_evidence_citations: [],
          evidence_packet: {},
          remediation_guidance:
            'Read each cited evidence report and repair every blocker ' +
            'finding, failed acceptance criterion, and failed case it ' +
            'records. The verifier did not run.',
          evidence_gate: { roles },
        },
      },
      risks: [],
      unknowns: [],
    })

    const historyItem: StageHistoryItem = {
      stage: stage.slug,
      attempt: invocation.attempt,
      invocation_id: invocationId,
      output_path: outputPath,
      outcome: 'failure',
      submitted_at: now(),
      workspace_fingerprint: invocation.workspace_before.fingerprint,
      workspace_before_fingerprint: invocation.workspace_before.fingerprint,
      validation_errors: [],
      deterministic: [],
      self_criteria: [],
    }

    state.stage_history.push(historyItem)

    const laddered =
      runHasContract(state.operator_involvement, 'long_horizon') ||
      isSameReasonTrackedStage(stage)
        ? routeLadderedFailure(
            root,
            state,
            stage,
            failing.map((role) => `evidence_gate:${role.role}`),
          )
        : null
    let nextState: string | null

    if (laddered) {
      nextState = laddered.nextState
    } else if (stage.gate === 'operator') {
      state.pending_action = {
        type: 'operator_approval',
        stage: stage.slug,
        outcome: 'failure',
        proposed_transition: stage.transitions.failure,
      }
      state.status = 'awaiting_operator'
      nextState = 'awaiting operator approval'
    } else {
      applyTransition(root, state, stage, 'failure')
      nextState =
        state.status === 'running' ? state.current_stage : state.status
    }

    persistRun(root, state, 'evidence_gate_failed', {
      stage: stage.slug,
      invocation_id: invocationId,
      failing_roles: failing.map((role) => role.role),
      output_path: outputPath,
      next_state: nextState,
    })

    return {
      output_path: outputPath,
      failing_roles: failing.map((role) => role.role),
      next_state: nextState,
    }
  })

  completeInvocationAgent(root, runId, invocationId)

  return result
}

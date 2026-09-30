/** Stage history references and the stage outputs an invocation reads. */

import type {
  RunState,
  StageContextStageSelector,
  StageHistoryItem,
  InvocationReference,
} from '../types.js'
import { addReference, type AvailableReference } from './references.js'

function latestStageHistory(
  state: RunState,
  selector: StageContextStageSelector,
): StageHistoryItem | undefined {
  return [...state.stage_history].reverse().find((item) => {
    if (item.stage !== selector.stage) {
      return false
    }

    return selector.selection === 'latest' || item.outcome === 'success'
  })
}

function stageOutputDescription(
  item: StageHistoryItem,
  selector: StageContextStageSelector,
): string {
  const effective = selector.selection === 'latest_success' ? 'Effective ' : ''

  return `${effective}${item.stage} stage output (${item.outcome})`
}

/**
 * Adds one stage-history attempt's output as a reference with the given
 * retrieval mode, plus its execution record, when it has one, as a conditional
 * provenance reference.
 */
export function addStageHistoryReference(
  references: Map<string, InvocationReference>,
  item: StageHistoryItem,
  description: string,
  retrieval: 'required' | 'conditional',
  condition?: string,
): void {
  addReference(references, {
    path: item.output_path,
    description,
    retrieval,
    ...(condition ? { condition } : {}),
  })

  if (!item.record_path) {
    return
  }

  addReference(references, {
    path: item.record_path,
    description: `Execution provenance for ${item.stage} attempt ${item.attempt}`,
    retrieval: 'conditional',
    condition:
      'Read only to verify provenance, deterministic evidence, or resolve an inconsistency in the stage output.',
  })
}

/**
 * Lists every context record a run holds, each tagged with a category and
 * deduplicated by path: the original request, every stage output and execution
 * record, operator feedback, gate waivers and their spotfix cases, workspace
 * ratifications, governance issues, and repository-check baselines. The context
 * manifest reports the ones an invocation did not select from this list.
 */
export function availableReferences(state: RunState): AvailableReference[] {
  const references: AvailableReference[] = [
    {
      path: state.request.stored_path,
      description: 'Original operator request',
      retrieval: 'required',
      category: 'request',
    },
  ]

  for (const item of state.stage_history) {
    references.push({
      path: item.output_path,
      description: `${item.stage} stage output (${item.outcome})`,
      retrieval: 'conditional',
      category: 'stage_output',
    })

    if (item.record_path) {
      references.push({
        path: item.record_path,
        description: `${item.stage} execution record JSON`,
        retrieval: 'conditional',
        category: 'execution_record',
      })
    }
  }

  for (const feedback of state.operator_feedback ?? []) {
    const label =
      feedback.decision === 'set-stage'
        ? 'Operator stage repair'
        : feedback.decision === 'approve'
          ? 'Operator directive attached to approval'
          : 'Operator remediation feedback'

    references.push({
      path: feedback.path,
      description: `${label} (${feedback.from_stage} → ${feedback.to_stage})`,
      retrieval: 'conditional',
      category: 'operator_feedback',
    })
  }

  for (const waiver of state.operator_gate_waivers ?? []) {
    references.push({
      path: waiver.artifact_path,
      description: `Operator gate waiver for ${waiver.stage}`,
      retrieval: 'conditional',
      category: 'gate_waiver',
    })

    if (waiver.spotfix_case_path) {
      references.push({
        path: waiver.spotfix_case_path,
        description: 'Deferred spotfix case linked to an operator waiver',
        retrieval: 'conditional',
        category: 'follow_up_case',
      })
    }
  }

  for (const ratification of state.operator_workspace_ratifications ?? []) {
    references.push({
      path: ratification.artifact_path,
      description: `Operator-paused workspace ratification for ${ratification.stage}`,
      retrieval: 'conditional',
      category: 'workspace_ratification',
    })
  }

  if (state.governance_artifact_issues_path) {
    references.push({
      path: state.governance_artifact_issues_path,
      description: 'Accumulated governance and artifact diagnostics',
      retrieval: 'conditional',
      category: 'governance_artifact_issues',
    })
  }

  for (const baseline of Object.values(
    state.repository_check_baselines ?? {},
  )) {
    if (!baseline) {
      continue
    }

    references.push({
      path: baseline.artifact_path,
      description: `Pre-implementation repository-check baseline for ${baseline.profile}`,
      retrieval: 'conditional',
      category: 'repository_check_baseline',
    })
  }

  return references.filter(
    (reference, index, all) =>
      all.findIndex((candidate) => candidate.path === reference.path) === index,
  )
}

/**
 * Adds the stage output each selector names (the latest attempt, or the latest
 * successful one) with the given retrieval mode. A required selector with no
 * matching output is appended to `missingRequired`, except the implement output
 * of a cohort release run, which never runs implement.
 */
export function selectStageOutputs(
  references: Map<string, InvocationReference>,
  missingRequired: string[],
  state: RunState,
  selectors: StageContextStageSelector[] | undefined,
  retrieval: 'required' | 'conditional',
): void {
  for (const selector of selectors ?? []) {
    const item = latestStageHistory(state, selector)

    if (!item) {
      // A release run starts at verify and never ran implement: its
      // implementation record is the chunk runs `selectReleaseEvidence` lists,
      // so the absent output is not missing context.
      if (
        retrieval === 'required' &&
        !(state.cohort?.role === 'release' && selector.stage === 'implement')
      ) {
        missingRequired.push(
          `${selector.selection.replace('_', ' ')} output for stage '${selector.stage}'`,
        )
      }
      continue
    }

    addStageHistoryReference(
      references,
      item,
      stageOutputDescription(item, selector),
      retrieval,
      retrieval === 'conditional'
        ? 'Read only when the required inputs do not resolve the current stage question or when this record contains unresolved remediation evidence.'
        : undefined,
    )
  }
}

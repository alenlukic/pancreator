import path from 'node:path'

import { writeJsonAtomic } from './io.js'
import { isSelfDevelopmentInstallation } from './project-config.js'
import { activeOperatorGateWaivers } from './waivers.js'
import type {
  Invocation,
  InvocationReference,
  InvocationReferenceRetrieval,
  RunState,
  StageContextStageSelector,
  StageDefinition,
  StageHistoryItem,
} from './types.js'

interface AvailableReference extends InvocationReference {
  category: string
}

interface InvocationContextOptions {
  root: string
  state: RunState
  stage: StageDefinition
  attempt: number
  invocationId: string
  workspaceFingerprint: string
}

interface ContextManifest {
  schema_version: 1
  invocation_id: string
  stage: string
  generated_at: string
  selected: InvocationReference[]
  omitted: AvailableReference[]
  missing_required: string[]
}

const RETRIEVAL_PRIORITY: Record<InvocationReferenceRetrieval, number> = {
  index_only: 0,
  conditional: 1,
  required: 2,
}

function normalizedRetrieval(
  reference: InvocationReference,
): InvocationReferenceRetrieval {
  return reference.retrieval ?? 'required'
}

function addReference(
  references: Map<string, InvocationReference>,
  reference: InvocationReference,
): void {
  const existing = references.get(reference.path)

  if (!existing) {
    references.set(reference.path, reference)
    return
  }

  const existingPriority = RETRIEVAL_PRIORITY[normalizedRetrieval(existing)]
  const candidatePriority = RETRIEVAL_PRIORITY[normalizedRetrieval(reference)]

  if (candidatePriority > existingPriority) {
    references.set(reference.path, reference)
  }
}

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

function addStageHistoryReference(
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

function availableReferences(state: RunState): AvailableReference[] {
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

  if (state.latest_ledger_validation_path) {
    references.push({
      path: state.latest_ledger_validation_path,
      description:
        'Latest workspace-change validation result (legacy path name)',
      retrieval: 'conditional',
      category: 'ledger_validation',
    })
  }

  return references.filter(
    (reference, index, all) =>
      all.findIndex((candidate) => candidate.path === reference.path) === index,
  )
}

function selectStageOutputs(
  references: Map<string, InvocationReference>,
  missingRequired: string[],
  state: RunState,
  selectors: StageContextStageSelector[] | undefined,
  retrieval: 'required' | 'conditional',
): void {
  for (const selector of selectors ?? []) {
    const item = latestStageHistory(state, selector)

    if (!item) {
      if (retrieval === 'required') {
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

function selectPriorAttempts(
  references: Map<string, InvocationReference>,
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
  }
}

function selectOperatorFeedback(
  references: Map<string, InvocationReference>,
  state: RunState,
  stage: StageDefinition,
): void {
  const limit = stage.context.operator_feedback ?? 0

  if (limit === 0) {
    return
  }

  const feedbackItems = [...(state.operator_feedback ?? [])]
    .reverse()
    .filter((item) => item.to_stage === stage.slug)
    .slice(0, limit)

  for (const feedback of feedbackItems) {
    const label =
      feedback.decision === 'set-stage'
        ? 'Operator stage repair'
        : 'Operator remediation feedback'

    addReference(references, {
      path: feedback.path,
      description: `${label} (${feedback.from_stage} → ${feedback.to_stage})`,
      retrieval: 'required',
    })
  }
}

function selectExceptions(
  references: Map<string, InvocationReference>,
  state: RunState,
  stage: StageDefinition,
  workspaceFingerprint: string,
): void {
  if (stage.context.include_active_waivers) {
    for (const waiver of activeOperatorGateWaivers(
      state,
      workspaceFingerprint,
    )) {
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

  if (
    stage.context.include_latest_ledger_validation &&
    state.latest_ledger_validation_path
  ) {
    addReference(references, {
      path: state.latest_ledger_validation_path,
      description: `Latest validate-changes result (${state.latest_ledger_validation ?? 'unknown'})`,
      retrieval: 'required',
    })
  }
}

function writeContextManifest(
  options: InvocationContextOptions,
  selected: InvocationReference[],
  omitted: AvailableReference[],
  missingRequired: string[],
): InvocationReference | null {
  if (omitted.length === 0 && missingRequired.length === 0) {
    return null
  }

  const relativePath =
    `runtime/logs/workflows/${options.state.run_id}/invocations/` +
    `${options.invocationId}.context-manifest.json`
  const manifest: ContextManifest = {
    schema_version: 1,
    invocation_id: options.invocationId,
    stage: options.stage.slug,
    generated_at: new Date().toISOString(),
    selected,
    omitted,
    missing_required: missingRequired,
  }

  writeJsonAtomic(path.join(options.root, relativePath), manifest)

  return {
    path: relativePath,
    description:
      'Complete workflow context index, including omitted and superseded records',
    retrieval: 'index_only',
    condition:
      'Do not expand merely because it is listed. Read only to resolve a named inconsistency, missing disposition, provenance question, or missing required input.',
  }
}

/** Build a stage-scoped context projection and a discoverable full-history index. */
export function buildInvocationInputs(
  options: InvocationContextOptions,
): Invocation['inputs'] {
  const references = new Map<string, InvocationReference>()
  const missingRequired: string[] = []
  const { state, stage } = options

  if (stage.context.legacy_full_history) {
    return {
      references: availableReferences(state).map((reference) => ({
        path: reference.path,
        description: reference.description,
        retrieval: 'required',
      })),
    }
  }

  if (stage.context.request !== 'omit') {
    addReference(references, {
      path: state.request.stored_path,
      description: 'Original operator request',
      retrieval: stage.context.request,
      ...(stage.context.request === 'conditional'
        ? {
            condition:
              'Read only when the effective stage outputs do not preserve enough operator intent for this task.',
          }
        : {}),
    })
  }

  selectStageOutputs(
    references,
    missingRequired,
    state,
    stage.context.required_stage_outputs,
    'required',
  )
  selectStageOutputs(
    references,
    missingRequired,
    state,
    stage.context.conditional_stage_outputs,
    'conditional',
  )
  selectPriorAttempts(references, state, stage, options.attempt)
  selectOperatorFeedback(references, state, stage)
  selectExceptions(references, state, stage, options.workspaceFingerprint)

  if (
    stage.persona === 'release-steward' &&
    stage.slug === 'ship' &&
    isSelfDevelopmentInstallation(options.root)
  ) {
    addReference(references, {
      path: 'VERSION',
      description: 'Current Pancreator harness version',
      retrieval: 'required',
    })
    addReference(references, {
      path: 'release/index.json',
      description: 'Internal Pancreator release-to-commit index',
      retrieval: 'required',
    })
  }

  const selected = [...references.values()]
  const selectedPaths = new Set(selected.map((reference) => reference.path))
  const omitted = availableReferences(state).filter(
    (reference) => !selectedPaths.has(reference.path),
  )
  const manifestReference = writeContextManifest(
    options,
    selected,
    omitted,
    missingRequired,
  )

  if (manifestReference) {
    addReference(references, manifestReference)
  }

  return {
    references: [...references.values()],
    ...(missingRequired.length > 0
      ? { missing_required: missingRequired }
      : {}),
  }
}

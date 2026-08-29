import path from 'node:path'

import { snapshotEntryPath } from './git.js'
import { isRecord, readJson, resolveInside, writeJsonAtomic } from './io.js'
import { isSelfDevelopmentInstallation } from './project-config.js'
import { repositoryCheckProfileName } from './repository-checks.js'
import { resolveRunLayout } from './run-layout.js'
import { resolveTargetInstructionPaths } from './target-instructions.js'
import { activeOperatorGateWaivers } from './waivers.js'
import type {
  Invocation,
  InvocationReference,
  InvocationReferenceRetrieval,
  PrDescriptionContext,
  PriorAttemptFailure,
  RunState,
  StageContextStageSelector,
  StageDefinition,
  StageHistoryItem,
  TargetInstructionInput,
  WorkspaceSnapshot,
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
  workspace?: WorkspaceSnapshot
  prDescription?: PrDescriptionContext
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

function selectOperatorFeedback(
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

function selectExceptions(
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

interface PassedGateEvidence {
  profile: string
  evidencePath: string
  fingerprint: string
  origin: string
}

/**
 * The latest passed run of each repository-check profile, from stage-history
 * gates first and pre-implementation baselines second. A skipped, disabled, or
 * failed gate is not evidence.
 */
export function passedGateEvidence(state: RunState): PassedGateEvidence[] {
  const byProfile = new Map<string, PassedGateEvidence>()

  for (const item of state.stage_history) {
    for (const result of item.deterministic) {
      const profile = repositoryCheckProfileName(result.command ?? '')
      const executed =
        result.passed &&
        !result.skipped &&
        !result.disabled &&
        !result.overridden

      if (!profile || !executed || !result.evidence_path) {
        continue
      }

      byProfile.set(profile, {
        profile,
        evidencePath: result.evidence_path,
        fingerprint: result.workspace_fingerprint,
        origin: `${item.stage} attempt ${item.attempt} gate \`${result.id}\``,
      })
    }
  }

  for (const baseline of Object.values(
    state.repository_check_baselines ?? {},
  )) {
    if (!baseline || baseline.status !== 'passed') {
      continue
    }

    if (!byProfile.has(baseline.profile)) {
      byProfile.set(baseline.profile, {
        profile: baseline.profile,
        evidencePath: baseline.artifact_path,
        fingerprint: baseline.workspace_fingerprint,
        origin: 'pre-implementation baseline',
      })
    }
  }

  return [...byProfile.values()]
}

function selectGateEvidence(
  references: Map<string, InvocationReference>,
  state: RunState,
  stage: StageDefinition,
  workspaceFingerprint: string,
): void {
  if (!stage.context.gate_evidence) {
    return
  }

  for (const evidence of passedGateEvidence(state)) {
    const current = evidence.fingerprint === workspaceFingerprint
    const currency = current
      ? 'the current workspace'
      : 'a superseded workspace'

    // A superseded artifact stays listed, but its condition denies citation.
    addReference(references, {
      path: evidence.evidencePath,
      description:
        `Passed \`${evidence.profile}\` repository-check gate evidence ` +
        `(${evidence.origin}) at workspace fingerprint ` +
        `\`${evidence.fingerprint}\` — ${currency}`,
      retrieval: 'conditional',
      condition: current
        ? `Cite this evidence in \`data.verify.gate_evidence_citations\` with ` +
          `profile \`${evidence.profile}\`, fingerprint \`${evidence.fingerprint}\`, ` +
          'and this path. Do not run the profile agent-side. Read the ' +
          'evidence only to confirm what the gate covered.'
        : `This evidence predates the current workspace fingerprint ` +
          `\`${workspaceFingerprint}\`. Do not cite it as current. Do not ` +
          `run the \`${evidence.profile}\` profile yourself. The verify ` +
          'submission gate is the single path that runs the profile the ' +
          'level assigns to it. Record the gap in your verify output.',
      gate_evidence: {
        profile: evidence.profile,
        fingerprint: evidence.fingerprint,
        current,
      },
    })
  }
}

function outputChangedPaths(
  root: string,
  state: RunState,
  stageSlug: string,
): string[] {
  const outputPath = [...state.stage_history]
    .reverse()
    .find(
      (item) => item.stage === stageSlug && item.outcome === 'success',
    )?.output_path

  if (!outputPath) {
    return []
  }

  const value = readJson(resolveInside(root, outputPath))
  const data = isRecord(value) && isRecord(value.data) ? value.data : null

  if (!data) {
    return []
  }

  if (stageSlug === 'plan') {
    const plan = isRecord(data.engineering_plan) ? data.engineering_plan : null
    const files = plan && Array.isArray(plan.files) ? plan.files : []

    return files.flatMap((item) =>
      isRecord(item) && typeof item.path === 'string' ? [item.path] : [],
    )
  }

  const implementation = isRecord(data.implementation)
    ? data.implementation
    : null
  const files =
    implementation && Array.isArray(implementation.changed_files)
      ? implementation.changed_files
      : []

  return files.filter((item): item is string => typeof item === 'string')
}

function targetInstructionInput(
  options: InvocationContextOptions,
): TargetInstructionInput | undefined {
  const { root, state, stage, workspace } = options

  const editingStages = ['implement', 'consolidate', 'remediate']

  if (![...editingStages, 'review', 'test', 'verify'].includes(stage.slug)) {
    return undefined
  }

  const sourceStage =
    state.workflow_slug === 'metacritic' ? 'consolidate' : 'implement'
  const declared = editingStages.includes(stage.slug)
    ? outputChangedPaths(root, state, 'plan')
    : outputChangedPaths(root, state, sourceStage)
  const current = editingStages.includes(stage.slug)
    ? []
    : (workspace?.entries ?? []).map((entry) => snapshotEntryPath(entry))
  const changedPaths = [...new Set([...declared, ...current])].sort()
  const workspaceRoot = path.resolve(root, state.workspace_root || '.')
  const readPaths = resolveTargetInstructionPaths(workspaceRoot, changedPaths)

  return { changed_paths: changedPaths, read_paths: readPaths }
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

  const relativePath = resolveRunLayout(
    options.root,
    options.state.run_id,
  ).invocation(options.invocationId, '.context-manifest.json').relative
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
/**
 * Summarize the most recent failed attempt of `stage` for inline rendering on the
 * retry card. Returns null when the previous attempt succeeded or none exists.
 */
export function summarizePriorFailure(
  state: RunState,
  stage: StageDefinition,
  root?: string,
): PriorAttemptFailure | null {
  const previous = [...state.stage_history]
    .reverse()
    .find((item) => item.stage === stage.slug)

  if (!previous) {
    return null
  }

  // A supervisor-gated stage records the submission as `success` and fails at
  // the assessment instead, so the retry card previously carried no reason at
  // all: the worker was left to re-guess what the supervisor rejected. Fold
  // the failing assessment into the prior-failure block.
  const supervisorAssessment =
    root === undefined
      ? null
      : failedSupervisorAssessment(root, state, previous)

  if (previous.outcome === 'success' && !supervisorAssessment) {
    return null
  }

  const hardCriteria = new Map(
    stage.criteria
      .filter((criterion) => criterion.hard)
      .map((criterion) => [criterion.id, criterion]),
  )
  const failedHardCriteria = (previous.self_criteria ?? [])
    .filter(
      (evaluation) =>
        evaluation.result !== 'pass' && hardCriteria.has(evaluation.id),
    )
    .map((evaluation) => {
      const criterion = hardCriteria.get(evaluation.id)

      return {
        id: evaluation.id,
        type: criterion?.type ?? 'judgment',
        statement: criterion?.statement ?? '',
        explanation: evaluation.explanation,
      }
    })
  const failedDeterministic = previous.deterministic
    .filter((item) => !item.passed && !item.disabled)
    .map((item) => ({
      id: item.id,
      ...(item.command ? { command: item.command } : {}),
      ...(item.exit_code !== undefined ? { exit_code: item.exit_code } : {}),
      ...(item.timed_out ? { timed_out: item.timed_out } : {}),
      ...(item.evidence_path ? { evidence_path: item.evidence_path } : {}),
    }))

  return {
    stage: previous.stage,
    attempt: previous.attempt,
    invocation_id: previous.invocation_id,
    outcome: previous.outcome,
    output_path: previous.output_path,
    failed_hard_criteria: failedHardCriteria,
    failed_deterministic: failedDeterministic,
    validation_errors: previous.validation_errors,
    governance_artifact_warnings: previous.governance_artifact_warnings ?? [],
    ...(supervisorAssessment
      ? { supervisor_assessment: supervisorAssessment }
      : {}),
  }
}

/**
 * The failing supervisor assessment for a stage-history item, when one exists
 * on disk. Returns null for passing assessments and unreadable artifacts.
 */
function failedSupervisorAssessment(
  root: string,
  state: RunState,
  item: StageHistoryItem,
): PriorAttemptFailure['supervisor_assessment'] | null {
  const assessmentPath = resolveRunLayout(root, state.run_id).assessment(
    `${item.invocation_id}.assessment.json`,
  ).relative

  let value: unknown

  try {
    value = readJson(resolveInside(root, assessmentPath))
  } catch {
    return null
  }

  if (!isRecord(value) || value.verdict === 'pass') {
    return null
  }

  return {
    verdict: typeof value.verdict === 'string' ? value.verdict : 'fail',
    summary: typeof value.summary === 'string' ? value.summary : '',
    action_items: Array.isArray(value.action_items)
      ? value.action_items.filter(
          (entry): entry is string => typeof entry === 'string',
        )
      : [],
  }
}

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
  selectPriorAttempts(references, options.root, state, stage, options.attempt)
  selectOperatorFeedback(references, state, stage)
  selectExceptions(references, state, stage, options.workspaceFingerprint)
  selectGateEvidence(references, state, stage, options.workspaceFingerprint)
  const targetInstructions = targetInstructionInput(options)

  for (const instructionPath of targetInstructions?.read_paths ?? []) {
    addReference(references, {
      path: instructionPath,
      description:
        'Target instruction file resolved from declared changed paths',
      retrieval: 'required',
    })
  }

  if (options.prDescription?.template_path) {
    addReference(references, {
      path: options.prDescription.template_path,
      description: 'Resolved target pull-request template',
      retrieval: 'required',
    })
  }

  for (const instructionPath of options.prDescription?.instruction_paths ??
    []) {
    addReference(references, {
      path: instructionPath,
      description: 'Resolved target pull-request instruction file',
      retrieval: 'required',
    })
  }

  if (stage.persona === 'coder') {
    for (const baseline of Object.values(
      state.repository_check_baselines ?? {},
    )) {
      if (!baseline) {
        continue
      }

      addReference(references, {
        path: baseline.artifact_path,
        description:
          `Required pre-implementation ${baseline.profile} check baseline ` +
          `(${baseline.status})`,
        retrieval: 'required',
      })
    }
  }

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
    ...(targetInstructions ? { target_instructions: targetInstructions } : {}),
    ...(options.prDescription ? { pr_description: options.prDescription } : {}),
  }
}

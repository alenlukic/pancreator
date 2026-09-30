/**
 * Operator gate waivers.
 */

import { randomUUID } from 'node:crypto'

import { invariant } from '../errors.js'
import {
  fileExists,
  readJson,
  resolveInside,
  withOperationMutex,
  writeTextAtomic,
} from '../io.js'
import { queueInboxRelativePath } from '../inbox.js'
import { resolveRunLayout } from '../run-layout.js'
import { operationMutexPath, loadState, now } from '../state.js'
import type {
  EntryGateReach,
  OperatorGateWaiver,
  RunActionActor,
  RunState,
  StageDefinition,
  StageHistoryItem,
  SupervisorAssessment,
  TaskRecord,
  WorktreeClaimTransfer,
} from '../types.js'
import { stageBySlug } from '../workflow.js'
import { waiverCoversCriterion } from '../waivers.js'

import {
  loadRunWorkflow,
  parseSupervisorAssessment,
  persistRun,
  readTaskRecord,
  workspaceSnapshotForRun,
} from './core.js'
import { clearSameReasonTracker } from './limits.js'
import { applyTransition } from './transition.js'
import { entryGateSatisfied } from './entry-gate.js'

export interface WaiveGateOptions {
  stageSlug?: string | null
  targetStage?: string | null
  criterionIds?: string[]
  note: string
  deferredAcceptanceCriteria?: string[]
  createSpotfixCase?: boolean
  /**
   * Run whose ratified plan this waiver adopts. The subsumed run keeps
   * running, so its worktree claim moves to the adopting run and both states
   * record the move.
   */
  adoptPlanFromRunId?: string | null
  /**
   * Who authored the directive. Away mode may waive a gate under
   * `AWAY-001`, and that waiver MUST NOT be recorded as the operator's.
   */
  actor?: RunActionActor
}

/**
 * Move the subsumed run's worktree claim to the run that adopted its plan.
 *
 * The subsumed run stays live because nothing closed it, so liveness alone
 * would keep it occupying the worktree and release preparation for the
 * adopting run would refuse. Both states record the move, and the subsumed
 * run's write takes its own mutex.
 */
function transferWorktreeClaim(
  root: string,
  adoptingState: RunState,
  subsumedRunId: string,
  waiverId: string,
): WorktreeClaimTransfer {
  invariant(
    subsumedRunId !== adoptingState.run_id,
    'A run cannot adopt its own plan.',
    { code: 'INVALID_PLAN_ADOPTION' },
  )

  const worktree = adoptingState.managed_worktree?.name

  invariant(
    worktree,
    `Run '${adoptingState.run_id}' is not bound to a managed worktree, so ` +
      'there is no worktree claim to transfer.',
    { code: 'INVALID_PLAN_ADOPTION' },
  )

  const transfer: WorktreeClaimTransfer = {
    role: 'adopted',
    worktree,
    from_run_id: subsumedRunId,
    to_run_id: adoptingState.run_id,
    waiver_id: waiverId,
    timestamp: now(),
  }

  withOperationMutex(operationMutexPath(root, subsumedRunId), () => {
    const subsumed = loadState(root, subsumedRunId)

    invariant(
      subsumed.managed_worktree?.name === worktree,
      `Run '${subsumedRunId}' is not bound to worktree '${worktree}', so it ` +
        'holds no claim the adopting run can take.',
      { code: 'INVALID_PLAN_ADOPTION' },
    )

    subsumed.worktree_claim_transfer = { ...transfer, role: 'released' }
    persistRun(root, subsumed, 'worktree_claim_released', {
      worktree,
      to_run_id: adoptingState.run_id,
      waiver_id: waiverId,
    })
  })

  adoptingState.worktree_claim_transfer = transfer

  return transfer
}

function normalizeIdentifiers(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))].sort()
}

function failedHardCriteria(
  stage: StageDefinition,
  record: TaskRecord,
  assessment: SupervisorAssessment | null = null,
): string[] {
  const self = new Map(
    (assessment?.criteria ?? record.evaluation.self).map((item) => [
      item.id,
      item,
    ]),
  )
  const deterministic = new Map(
    record.evaluation.deterministic.map((item) => [item.id, item]),
  )

  const declared = stage.criteria
    .filter((criterion) => {
      if (!criterion.hard) {
        return false
      }

      if (criterion.type === 'judgment') {
        return self.get(criterion.id)?.result === 'fail'
      }

      const result = deterministic.get(criterion.id)

      return result?.passed === false && !result.disabled
    })
    .map((criterion) => criterion.id)

  // A criterion the harness synthesizes, such as the scope criterion, never
  // appears in the stage file. Inferring blockers from the declared list alone
  // therefore returned nothing when one of those was the only failure, and the
  // caller widened the waiver to the whole stage.
  const declaredIds = new Set(stage.criteria.map((criterion) => criterion.id))
  const synthesized = record.evaluation.deterministic
    .filter(
      (result) =>
        !declaredIds.has(result.id) &&
        result.hard &&
        result.passed === false &&
        !result.disabled,
    )
    .map((result) => result.id)

  return [...declared, ...synthesized].sort()
}

function writeSpotfixCase(
  root: string,
  state: RunState,
  waiverId: string,
  stage: StageDefinition,
  history: StageHistoryItem,
  criterionIds: string[],
  acceptanceCriteria: string[],
  note: string,
  sourceEvidencePath: string,
): string {
  const timestamp = now().replaceAll(/[-:.]/gu, '')
  const relativePath = queueInboxRelativePath(
    `spotfix-case-${timestamp}-${state.run_id.slice(-8)}-${stage.slug}.md`,
  )
  const body = [
    '# Deferred spotfix case',
    '',
    `**Source run** \`${state.run_id}\` · **Waiver** \`${waiverId}\` · ` +
      `**Stage** \`${stage.slug}\` · **Attempt** ${history.attempt}`,
    '',
    '## Status',
    '',
    'open — lightweight eligibility MUST be re-verified under `WORK-001` before editing.',
    '',
    '## Deferred acceptance criteria',
    '',
    ...acceptanceCriteria.map((item) => `- \`${item}\``),
    '',
    '## Waived gate criteria',
    '',
    ...criterionIds.map((item) => `- \`${item}\``),
    '',
    '## Operator rationale and bounded scope',
    '',
    note.trim(),
    '',
    '## Evidence',
    '',
    `- Gate evidence: \`${sourceEvidencePath}\``,
    `- Stage output: \`${history.output_path}\``,
    ...(history.record_path
      ? [`- Execution record: \`${history.record_path}\``]
      : []),
    `- Workspace fingerprint: \`${history.workspace_fingerprint}\``,
    '',
    '## Required next action',
    '',
    'Run `/pan-spotfix` with this file as the preserved input only when the remaining work is still one coherent bounded change. Otherwise route it through the systematic workflow.',
    '',
  ].join('\n')

  writeTextAtomic(resolveInside(root, relativePath), `${body}\n`)

  return relativePath
}

/**
 * True when a lowercased waiver note names `token` as a word of its own.
 *
 * A bare substring test accepted `ship` inside `relationship`, `ownership`,
 * and `shipping`, so a note that never mentioned the jump satisfied the
 * confirmation the guard exists to demand.
 */
function noteNamesToken(noteBody: string, token: string): boolean {
  const escaped = token.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')

  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'u').test(noteBody)
}

/**
 * Record an explicit operator directive that bypasses a stage or gate and route
 * the run according to the operator's stated terms. The directive is audited,
 * but governance does not narrow the operator's authority.
 */
export function waiveGate(
  root: string,
  runId: string,
  options: WaiveGateOptions,
): {
  state: RunState
  waiver: OperatorGateWaiver
  /**
   * The waived stage's own entry gate when this directive covers it. A waiver
   * names one stage, so this holds at most one element.
   */
  entry_gates_reached: EntryGateReach[]
  claimTransfer?: WorktreeClaimTransfer
} {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(
      options.note.trim().length > 0,
      'Waiver note MUST be non-empty.',
      { code: 'WAIVER_NOTE_REQUIRED' },
    )

    const workflow = loadRunWorkflow(root, state)
    const stageSlug =
      options.stageSlug ??
      state.current_stage ??
      [...state.stage_history]
        .reverse()
        .find((item) => item.outcome !== 'success')?.stage

    invariant(stageSlug, 'Run has no stage to waive.', {
      code: 'INVALID_RUN_ACTION',
    })

    const stage = stageBySlug(workflow, stageSlug)
    const history = [...state.stage_history]
      .reverse()
      .find((item) => item.stage === stageSlug)
    const assessmentPath = history
      ? resolveRunLayout(root, state.run_id).assessment(
          `${history.invocation_id}.assessment.json`,
        ).relative
      : null
    let assessment: SupervisorAssessment | null = null

    if (assessmentPath && fileExists(resolveInside(root, assessmentPath))) {
      try {
        assessment = parseSupervisorAssessment(
          readJson(resolveInside(root, assessmentPath)),
          assessmentPath,
        )
      } catch {
        assessment = null
      }
    }

    let record: TaskRecord | null = null

    if (
      history?.record_path &&
      fileExists(resolveInside(root, history.record_path))
    ) {
      try {
        record = readTaskRecord(root, history.record_path)
      } catch {
        record = null
      }
    }

    const inferredBlockers = record
      ? failedHardCriteria(stage, record, assessment)
      : []
    const requested = normalizeIdentifiers(options.criterionIds ?? [])
    const waivedCriteria =
      requested.length > 0
        ? requested
        : inferredBlockers.length > 0
          ? inferredBlockers
          : ['*']

    const bypassedBeyondRequest = inferredBlockers.filter(
      (blocker) => !waivedCriteria.includes(blocker),
    )
    const wholeStageBypass = bypassedBeyondRequest.length > 0

    // A waiver on a stage whose card is prepared or whose worker is running
    // names a blocker in that attempt, not a decision to discard it. Routing
    // forward by default threw away the prepared invocation.
    const holdsInvocation =
      state.current_stage === stage.slug &&
      state.pending_action.type === 'invoke_agent'
    const target =
      options.targetStage ??
      (holdsInvocation ? stage.slug : stage.transitions.success)

    invariant(target, `Stage '${stage.slug}' has no success transition.`, {
      code: 'INVALID_TRANSITION',
    })

    // A default route off a gated stage bypasses that stage's own gate. The
    // recorded case waived one evidence gap on verify and jumped to ship,
    // which the note never asked for. Naming the destination is the cheap
    // confirmation that the operator meant the jump.
    // `next_stage` advances on its own and gates nothing, so waiving it skips
    // no decision. The other three each withhold an advance until someone
    // judges the stage, and that is the judgment a forward route discards.
    const stageGate = stage.gate === 'next_stage' ? null : stage.gate
    const noteBody = options.note.trim().toLowerCase()

    // Naming the waived stage is not evidence: a note about waiving verify
    // says "verify" whether or not its author knew the run would leave for
    // ship. Only the destination, or the gate being given up, states the jump.
    invariant(
      options.targetStage !== undefined ||
        target === stage.slug ||
        stageGate === null ||
        noteNamesToken(noteBody, stageGate) ||
        noteNamesToken(noteBody, target.toLowerCase()),
      `Waiving '${stage.slug}' would route the run to '${target}' and bypass ` +
        `that stage's ${stageGate} gate, which the waiver note does not ` +
        `name. Pass --to <stage-slug> to state the destination, or name the ` +
        `gate or the destination stage in the note.`,
      {
        code: 'WAIVER_DESTINATION_REQUIRED',
        details: { stage: stage.slug, gate: stageGate, default_target: target },
      },
    )

    if (!['succeeded', 'failed', 'canceled', 'paused'].includes(target)) {
      stageBySlug(workflow, target)
    }

    // A directive is honored or refused by name, never silently ignored. The
    // entry gate runs before delegation, so a waiver that does not name it
    // leaves the destination stage refusing exactly as before.
    const entryGatesReached: EntryGateReach[] = workflow.stages.flatMap(
      (item) =>
        item.entry_gate &&
        waiverCoversCriterion(
          { stage: stage.slug, criterion_ids: waivedCriteria },
          item.slug,
          item.entry_gate.criterion,
        )
          ? [{ stage: item.slug, criterion: item.entry_gate.criterion }]
          : [],
    )
    const targetEntryGate = workflow.stages.find(
      (item) => item.slug === target,
    )?.entry_gate
    const targetGateRecord = targetEntryGate
      ? state.entry_gates?.[target]
      : undefined

    invariant(
      !targetEntryGate ||
        !targetGateRecord ||
        entryGateSatisfied(targetGateRecord.last_result) ||
        entryGatesReached.some((item) => item.stage === target),
      `Waiving '${stage.slug}' routes the run to '${target}', whose entry ` +
        `gate '${targetEntryGate?.criterion}' last failed and this directive ` +
        `does not reach. Waive that gate directly with: --stage ${target} ` +
        `--criteria ${targetEntryGate?.criterion} --to ${target}.`,
      {
        code: 'WAIVER_ENTRY_GATE_UNREACHED',
        details: {
          stage: stage.slug,
          target,
          entry_gate: targetEntryGate?.criterion,
        },
      },
    )

    const deferred = normalizeIdentifiers(
      options.deferredAcceptanceCriteria ?? [],
    )

    if (options.createSpotfixCase) {
      invariant(
        deferred.length > 0 && history,
        '--spotfix requires a prior stage attempt and at least one deferred acceptance criterion.',
        { code: 'INVALID_SPOTFIX_CASE' },
      )
    }

    const workspace = workspaceSnapshotForRun(root, state)
    const waivers = state.operator_gate_waivers ?? []
    const waiverId = `waiver-${randomUUID()}`
    const artifactPath = resolveRunLayout(root, state.run_id).decision(
      `gate-waiver-${waivers.length + 1}.md`,
    ).relative

    const sourceEvidencePath =
      assessment?.verdict === 'fail' && assessmentPath
        ? assessmentPath
        : (history?.record_path ?? history?.output_path ?? artifactPath)
    const spotfixCasePath =
      options.createSpotfixCase && history
        ? writeSpotfixCase(
            root,
            state,
            waiverId,
            stage,
            history,
            waivedCriteria,
            deferred,
            options.note,
            sourceEvidencePath,
          )
        : undefined
    const actor = options.actor ?? 'operator'
    const authorship = actor === 'away' ? 'Away-mode' : 'Operator'

    const body = [
      `# ${authorship} waiver directive`,
      '',
      `**Run** \`${state.run_id}\` · **Stage** \`${stage.slug}\` · ` +
        `**Source attempt** ${history?.attempt ?? 'none'} · **Route to** \`${target}\``,
      '',
      `**Directive-time workspace fingerprint:** \`${workspace.fingerprint}\``,
      ...(history
        ? [
            `**Source invocation:** \`${history.invocation_id}\``,
            `**Source-attempt workspace fingerprint:** \`${history.workspace_fingerprint}\``,
            `**Source evidence:** \`${sourceEvidencePath}\``,
          ]
        : [
            '**Source invocation:** none — the stage was bypassed before a completed attempt.',
          ]),
      '',
      '## Directive scope',
      '',
      ...waivedCriteria.map((item) => `- \`${item}\``),
      '',
      ...(wholeStageBypass
        ? [
            '## Whole-stage bypass disclosure',
            '',
            '**whole_stage_bypass:** true',
            '',
            'Additional failed hard criteria bypassed beyond the operator-named subset:',
            '',
            ...bypassedBeyondRequest.map((item) => `- \`${item}\``),
            '',
          ]
        : []),
      `## ${authorship} terms`,
      '',
      options.note.trim(),
      '',
      ...(history?.validation_errors.length
        ? [
            '## Known malformed or missing evidence',
            '',
            ...history.validation_errors.map((item) => `- ${item}`),
            '',
          ]
        : []),
      ...(deferred.length > 0
        ? [
            '## Deferred acceptance criteria',
            '',
            ...deferred.map((item) => `- \`${item}\``),
            '',
            ...(spotfixCasePath
              ? [`**Spotfix case:** \`${spotfixCasePath}\``, '']
              : []),
          ]
        : []),
      `This artifact records the ${authorship.toLowerCase()} directive; it does not constrain or reinterpret the directive beyond the terms written above.`,
      '',
    ].join('\n')

    writeTextAtomic(resolveInside(root, artifactPath), `${body}\n`)

    const waiver: OperatorGateWaiver = {
      waiver_id: waiverId,
      stage: stage.slug,
      source_invocation_id:
        history?.invocation_id ?? `operator-bypass-${randomUUID()}`,
      source_attempt: history?.attempt ?? 0,
      source_evidence_path: sourceEvidencePath,
      criterion_ids: waivedCriteria,
      ...(wholeStageBypass ? { whole_stage_bypass: true } : {}),
      workspace_fingerprint: workspace.fingerprint,
      ...(history
        ? { source_workspace_fingerprint: history.workspace_fingerprint }
        : {}),
      directive_target: target,
      validation_errors: history?.validation_errors ?? [],
      ...(actor === 'away' ? { actor } : {}),
      note: options.note.trim(),
      artifact_path: artifactPath,
      deferred_acceptance_criteria: deferred,
      ...(spotfixCasePath ? { spotfix_case_path: spotfixCasePath } : {}),
      timestamp: now(),
    }

    waivers.push(waiver)
    state.operator_gate_waivers = waivers

    const claimTransfer = options.adoptPlanFromRunId
      ? transferWorktreeClaim(root, state, options.adoptPlanFromRunId, waiverId)
      : null

    const preservesPreparedInvocation =
      holdsInvocation &&
      target === stage.slug &&
      state.current_invocation !== null
    const preparedInvocation = preservesPreparedInvocation
      ? state.current_invocation
      : null
    const preparedPendingAction = preservesPreparedInvocation
      ? state.pending_action
      : null

    clearSameReasonTracker(state, stage.slug)
    state.status = 'running'
    state.pause_reason = null
    state.operator_pause = null
    state.current_invocation = preparedInvocation
    state.consecutive_failures = 0

    if (preparedPendingAction) {
      // A waiver on a stage that still holds its prepared card, whether it
      // names criteria or the whole stage, changes what submission may
      // accept; it does not discard the worker output or card that is
      // already ready to submit.
      state.pending_action = preparedPendingAction
    } else {
      applyTransition(root, state, stage, 'success', {
        overrideTarget: target,
        operatorDirected: true,
      })
    }

    state.last_decision_path = artifactPath

    persistRun(
      root,
      state,
      actor === 'away' ? 'away_gate_waived' : 'operator_gate_waived',
      {
        actor,
        waiver_id: waiverId,
        stage: stage.slug,
        source_invocation_id: waiver.source_invocation_id,
        source_attempt: waiver.source_attempt,
        source_evidence_path: sourceEvidencePath,
        criterion_ids: waivedCriteria,
        workspace_fingerprint: workspace.fingerprint,
        source_workspace_fingerprint:
          waiver.source_workspace_fingerprint ?? null,
        directive_target: target,
        spotfix_case_path: spotfixCasePath ?? null,
        entry_gates_reached: entryGatesReached,
        ...(claimTransfer
          ? {
              worktree_claim_adopted_from: claimTransfer.from_run_id,
              worktree: claimTransfer.worktree,
            }
          : {}),
      },
    )

    return {
      state,
      waiver,
      entry_gates_reached: entryGatesReached,
      ...(claimTransfer ? { claimTransfer } : {}),
    }
  })
}

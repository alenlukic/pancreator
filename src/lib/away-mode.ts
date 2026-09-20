import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { errorMessage, invariant, PanError } from './errors.js'
import {
  panInvocationsInText,
  validatePanInvocation,
} from './pan-command-grammar.js'
import {
  appendJsonLine,
  fileExists,
  isRecord,
  readJson,
  readText,
  withOperationMutex,
  writeJsonAtomic,
} from './io.js'
import { AWAY_MODE_ACTIONS, panCommand } from './project-config.js'
import { resolveRunLayout } from './run-layout.js'
import type {
  AgentHealth,
  AwayDecisionKind,
  AwayModeAction,
  ResolvedAwayModeConfig,
  RunState,
} from './types.js'

const AWAY_DIRECTORY = path.join('runtime', 'logs', 'away-mode')
const DECISION_LEDGER = 'decisions.jsonl'
const LEDGER_LOCK = 'decisions.lock'

export interface AwayRollbackPlan {
  steps: string[]
  verification: string
  complete: boolean
  issues: string[]
}

export interface AwayOption {
  rank: number
  action: AwayModeAction
  feasible: boolean
  rationale: string
  evidence: string[]
  rollback_plan: AwayRollbackPlan
  note?: string
  stage?: string
}

export interface AwayBlocker {
  type:
    | 'stage_blocked'
    | 'operator_decision'
    | 'operator_approval'
    | 'operator_question'
    | 'hypervisor_incident'
  summary: string
  stage: string | null
  agent_health?: Extract<AgentHealth, 'stalled' | 'dead'>
}

export interface AwayDecisionRecord {
  schema_version: 1
  decision_id: string
  /** Absent on legacy records, which are evaluated decisions. */
  decision_kind?: AwayDecisionKind
  linked_decision_id?: string
  run_id: string
  invocation_id: string | null
  blocker: AwayBlocker
  ranked_options: AwayOption[]
  selected_action: AwayOption | null
  rejected_options: Array<{ rank: number; reason: string }>
  guardrails: ResolvedAwayModeConfig['guardrails']
  result: 'accepted' | 'rejected' | 'applied' | 'failed'
  evidence_references: string[]
  recorded_at: string
  /**
   * The action the apply actually took. It equals the recommendation in
   * `selected_action`, and is recorded separately so an operator who named an
   * action on the command line can read back what ran, not what was advised.
   */
  applied_action?: AwayModeAction
  error?: string
}

/** CLI response that hands an accepted evaluation directly to apply. */
export function awayEvaluationResponse(
  pan: string,
  decision: AwayDecisionRecord,
): AwayDecisionRecord & {
  apply_ready_decision_id: string | null
  apply_command: string | null
} {
  const applyReady = decision.result === 'accepted'

  return {
    ...decision,
    apply_ready_decision_id: applyReady ? decision.decision_id : null,
    apply_command: applyReady
      ? `${pan} away apply ${decision.run_id} --decision ${decision.decision_id}`
      : null,
  }
}

function awayPath(root: string, name: string): string {
  return path.join(root, AWAY_DIRECTORY, name)
}

export function awayDecisionLedgerPath(root: string): string {
  return awayPath(root, DECISION_LEDGER)
}

function isAwayAction(value: unknown): value is AwayModeAction {
  return (
    typeof value === 'string' &&
    AWAY_MODE_ACTIONS.includes(value as AwayModeAction)
  )
}

function parseStringArray(value: unknown, source: string): string[] {
  invariant(
    Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => typeof item === 'string' && item.trim().length > 0),
    `${source} MUST be a non-empty string array.`,
    { code: 'INVALID_AWAY_DECISION' },
  )

  return value as string[]
}

function parseEvidenceReferences(value: unknown, source: string): string[] {
  const references = parseStringArray(value, source)

  invariant(
    references.every((reference) => {
      const normalized = path.normalize(reference)

      return (
        /^[A-Za-z0-9._@/-]+$/u.test(reference) &&
        !path.isAbsolute(reference) &&
        normalized !== '..' &&
        !normalized.startsWith(`..${path.sep}`)
      )
    }),
    `${source} MUST contain repository-relative path references.`,
    { code: 'INVALID_AWAY_DECISION' },
  )

  return references
}

function parseOption(value: unknown, index: number): AwayOption {
  const source = `ranked_options[${index}]`

  invariant(isRecord(value), `${source} MUST be an object.`, {
    code: 'INVALID_AWAY_DECISION',
  })
  invariant(
    Number.isInteger(value.rank) && (value.rank as number) > 0,
    `${source}.rank MUST be a positive integer.`,
    { code: 'INVALID_AWAY_DECISION' },
  )
  invariant(
    isAwayAction(value.action),
    `${source}.action MUST be one of ${AWAY_MODE_ACTIONS.join(', ')}.`,
    { code: 'INVALID_AWAY_DECISION' },
  )
  invariant(
    typeof value.rationale === 'string' && value.rationale.trim().length > 0,
    `${source}.rationale MUST be a non-empty string.`,
    { code: 'INVALID_AWAY_DECISION' },
  )
  invariant(
    typeof value.feasible === 'boolean',
    `${source}.feasible MUST be a boolean.`,
    { code: 'INVALID_AWAY_DECISION' },
  )
  invariant(
    isRecord(value.rollback_plan) &&
      typeof value.rollback_plan.verification === 'string' &&
      value.rollback_plan.verification.trim().length > 0,
    `${source}.rollback_plan MUST contain verification.`,
    { code: 'INVALID_AWAY_DECISION' },
  )

  const rollbackSteps = parseStringArray(
    value.rollback_plan.steps,
    `${source}.rollback_plan.steps`,
  )

  const rollbackIssues = rollbackSteps.flatMap((step) =>
    panInvocationsInText(step).flatMap((argv) => {
      const validation = validatePanInvocation(argv)

      return validation.valid
        ? []
        : [
            `pan ${argv.join(' ')}: ${
              validation.error ?? 'The command is not accepted by the CLI.'
            }`,
          ]
    }),
  )

  return {
    rank: value.rank as number,
    action: value.action,
    feasible: value.feasible,
    rationale: value.rationale,
    evidence: parseEvidenceReferences(value.evidence, `${source}.evidence`),
    rollback_plan: {
      steps: rollbackSteps,
      verification: value.rollback_plan.verification,
      complete: rollbackIssues.length === 0,
      issues: rollbackIssues,
    },
    ...(typeof value.note === 'string' ? { note: value.note } : {}),
    ...(typeof value.stage === 'string' ? { stage: value.stage } : {}),
  }
}

/** Parse the tool-free evaluator response and reject malformed rankings. */
export function parseAwayOptions(value: unknown): AwayOption[] {
  invariant(
    isRecord(value) && Array.isArray(value.ranked_options),
    'Away evaluation MUST contain ranked_options.',
    { code: 'INVALID_AWAY_DECISION' },
  )

  const options = value.ranked_options.map((option, index) =>
    parseOption(option, index),
  )
  const ranks = options.map((option) => option.rank)

  invariant(
    new Set(ranks).size === ranks.length,
    'Away evaluation ranks MUST be unique.',
    { code: 'INVALID_AWAY_DECISION' },
  )

  return options.sort((left, right) => left.rank - right.rank)
}

function hardDenialReason(option: AwayOption): string | null {
  if (!option.rollback_plan.complete) {
    return `The rollback plan is incomplete: ${option.rollback_plan.issues.join(
      ' ',
    )}`
  }

  if (option.action === 'set-stage' && !option.stage) {
    return 'set-stage requires a target stage.'
  }

  if (option.action === 'revise' && !option.note?.trim()) {
    return 'revise requires a non-empty note.'
  }

  // The note is the waiver directive itself, and `waiveGate` refuses an empty
  // one. Denying it here keeps the refusal in the ranking, where the rejected
  // rank explains why the evaluator's first choice was skipped.
  if (option.action === 'waive-gate' && !option.note?.trim()) {
    return 'waive-gate requires a non-empty note stating the waiver reason.'
  }

  return null
}

/** Select the first allowed reversible option and explain every skipped rank. */
export function selectAwayOption(
  options: AwayOption[],
  config: ResolvedAwayModeConfig,
  declared?: { operator_decision: boolean },
): {
  selected: AwayOption | null
  rejected: Array<{ rank: number; reason: string }>
} {
  const rejected: Array<{ rank: number; reason: string }> = []

  for (const option of options) {
    // Approving a record that declares the decision as the operator's is the
    // one ranking the evaluator may not take, whatever it ranked first.
    if (option.action === 'approve' && declared?.operator_decision) {
      rejected.push({
        rank: option.rank,
        reason:
          'The graded output declares an operator decision as its next action.',
      })
      continue
    }

    if (!option.feasible) {
      rejected.push({
        rank: option.rank,
        reason: 'The evaluator marked this option infeasible.',
      })
      continue
    }

    if (!config.guardrails.allowed_actions.includes(option.action)) {
      rejected.push({
        rank: option.rank,
        reason: `Action '${option.action}' is outside operator guardrails.`,
      })
      continue
    }

    const denial = hardDenialReason(option)

    if (denial) {
      rejected.push({ rank: option.rank, reason: denial })
      continue
    }

    return { selected: option, rejected }
  }

  return { selected: null, rejected }
}

/**
 * Whether any permitted autonomous action can clear one blocker.
 *
 * Every human-only class the long-horizon ladder names reaches this predicate
 * the same way: a denied decision, a guardrail that forbids every ranked
 * option, and a quarantined agent with no supported recovery all leave
 * `selectAwayOption` with nothing selected. The session consumes only this
 * predicate. Ranking, guardrail filtering, and ledger writes stay at their
 * existing away-mode call sites.
 */
export function awayBlockerCanBeCleared(
  selection: ReturnType<typeof selectAwayOption>,
): boolean {
  return selection.selected !== null
}

/**
 * The operator's own last decision on this run. An away decision is not one:
 * away mode answering a gate cannot retire a question addressed to the
 * human, which is the whole premise of the refusal below.
 */
function lastOperatorDecisionAt(state: RunState): string | null {
  const decided = (state.operator_feedback ?? []).filter(
    (item) => (item.source ?? 'operator') === 'operator',
  )

  return decided.at(-1)?.timestamp ?? null
}

/**
 * The unanswered operator question standing on this run, if any.
 *
 * Every stage output submitted since the operator last decided is read, not
 * only the newest: a question raised by one stage survives the next stage
 * writing an output that carries none, and only the operator's own decision
 * retires it.
 *
 * An output that exists but cannot be read or parsed returns a question
 * rather than nothing. The read cannot show that no question stands, and an
 * unreadable record is not evidence of consent. A path with no file yet is
 * the ordinary state before a stage submits and is not treated as one.
 */
export function openOperatorQuestion(
  root: string | undefined,
  state: RunState,
): string | null {
  if (!root) {
    return null
  }

  const decidedAt = lastOperatorDecisionAt(state)
  const unanswered = state.stage_history.filter(
    (item) => decidedAt === null || item.submitted_at > decidedAt,
  )

  for (const item of [...unanswered].reverse()) {
    const absolute = item.output_path ? path.join(root, item.output_path) : null

    if (!absolute || !fileExists(absolute)) {
      continue
    }

    let output: unknown

    try {
      output = readJson(absolute)
    } catch (error) {
      return boundedText(
        `The stage output '${item.output_path}' could not be read, so an ` +
          `unanswered operator question cannot be ruled out: ${errorMessage(error)}`,
      )
    }

    const question =
      isRecord(output) && isRecord(output.operator_question)
        ? output.operator_question.question
        : null

    if (typeof question === 'string' && question.trim().length > 0) {
      return boundedText(question)
    }
  }

  return null
}

export function awayModeTrigger(
  state: RunState,
  incident?: { health: AgentHealth; summary: string },
  root?: string,
): AwayBlocker | null {
  if (!state.away_mode?.enabled) {
    return null
  }

  // A hypervisor incident keeps the precedence it had before the question
  // class existed. Classification order is not the safety boundary: an open
  // question refuses evaluation whatever class the trigger reports, so a
  // stalled agent is still classified as one and still reaches recovery.
  if (incident?.health === 'stalled' || incident?.health === 'dead') {
    return {
      type: 'hypervisor_incident',
      summary: incident.summary,
      stage: state.current_stage,
      agent_health: incident.health,
    }
  }

  const operatorQuestion = openOperatorQuestion(root, state)

  if (operatorQuestion) {
    return {
      type: 'operator_question',
      summary: operatorQuestion,
      stage: state.stage_history.at(-1)?.stage ?? state.current_stage,
    }
  }

  if (state.pending_action.type === 'operator_approval') {
    return {
      type: 'operator_approval',
      summary: `The run waits for approval at stage '${state.pending_action.stage}'.`,
      stage: state.pending_action.stage,
    }
  }

  // A blocked outcome stays in stage_history after the run moves on, so the
  // class applies only while the run still rests in the pause that outcome
  // produced. A progressing run with stale blocked history is not a blocker.
  if (
    state.status === 'paused' &&
    state.stage_history.at(-1)?.outcome === 'blocked' &&
    // An operator-only pending action is never a permitted blocker class,
    // whichever pause produced it.
    !(
      state.pending_action.type === 'operator_decision' &&
      state.pending_action.operator_only === true
    )
  ) {
    return {
      type: 'stage_blocked',
      summary: `Stage '${state.stage_history.at(-1)?.stage}' reported blocked.`,
      stage: state.stage_history.at(-1)?.stage ?? state.current_stage,
    }
  }

  // An operator-only decision is not a permitted blocker class. The release
  // gate raises one after its repair loops run out, and the run stays paused
  // until the human operator decides.
  if (
    state.pending_action.type === 'operator_decision' &&
    state.pending_action.operator_only !== true
  ) {
    return {
      type: 'operator_decision',
      summary: state.pause_reason ?? 'The run waits for an operator decision.',
      stage: state.current_stage,
    }
  }

  return null
}

/** Read immutable ledger entries. A missing ledger is empty. */
export function readAwayDecisionLedger(root: string): AwayDecisionRecord[] {
  const ledgerPath = awayDecisionLedgerPath(root)

  if (!fileExists(ledgerPath)) {
    return []
  }

  const records: AwayDecisionRecord[] = []

  for (const line of readText(ledgerPath).split('\n')) {
    if (line.trim().length === 0) {
      continue
    }

    let value: unknown

    try {
      value = JSON.parse(line) as unknown
    } catch (error) {
      throw new PanError(`Invalid away-mode ledger: ${ledgerPath}`, {
        code: 'INVALID_AWAY_LEDGER',
        details: { cause: errorMessage(error) },
      })
    }

    if (
      !isRecord(value) ||
      value.schema_version !== 1 ||
      typeof value.decision_id !== 'string'
    ) {
      throw new PanError(`Invalid away-mode ledger: ${ledgerPath}`, {
        code: 'INVALID_AWAY_LEDGER',
      })
    }

    records.push(value as unknown as AwayDecisionRecord)
  }

  return records
}

export function appendAwayDecision(
  root: string,
  record: AwayDecisionRecord,
): void {
  withOperationMutex(awayPath(root, LEDGER_LOCK), () => {
    appendJsonLine(awayDecisionLedgerPath(root), record)
  })
}

/** Count the ledger records that consume one run's away decision budget. */
export function countAwayDecisions(root: string, runId: string): number {
  return readAwayDecisionLedger(root).filter(
    (record) =>
      record.run_id === runId &&
      (record.decision_kind === undefined ||
        record.decision_kind === 'evaluated') &&
      (record.result === 'accepted' || record.result === 'rejected'),
  ).length
}

/**
 * Evaluator execution failures for one run. They are not decisions, so they
 * do not spend `max_decisions_per_run`; a spawn that could not authenticate
 * or a process the platform killed says nothing about what the operator
 * would decide. They are bounded by the same number on their own, so a
 * continually failing evaluator still cannot grow the ledger without limit.
 */
export function countAwayEvaluatorFailures(
  root: string,
  runId: string,
): number {
  return readAwayDecisionLedger(root).filter(
    (record) =>
      record.run_id === runId && record.decision_kind === 'evaluator_failure',
  ).length
}

/** Append a non-budgeted approval for one successful ship packet. */
export function recordDeterministicShipApproval(
  root: string,
  state: RunState,
  evidenceReferences: string[],
  recordedAt = new Date().toISOString(),
): AwayDecisionRecord {
  const awayMode = state.away_mode

  invariant(awayMode?.enabled, 'Away mode is disabled for this run.', {
    code: 'AWAY_MODE_DISABLED',
  })
  invariant(
    state.current_stage === 'ship' &&
      state.status === 'awaiting_operator' &&
      state.pending_action.type === 'operator_approval' &&
      state.pending_action.stage === 'ship' &&
      (state.pending_action.outcome ?? 'success') === 'success',
    'The run does not have a successful ship packet awaiting approval.',
    { code: 'AWAY_SHIP_APPROVAL_UNAVAILABLE' },
  )
  invariant(
    awayMode.guardrails.allowed_actions.includes('approve'),
    "Action 'approve' is outside operator guardrails.",
    { code: 'AWAY_ACTION_FORBIDDEN' },
  )

  const evidence = parseEvidenceReferences(
    evidenceReferences,
    'evidence_references',
  )
  const selectedAction: AwayOption = {
    rank: 1,
    action: 'approve',
    feasible: true,
    rationale:
      'Accept the successful ship packet without authorizing a release action.',
    evidence,
    rollback_plan: {
      steps: ['Start a new remediation run for a later product change.'],
      verification: 'Confirm that no external release action occurred.',
      complete: true,
      issues: [],
    },
  }
  const record: AwayDecisionRecord = {
    schema_version: 1,
    decision_id: randomUUID(),
    decision_kind: 'deterministic_ship_approval',
    run_id: state.run_id,
    invocation_id: state.current_invocation?.id ?? null,
    blocker: {
      type: 'operator_approval',
      summary: 'A successful ship packet awaits bounded away approval.',
      stage: 'ship',
    },
    ranked_options: [selectedAction],
    selected_action: selectedAction,
    rejected_options: [],
    guardrails: awayMode.guardrails,
    result: 'accepted',
    evidence_references: evidence,
    recorded_at: recordedAt,
  }

  appendAwayDecision(root, record)

  return record
}

export const OPERATOR_QUESTION_REFUSAL =
  'An unanswered operator question stands on this run, so away mode refuses ' +
  'this blocker without ranking any option.'

/**
 * Refuse one blocker deterministically because a worker asked the operator a
 * question that nobody has answered.
 *
 * `ASK-001` forbids proceeding on an assumed answer. The question already
 * reaches the evaluator as context, but context is guidance to a ranking
 * model rather than a refusal, so the refusal lives above every caller and
 * the ledger keeps the record an unattended run is reviewed from.
 */
export function recordOperatorQuestionRefusal(
  root: string,
  state: RunState,
  blocker: AwayBlocker,
  question: string,
  recordedAt = new Date().toISOString(),
): AwayDecisionRecord {
  const awayMode = state.away_mode

  invariant(awayMode?.enabled, 'Away mode is disabled for this run.', {
    code: 'AWAY_MODE_DISABLED',
  })

  const record: AwayDecisionRecord = {
    schema_version: 1,
    decision_id: randomUUID(),
    decision_kind: 'operator_question_refusal',
    run_id: state.run_id,
    invocation_id: state.current_invocation?.id ?? null,
    blocker,
    ranked_options: [],
    selected_action: null,
    rejected_options: [
      { rank: 0, reason: `${OPERATOR_QUESTION_REFUSAL} ${question}` },
    ],
    guardrails: awayMode.guardrails,
    result: 'rejected',
    evidence_references: parseEvidenceReferences(
      [
        resolveRunLayout(root, state.run_id).state.relative,
        state.stage_history.at(-1)?.output_path,
      ].filter((item): item is string => typeof item === 'string'),
      'evidence_references',
    ),
    recorded_at: recordedAt,
    error: `${OPERATOR_QUESTION_REFUSAL} ${question}`,
  }

  appendAwayDecision(root, record)

  return record
}

/** Record a deterministic quarantine decision without requiring away mode. */
export function recordHypervisorQuarantine(
  root: string,
  state: RunState,
  incident: {
    health: Extract<AgentHealth, 'stalled' | 'dead'>
    summary: string
    evidence_reference: string
  },
  recordedAt = new Date().toISOString(),
): AwayDecisionRecord {
  const record: AwayDecisionRecord = {
    schema_version: 1,
    decision_id: randomUUID(),
    decision_kind: 'hypervisor_quarantine',
    run_id: state.run_id,
    invocation_id: state.current_invocation?.id ?? null,
    blocker: {
      type: 'hypervisor_incident',
      summary: incident.summary,
      stage: state.current_stage,
      agent_health: incident.health,
    },
    ranked_options: [],
    selected_action: null,
    rejected_options: [
      {
        rank: 0,
        reason:
          'The same recovery signature failed twice. The agent is quarantined.',
      },
    ],
    guardrails: state.away_mode?.guardrails ?? {
      allowed_actions: [],
      max_decisions_per_run: 0,
      max_remediation_attempts_per_agent: 0,
    },
    result: 'rejected',
    evidence_references: [incident.evidence_reference],
    recorded_at: recordedAt,
  }

  appendAwayDecision(root, record)

  return record
}

// The evaluator stands in for the operator at a gate, so the prompt hands it
// what the operator would read: the request, the stage outcome, and the
// worker's summary and artifacts. Bounded so a long summary cannot swamp it.
const AWAY_PROMPT_TEXT_MAX = 6_000

function boundedText(text: string, max = AWAY_PROMPT_TEXT_MAX): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[truncated]`
}

/**
 * Phrases a worker uses in its declared next action when the decision is the
 * operator's to take. The field is free prose, so this is the only signal the
 * graded output carries, and the list stays small and literal rather than
 * guessing at intent.
 */
const OPERATOR_DECISION_PHRASES = [
  'operator decision',
  'operator must decide',
  'operator must choose',
  'operator chooses',
  'operator to decide',
  'awaiting operator',
  'needs an operator',
  'requires an operator',
  'ask the operator',
]

/** Whether a declared next action hands the decision back to the operator. */
export function declaresOperatorDecision(nextAction: string | null): boolean {
  if (!nextAction) {
    return false
  }

  const text = nextAction.toLowerCase()

  return OPERATOR_DECISION_PHRASES.some((phrase) => text.includes(phrase))
}

export interface AwayGateContext {
  operator_request: string | null
  stage_outcome: string | null
  stage_summary: string | null
  stage_artifacts: string[]
  stage_output_path: string | null
  stage_open_questions: string[]
  stage_unknowns: string[]
  stage_next_action: string | null
  /** The graded output declares the decision as the operator's to take. */
  declares_operator_decision: boolean
}

export function awayGateContext(
  root: string,
  state: RunState,
): AwayGateContext {
  const layout = resolveRunLayout(root, state.run_id)
  const requestPath = layout.request().absolute
  const operatorRequest = fileExists(requestPath)
    ? boundedText(readText(requestPath))
    : null

  const last = state.stage_history.at(-1)
  let summary: string | null = null
  let nextAction: string | null = null

  const artifacts: string[] = []
  const openQuestions: string[] = []
  const unknowns: string[] = []

  if (last?.output_path && fileExists(path.join(root, last.output_path))) {
    try {
      const output = readJson(path.join(root, last.output_path))

      if (isRecord(output)) {
        if (typeof output.summary === 'string') {
          summary = boundedText(output.summary)
        }

        if (Array.isArray(output.artifacts)) {
          for (const artifact of output.artifacts) {
            if (isRecord(artifact) && typeof artifact.path === 'string') {
              artifacts.push(artifact.path)
            }
          }
        }

        // The blockers the worker declared on the record being graded. The
        // evaluator was ranking approval against an output that says the
        // question is still open, because the prompt never carried them.
        const operatorBlock = isRecord(output.$operator)
          ? output.$operator
          : null

        if (typeof operatorBlock?.next_action === 'string') {
          nextAction = boundedText(operatorBlock.next_action)
        }

        for (const unknown of Array.isArray(output.unknowns)
          ? output.unknowns
          : []) {
          if (typeof unknown === 'string') {
            unknowns.push(boundedText(unknown))
          }
        }

        const spec = isRecord(output.data) ? output.data.product_spec : null

        for (const question of isRecord(spec) &&
        Array.isArray(spec.open_questions)
          ? spec.open_questions
          : []) {
          if (typeof question === 'string') {
            openQuestions.push(boundedText(question))
          }
        }

        // A planning output carries its specifications inside the cohort
        // plan rather than in `artifacts`. Those are the documents the plan
        // gate is about, so the evaluator gets them as citable artifacts.
        const cohortPlan = isRecord(output.data)
          ? output.data.cohort_plan
          : null

        if (isRecord(cohortPlan)) {
          if (typeof cohortPlan.parent_spec_path === 'string') {
            artifacts.push(cohortPlan.parent_spec_path)
          }

          if (Array.isArray(cohortPlan.chunks)) {
            for (const chunk of cohortPlan.chunks) {
              if (
                isRecord(chunk) &&
                typeof chunk.child_spec_path === 'string'
              ) {
                artifacts.push(chunk.child_spec_path)
              }
            }
          }
        }
      }
    } catch {
      // A malformed output is itself a defect the evaluator can weigh from
      // the outcome alone; the prompt still goes out.
    }
  }

  return {
    operator_request: operatorRequest,
    stage_outcome: last?.outcome ?? null,
    stage_summary: summary,
    stage_artifacts: [...new Set(artifacts)],
    stage_output_path: last?.output_path ?? null,
    stage_open_questions: openQuestions,
    stage_unknowns: unknowns,
    stage_next_action: nextAction,
    declares_operator_decision: declaresOperatorDecision(nextAction),
  }
}

// The literal option shape the prompt shows the evaluator. Prose alone left the
// model free to invent its own rollback_plan layout, which parseOption rejects.
const AWAY_OPTION_SHAPE = {
  rank: 1,
  action: 'approve',
  feasible: true,
  rationale: 'one sentence',
  evidence: ['repository/relative/path'],
  rollback_plan: {
    steps: ['one step per string'],
    verification: 'how to confirm the rollback took effect',
  },
  note: 'only for revise and waive-gate',
  stage: 'only for set-stage',
}

/** Bounded copy of one evaluator exchange, written beside the run evidence. */
export interface AwayEvaluatorExchange {
  attempt?: number
  ok: boolean
  exit_code: number | null
  timed_out: boolean
  duration_ms: number
  stdout: string
  stderr: string
  value?: unknown
  error?: string
  parse_error?: string
}

const EXCHANGE_STREAM_MAX = 20_000

/**
 * Persist the evaluator prompt and its raw response at
 * agent/evidence/away-evaluator-<timestamp>-attempt-<n>-<uuid>.json. The UUID keeps
 * concurrent evaluations distinct while the attempt suffix orders retries. The
 * ledger holds only the parsed
 * verdict, so this record is what explains a rejected ranking.
 */
export function recordAwayEvaluatorExchange(
  root: string,
  state: RunState,
  prompt: string,
  exchange: AwayEvaluatorExchange,
  recordedAt = new Date().toISOString(),
): string {
  const layout = resolveRunLayout(root, state.run_id)
  const attemptSuffix =
    exchange.attempt === undefined ? '' : `-attempt-${exchange.attempt}`
  const target = layout.evidence(
    `away-evaluator-${recordedAt.replace(/[:.]/gu, '-')}${attemptSuffix}-${randomUUID()}.json`,
  )

  writeJsonAtomic(target.absolute, {
    schema_version: 1,
    run_id: state.run_id,
    invocation_id: state.current_invocation?.id ?? null,
    recorded_at: recordedAt,
    prompt,
    ...(exchange.attempt !== undefined ? { attempt: exchange.attempt } : {}),
    ok: exchange.ok,
    exit_code: exchange.exit_code,
    timed_out: exchange.timed_out,
    duration_ms: exchange.duration_ms,
    stdout: exchange.stdout.slice(-EXCHANGE_STREAM_MAX),
    stderr: exchange.stderr.slice(-EXCHANGE_STREAM_MAX),
    ...(exchange.value !== undefined ? { value: exchange.value } : {}),
    ...(exchange.error !== undefined ? { error: exchange.error } : {}),
    ...(exchange.parse_error !== undefined
      ? { parse_error: exchange.parse_error }
      : {}),
  })

  return target.relative
}

export function awayEvaluatorPrompt(
  root: string,
  state: RunState,
  blocker: AwayBlocker,
  options: { hypervisorEventsPath: string },
): string {
  const allowedActions = state.away_mode?.guardrails.allowed_actions ?? []
  const gate = awayGateContext(root, state)
  const evidenceReferences = [
    resolveRunLayout(root, state.run_id).state.relative,
    ...(gate.stage_output_path ? [gate.stage_output_path] : []),
    ...gate.stage_artifacts,
    options.hypervisorEventsPath,
  ]

  return [
    'Return JSON only.',
    "You decide the pending operator action on the operator's behalf while the operator is away.",
    'Rank the supplied actions from most to least fit for this gate. Fitness means: the action the operator would take given the request, the stage outcome, and the artifact.',
    'Not advancing is not safer by default. A gate with stage_outcome "success" and a stage_summary that satisfies operator_request ranks approve first.',
    'Rank revise or reject first only for a concrete defect you can name in the artifact against the request, and put that defect in the note. Do not ask for material the summary already reports.',
    'stage_open_questions, stage_unknowns, and stage_next_action are what the graded output itself declares unsettled. Do not rank approve against a next action that names an operator decision; that approval is refused.',
    'Read the stage_artifacts when the summary alone cannot settle the decision.',
    'Return exactly one object with the single top-level key ranked_options and no prose. Every option has exactly this shape and these value types:',
    JSON.stringify(AWAY_OPTION_SHAPE),
    'rank starts at 1 with no gaps. action is one of allowed_actions. evidence entries are paths taken from evidence_references or stage_artifacts. rollback_plan.steps is a non-empty array of strings and rollback_plan.verification is one string.',
    'revise needs note. waive-gate needs note. set-stage needs stage. Otherwise omit note and stage.',
    'Rank waive-gate when the blocker has a mechanical or administrative root cause, when the failing criterion is backed only by cost, speed, or wall time (a wall ceiling, a rolling average, a budget, a cadence), or when its blast radius is limited enough to remediate separately, and the run would otherwise stop for the rest of the operator absence. Never waive a criterion that protects correctness or security. Prefer revise or resume when the work itself can still be repaired. The note becomes the recorded waiver directive, so it states the reason, what is deferred, and the destination stage or the gate it gives up.',
    'The operator is absent by design and expects continuous progress. A blocker the stage worker itself caused (its own test run moved a measurement, its own commit changed a fingerprint) and a transient failure are never reasons to leave the run stopped. Rank every allowed action that keeps the run moving above any that leaves it waiting; leaving the run waiting is the worst outcome except for an irreversible action.',
    JSON.stringify({
      run_id: state.run_id,
      invocation_id: state.current_invocation?.id ?? null,
      current_stage: state.current_stage,
      status: state.status,
      pending_action: state.pending_action,
      blocker,
      stage_outcome: gate.stage_outcome,
      operator_request: gate.operator_request,
      stage_summary: gate.stage_summary,
      stage_artifacts: gate.stage_artifacts,
      stage_open_questions: gate.stage_open_questions,
      stage_unknowns: gate.stage_unknowns,
      stage_next_action: gate.stage_next_action,
      allowed_actions: allowedActions,
      evidence_references: evidenceReferences,
    }),
  ].join('\n')
}

/**
 * The refusal for a run whose evaluator failures reached the decision limit.
 *
 * The ceiling ends unattended continuation for the run, so the refusal names
 * what the operator does next: the evaluator exchanges under the run evidence
 * explain the failures, and `pan decide` takes the gate by hand.
 */
export function awayEvaluatorFailureLimitError(
  root: string,
  state: RunState,
  failures: number,
  limit: number,
): PanError {
  const evidenceDirectory = path.posix.dirname(
    resolveRunLayout(root, state.run_id).evidence('away-evaluator.json')
      .relative,
  )
  // The recovery is a manual command, so it names the harness entry point the
  // way every other harness-emitted command does.
  const recoveryCommand = `${panCommand(root)} decide ${state.run_id} <approve|reject|revise> [--note <text>]`

  return new PanError(
    'The away evaluator failed as many times as the decision limit allows ' +
      `for this run (${failures} of ${limit}). Read the evaluator exchanges ` +
      `under ${evidenceDirectory}/away-evaluator-*.json, then decide the ` +
      `gate yourself with '${recoveryCommand}'.`,
    {
      code: 'AWAY_EVALUATOR_FAILURE_LIMIT',
      details: {
        run_id: state.run_id,
        evaluator_failures: failures,
        max_decisions_per_run: limit,
        evidence_directory: evidenceDirectory,
        recovery_command: recoveryCommand,
      },
    },
  )
}

const AWAY_EVALUATOR_EXHAUSTED_ERROR =
  'The away evaluator exhausted two attempts without a valid decision. ' +
  'Read the referenced evaluator exchange evidence.'

/** Append one generic rejected record after both evaluator attempts fail. */
export function recordAwayEvaluationFailure(
  root: string,
  state: RunState,
  blocker: AwayBlocker,
  evidenceReferences: string[],
  recordedAt = new Date().toISOString(),
): AwayDecisionRecord {
  const awayMode = state.away_mode

  invariant(awayMode?.enabled, 'Away mode is disabled for this run.', {
    code: 'AWAY_MODE_DISABLED',
  })

  const references = parseEvidenceReferences(
    evidenceReferences,
    'evidence_references',
  )
  const record: AwayDecisionRecord = {
    schema_version: 1,
    decision_id: randomUUID(),
    decision_kind: 'evaluator_failure',
    run_id: state.run_id,
    invocation_id: state.current_invocation?.id ?? null,
    blocker,
    ranked_options: [],
    selected_action: null,
    rejected_options: [{ rank: 0, reason: AWAY_EVALUATOR_EXHAUSTED_ERROR }],
    guardrails: awayMode.guardrails,
    result: 'rejected',
    evidence_references: references,
    recorded_at: recordedAt,
    error: AWAY_EVALUATOR_EXHAUSTED_ERROR,
  }

  // An exhausted evaluation is not a decision, so it leaves the decision
  // budget alone. It has its own ceiling of the same size, so the ledger stays
  // bounded when the evaluator fails every time.
  return withOperationMutex(
    awayPath(root, LEDGER_LOCK),
    (): AwayDecisionRecord => {
      const failures = countAwayEvaluatorFailures(root, state.run_id)
      const limit = awayMode.guardrails.max_decisions_per_run

      if (failures >= limit) {
        throw awayEvaluatorFailureLimitError(root, state, failures, limit)
      }

      appendJsonLine(awayDecisionLedgerPath(root), record)

      return record
    },
  )
}

/** Build and append one accepted or rejected decision from evaluator output. */
export function recordAwayEvaluation(
  root: string,
  state: RunState,
  blocker: AwayBlocker,
  evaluatorValue: unknown,
  recordedAt = new Date().toISOString(),
): AwayDecisionRecord {
  const awayMode = state.away_mode

  invariant(awayMode?.enabled, 'Away mode is disabled for this run.', {
    code: 'AWAY_MODE_DISABLED',
  })

  // Orchestration validates each attempt before this durable decision append.
  // A direct invalid call throws without changing the append-only ledger.
  const options = parseAwayOptions(evaluatorValue)

  // The decision limit is checked and the record appended under one lock, so
  // concurrent evaluations cannot both pass the limit before either appends.
  return withOperationMutex(
    awayPath(root, LEDGER_LOCK),
    (): AwayDecisionRecord => {
      invariant(
        countAwayDecisions(root, state.run_id) <
          awayMode.guardrails.max_decisions_per_run,
        'The away-mode decision limit for this run is exhausted.',
        { code: 'AWAY_DECISION_LIMIT' },
      )

      const selection = selectAwayOption(options, awayMode, {
        operator_decision: awayGateContext(root, state)
          .declares_operator_decision,
      })
      const record: AwayDecisionRecord = {
        schema_version: 1,
        decision_id: randomUUID(),
        decision_kind: 'evaluated',
        run_id: state.run_id,
        invocation_id: state.current_invocation?.id ?? null,
        blocker,
        ranked_options: options,
        selected_action: selection.selected,
        rejected_options: selection.rejected,
        guardrails: awayMode.guardrails,
        result: selection.selected ? 'accepted' : 'rejected',
        evidence_references: options.flatMap((option) => option.evidence),
        recorded_at: recordedAt,
      }

      appendJsonLine(awayDecisionLedgerPath(root), record)

      return record
    },
  )
}

/** The options each away subcommand accepts, including the global `--json`. */
export const AWAY_SUBCOMMAND_OPTIONS: Record<string, string[]> = {
  status: ['--json'],
  evaluate: ['--json'],
  apply: ['--decision', '--action', '--worktree', '--json'],
}

/**
 * Name the first option the subcommand does not accept. An ignored option is
 * a silent difference between what the operator asked for and what ran, which
 * is the failure `--action` itself exists to close.
 */
export function unknownAwayOption(
  subcommand: string,
  args: string[],
): string | null {
  const accepted = AWAY_SUBCOMMAND_OPTIONS[subcommand]

  if (!accepted) {
    return null
  }

  for (const argument of args) {
    if (!argument.startsWith('--')) {
      continue
    }

    const name = argument.split('=')[0] ?? argument

    if (!accepted.includes(name)) {
      return name
    }
  }

  return null
}

/**
 * Resolve the action an apply may take. An operator who names an action gets
 * that action or a refusal naming both; the apply never substitutes the
 * recommendation for what the operator asked for.
 */
export function resolveAwayApplyAction(
  decision: AwayDecisionRecord,
  requested?: string | null,
): AwayModeAction {
  const recommended = decision.selected_action?.action

  invariant(recommended, 'The away decision selected no action.', {
    code: 'AWAY_DECISION_EMPTY',
  })

  if (requested === undefined || requested === null) {
    return recommended
  }

  if (!isAwayAction(requested)) {
    throw new PanError(
      `Unknown away action: ${requested}. Known actions: ${AWAY_MODE_ACTIONS.join(', ')}.`,
      { code: 'AWAY_ACTION_UNKNOWN' },
    )
  }

  if (requested !== recommended) {
    throw new PanError(
      `The away decision recommends '${recommended}', not the requested '${requested}'. ` +
        `Apply without --action to take the recommendation, or evaluate again for a decision that recommends '${requested}'.`,
      { code: 'AWAY_ACTION_REFUSED' },
    )
  }

  return requested
}

/** Append the apply result without rewriting the original decision. */
export function recordAwayApplyResult(
  root: string,
  decision: AwayDecisionRecord,
  result: 'applied' | 'failed',
  error?: string,
  appliedAction?: AwayModeAction,
): AwayDecisionRecord {
  const record: AwayDecisionRecord = {
    ...decision,
    decision_id: randomUUID(),
    linked_decision_id: decision.decision_id,
    result,
    recorded_at: new Date().toISOString(),
    ...(appliedAction ? { applied_action: appliedAction } : {}),
    ...(error ? { error } : {}),
  }

  appendAwayDecision(root, record)

  return record
}

import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { errorMessage, invariant, PanError } from './errors.js'
import {
  appendJsonLine,
  fileExists,
  isRecord,
  readJson,
  readText,
  withOperationMutex,
} from './io.js'
import { AWAY_MODE_ACTIONS } from './project-config.js'
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
  error?: string
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
    `${source}.action MUST be approve, reject, revise, resume, or set-stage.`,
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

  return {
    rank: value.rank as number,
    action: value.action,
    feasible: value.feasible,
    rationale: value.rationale,
    evidence: parseEvidenceReferences(value.evidence, `${source}.evidence`),
    rollback_plan: {
      steps: parseStringArray(
        value.rollback_plan.steps,
        `${source}.rollback_plan.steps`,
      ),
      verification: value.rollback_plan.verification,
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
  if (option.action === 'set-stage' && !option.stage) {
    return 'set-stage requires a target stage.'
  }

  if (option.action === 'revise' && !option.note?.trim()) {
    return 'revise requires a non-empty note.'
  }

  return null
}

/** Select the first allowed reversible option and explain every skipped rank. */
export function selectAwayOption(
  options: AwayOption[],
  config: ResolvedAwayModeConfig,
): {
  selected: AwayOption | null
  rejected: Array<{ rank: number; reason: string }>
} {
  const rejected: Array<{ rank: number; reason: string }> = []

  for (const option of options) {
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

/** Identify only the blocker classes the approved away-mode design permits. */
export function awayModeTrigger(
  state: RunState,
  incident?: { health: AgentHealth; summary: string },
): AwayBlocker | null {
  if (!state.away_mode?.enabled) {
    return null
  }

  if (incident?.health === 'stalled' || incident?.health === 'dead') {
    return {
      type: 'hypervisor_incident',
      summary: incident.summary,
      stage: state.current_stage,
      agent_health: incident.health,
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
    state.stage_history.at(-1)?.outcome === 'blocked'
  ) {
    return {
      type: 'stage_blocked',
      summary: `Stage '${state.stage_history.at(-1)?.stage}' reported blocked.`,
      stage: state.stage_history.at(-1)?.stage ?? state.current_stage,
    }
  }

  if (state.pending_action.type === 'operator_decision') {
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

export function awayGateContext(
  root: string,
  state: RunState,
): {
  operator_request: string | null
  stage_outcome: string | null
  stage_summary: string | null
  stage_artifacts: string[]
  stage_output_path: string | null
} {
  const layout = resolveRunLayout(root, state.run_id)
  const requestPath = layout.request().absolute
  const operatorRequest = fileExists(requestPath)
    ? boundedText(readText(requestPath))
    : null
  const last = state.stage_history.at(-1)
  let summary: string | null = null
  const artifacts: string[] = []

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
    stage_artifacts: artifacts,
    stage_output_path: last?.output_path ?? null,
  }
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
    'Read the stage_artifacts when the summary alone cannot settle the decision.',
    'Return exactly one object of the shape {"ranked_options": [...]} with no other top-level key and no prose.',
    'Each option needs rank, action, feasible, rationale, evidence, and rollback_plan.',
    'Evidence entries must use the supplied repository-relative paths.',
    'rollback_plan needs non-empty steps and verification.',
    'revise needs note. set-stage needs stage.',
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
      allowed_actions: allowedActions,
      evidence_references: evidenceReferences,
    }),
  ].join('\n')
}

/** Append one rejected record when the evaluator cannot return ranked options. */
export function recordAwayEvaluationFailure(
  root: string,
  state: RunState,
  blocker: AwayBlocker,
  error: string,
  recordedAt = new Date().toISOString(),
): AwayDecisionRecord {
  const awayMode = state.away_mode

  invariant(awayMode?.enabled, 'Away mode is disabled for this run.', {
    code: 'AWAY_MODE_DISABLED',
  })

  const record: AwayDecisionRecord = {
    schema_version: 1,
    decision_id: randomUUID(),
    decision_kind: 'evaluator_failure',
    run_id: state.run_id,
    invocation_id: state.current_invocation?.id ?? null,
    blocker,
    ranked_options: [],
    selected_action: null,
    rejected_options: [{ rank: 0, reason: error }],
    guardrails: awayMode.guardrails,
    result: 'rejected',
    evidence_references: [],
    recorded_at: recordedAt,
    error,
  }

  // An execution failure is not a decision, so it leaves the decision budget
  // alone. It has its own ceiling of the same size, so the ledger stays
  // bounded when the evaluator fails every time.
  return withOperationMutex(
    awayPath(root, LEDGER_LOCK),
    (): AwayDecisionRecord => {
      invariant(
        countAwayEvaluatorFailures(root, state.run_id) <
          awayMode.guardrails.max_decisions_per_run,
        'The away evaluator failed as many times as the decision limit allows for this run.',
        { code: 'AWAY_EVALUATOR_FAILURE_LIMIT' },
      )

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

  // A ranking the parser rejects is an evaluator defect, not a decision the
  // operator's budget should pay for. It takes the failure route and ceiling.
  let options: AwayOption[]

  try {
    options = parseAwayOptions(evaluatorValue)
  } catch (error) {
    return recordAwayEvaluationFailure(
      root,
      state,
      blocker,
      errorMessage(error),
      recordedAt,
    )
  }

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

      const selection = selectAwayOption(options, awayMode)
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

/** Append the apply result without rewriting the original decision. */
export function recordAwayApplyResult(
  root: string,
  decision: AwayDecisionRecord,
  result: 'applied' | 'failed',
  error?: string,
): AwayDecisionRecord {
  const record: AwayDecisionRecord = {
    ...decision,
    decision_id: randomUUID(),
    linked_decision_id: decision.decision_id,
    result,
    recorded_at: new Date().toISOString(),
    ...(error ? { error } : {}),
  }

  appendAwayDecision(root, record)

  return record
}

import path from 'node:path'

import { PanError } from './errors.js'
import {
  appendJsonLine,
  fileExists,
  isRecord,
  readText,
  withOperationMutex,
} from './io.js'
import type { AwayModeAction, RunState } from './types.js'

const AWAY_DIRECTORY = path.join('runtime', 'logs', 'away-mode')
const SUPERVISOR_DECISION_LEDGER = 'supervisor-decisions.jsonl'
const LEDGER_LOCK = 'decisions.lock'

const AWAY_PROMPT_TEXT_MAX = 6_000

export interface AwayBlocker {
  type:
    | 'stage_blocked'
    | 'operator_decision'
    | 'operator_approval'
    | 'operator_question'
  summary: string
  stage: string | null
}

export interface SupervisorDecisionRecord {
  schema_version: 1
  decision_id: string
  author: 'supervisor'
  run_id: string
  invocation_id: string | null
  blocker: AwayBlocker
  action: AwayModeAction
  stage?: string
  reason: string
  guardrails: {
    allowed_actions: AwayModeAction[]
  }
  result: 'applied' | 'failed'
  error?: string
  evidence_references: string[]
  recorded_at: string
}

function awayPath(root: string, name: string): string {
  return path.join(root, AWAY_DIRECTORY, name)
}

/** Absolute path of the append-only supervisor decision ledger under `runtime/logs/away-mode/`. */
export function awayDecisionLedgerPath(root: string): string {
  return awayPath(root, SUPERVISOR_DECISION_LEDGER)
}

/** Read immutable supervisor decision ledger entries. A missing ledger is empty. */
export function readAwayDecisionLedger(
  root: string,
): SupervisorDecisionRecord[] {
  const ledgerPath = awayDecisionLedgerPath(root)

  if (!fileExists(ledgerPath)) {
    return []
  }

  const records: SupervisorDecisionRecord[] = []

  for (const line of readText(ledgerPath).split('\n')) {
    if (line.trim().length === 0) {
      continue
    }

    let value: unknown

    try {
      value = JSON.parse(line) as unknown
    } catch (error) {
      throw new PanError(
        `Invalid away-mode supervisor decision ledger: ${ledgerPath}`,
        { code: 'INVALID_AWAY_LEDGER', details: { cause: String(error) } },
      )
    }

    if (
      !isRecord(value) ||
      value.schema_version !== 1 ||
      typeof value.decision_id !== 'string'
    ) {
      throw new PanError(
        `Invalid away-mode supervisor decision ledger: ${ledgerPath}`,
        { code: 'INVALID_AWAY_LEDGER' },
      )
    }

    records.push(value as unknown as SupervisorDecisionRecord)
  }

  return records
}

/**
 * Appends one supervisor decision record to the away-mode ledger while
 * holding the ledger's operation mutex, so concurrent writers never interleave.
 */
export function appendSupervisorDecision(
  root: string,
  record: SupervisorDecisionRecord,
): void {
  withOperationMutex(awayPath(root, LEDGER_LOCK), () => {
    appendJsonLine(awayDecisionLedgerPath(root), record)
  })
}

function boundedText(text: string, max = AWAY_PROMPT_TEXT_MAX): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[truncated]`
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
      const text = readText(absolute)
      output = JSON.parse(text) as unknown
    } catch (error) {
      return boundedText(
        `The stage output '${item.output_path}' could not be read, so an ` +
          `unanswered operator question cannot be ruled out: ${String(error)}`,
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

/**
 * Classifies why an away-mode run needs a supervisor decision, or returns null
 * when away mode is off or nothing blocks. Checks, in order: an unanswered
 * operator question in stage outputs (only when `root` is given), a pending
 * operator approval, a paused blocked stage, and a non-operator-only decision.
 *
 * Operator-only decisions never count as a blocker, so away mode cannot answer
 * a question reserved for the human.
 */
export function awayModeTrigger(
  state: RunState,
  root?: string,
): AwayBlocker | null {
  if (!state.away_mode?.enabled) {
    return null
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

/** The options each away subcommand accepts, including the global `--json`. */
export const AWAY_SUBCOMMAND_OPTIONS: Record<string, string[]> = {
  status: ['--json'],
  decide: [
    '--action',
    '--note',
    '--note-file',
    '--stage',
    '--worktree',
    '--json',
  ],
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

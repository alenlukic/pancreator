import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { awayGateContext, readAwayDecisionLedger } from './away-mode.js'
import {
  decideRunAsAway,
  liftOperatorOnlyPauseForHorizon,
  resumeRunAsAway,
  setRunStageAsAway,
  waiveGate,
} from './engine.js'
import { errorMessage } from './errors.js'
import { runCursorAgentJson } from './executors/cursor-agent.js'
import {
  appendJsonLine,
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
  writeJsonAtomic,
} from './io.js'
import { loadPipelineConfig, resolvePersonaMapping } from './pipeline-config.js'
import type { RunState } from './types.js'

/**
 * The long-horizon arbiter: the session's reasoning layer over every stop.
 *
 * Before this module existed, a run that stopped for any reason the away
 * evaluator did not clear went straight to the deferral ledger. A reply that
 * did not parse, a `resume` the engine refused on an awaiting run, a spent
 * decision budget, and a worker that wrote `blocked` over a wall-time ceiling
 * all deferred a task on a function's verdict, with no agent reasoning about
 * whether the stop was one of the four hard blocks HORIZON-001 names.
 *
 * The arbiter reverses that default. The harness may not defer a task on its
 * own; every stop that is not a terminal success passes through here, and the
 * arbiter overrides unless it names a hard block. Every round, verdict, apply
 * result, and failure is appended to the session's `arbiter.jsonl`, and each
 * exchange is kept beside it, so the post-run review can see the reasoning
 * and not only the outcome.
 */

export const HORIZON_HARD_BLOCKS = ['LH-H1', 'LH-H2', 'LH-H3', 'LH-H4'] as const
export type HorizonHardBlock = (typeof HORIZON_HARD_BLOCKS)[number]

const HARD_BLOCK_TEXT: Record<HorizonHardBlock, string> = {
  'LH-H1':
    'An action an invariant reserves for the operator: push, publication, deployment, history rewrite, destructive reset, branch deletion, external release, or an invented operator override.',
  'LH-H2':
    'A secret, credential, or authorization that is genuinely absent after the operator-question recovery flow.',
  'LH-H3':
    'A correctness or security failure that no permitted action can repair.',
  'LH-H4': 'A destructive or irreversible action the operator did not direct.',
}

export const ARBITER_ACTIONS = [
  'resume',
  'set-stage',
  'decide',
  'waive-gate',
  'restart-task',
] as const
export type ArbiterActionType = (typeof ARBITER_ACTIONS)[number]

export interface ArbiterAction {
  type: ArbiterActionType
  stage?: string
  decision?: 'approve' | 'reject' | 'revise'
  note: string
}

export interface ArbiterVerdict {
  verdict: 'override' | 'hard_block'
  hard_block?: HorizonHardBlock
  action?: ArbiterAction
  reasoning: string
}

export type ArbiterOutcome =
  | { outcome: 'continued'; action: ArbiterAction; reasoning: string }
  | { outcome: 'restart'; action: ArbiterAction; reasoning: string }
  | { outcome: 'hard_block'; hard_block: HorizonHardBlock; reasoning: string }
  | { outcome: 'harness_unrecoverable'; reason: string }

export interface ArbiterRecord {
  schema_version: 1
  record_id: string
  session_id: string
  task_id: string
  run_id: string | null
  stop_reason: string
  round: number
  verdict: ArbiterVerdict | null
  result:
    | 'applied'
    | 'apply_failed'
    | 'hard_block'
    | 'evaluator_failed'
    | 'fallback_applied'
    | 'harness_unrecoverable'
    | 'override_bound'
  error?: string
  exchange_path: string | null
  /** Who decided: the session arbiter, or the supervisor reinstating a deferral. */
  actor?: 'arbiter' | 'supervisor'
  recorded_at: string
}

/**
 * How many arbiter rounds one stop absorbs. A round is one model exchange
 * plus one apply attempt; an apply error feeds the next round. Three rounds
 * cover a mis-specified action and a transport hiccup without letting a stop
 * spin.
 */
export const ARBITER_ROUNDS = 3

/**
 * How many overrides one task absorbs across its whole life. A stop that
 * recurs after this many overrides is evidence of a block the arbiter has not
 * named, and the bound is what keeps the checkpoint loop finite. Reaching it
 * is recorded as `override_bound`, a harness condition rather than a hard
 * block, so the post-run review sees it for what it is.
 */
export const ARBITER_OVERRIDE_BOUND = 8

const HORIZON_ROOT = path.join('runtime', 'logs', 'horizon')
const TEXT_MAX = 4000

function bounded(text: string): string {
  return text.length <= TEXT_MAX ? text : `${text.slice(0, TEXT_MAX)}…`
}

export function arbiterLedgerPath(root: string, sessionId: string): string {
  return path.join(root, HORIZON_ROOT, sessionId, 'arbiter.jsonl')
}

export function readArbiterLedger(
  root: string,
  sessionId: string,
): ArbiterRecord[] {
  const ledgerPath = arbiterLedgerPath(root, sessionId)

  if (!fileExists(ledgerPath)) {
    return []
  }

  return readText(ledgerPath)
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ArbiterRecord)
}

/** How many overrides the arbiter has already applied for one task. */
export function countArbiterOverrides(
  root: string,
  sessionId: string,
  taskId: string,
): number {
  return readArbiterLedger(root, sessionId).filter(
    (record) =>
      record.task_id === taskId &&
      (record.result === 'applied' || record.result === 'fallback_applied'),
  ).length
}

function parseVerdict(value: unknown): ArbiterVerdict {
  if (!isRecord(value)) {
    throw new Error('The arbiter reply is not an object.')
  }

  const reasoning =
    typeof value.reasoning === 'string' ? value.reasoning.trim() : ''

  if (reasoning.length === 0) {
    throw new Error('The arbiter reply carries no reasoning.')
  }

  if (value.verdict === 'hard_block') {
    const hardBlock = value.hard_block

    if (
      typeof hardBlock !== 'string' ||
      !(HORIZON_HARD_BLOCKS as readonly string[]).includes(hardBlock)
    ) {
      throw new Error(
        `A hard_block verdict must name one of ${HORIZON_HARD_BLOCKS.join(', ')}.`,
      )
    }

    return {
      verdict: 'hard_block',
      hard_block: hardBlock as HorizonHardBlock,
      reasoning,
    }
  }

  if (value.verdict !== 'override') {
    throw new Error("The arbiter verdict must be 'override' or 'hard_block'.")
  }

  const action = value.action

  if (!isRecord(action) || typeof action.type !== 'string') {
    throw new Error('An override verdict must carry an action with a type.')
  }

  if (!(ARBITER_ACTIONS as readonly string[]).includes(action.type)) {
    throw new Error(
      `Unknown arbiter action '${action.type}'. Known: ${ARBITER_ACTIONS.join(', ')}.`,
    )
  }

  const note = typeof action.note === 'string' ? action.note.trim() : ''

  if (note.length === 0) {
    throw new Error('An arbiter action must carry a non-empty note.')
  }

  const parsed: ArbiterAction = {
    type: action.type as ArbiterActionType,
    note,
  }

  if (typeof action.stage === 'string' && action.stage.trim().length > 0) {
    parsed.stage = action.stage.trim()
  }

  if (
    action.decision === 'approve' ||
    action.decision === 'reject' ||
    action.decision === 'revise'
  ) {
    parsed.decision = action.decision
  }

  if (parsed.type === 'set-stage' && !parsed.stage) {
    throw new Error('set-stage requires a stage.')
  }

  if (parsed.type === 'decide' && !parsed.decision) {
    throw new Error('decide requires a decision of approve, reject, or revise.')
  }

  return { verdict: 'override', action: parsed, reasoning }
}

function runContext(root: string, run: RunState | null): unknown {
  if (!run) {
    return null
  }

  const gate = awayGateContext(root, run)
  let risks: string[] = []

  if (
    gate.stage_output_path &&
    fileExists(path.join(root, gate.stage_output_path))
  ) {
    try {
      const output = readJson(path.join(root, gate.stage_output_path))

      if (isRecord(output) && Array.isArray(output.risks)) {
        risks = output.risks
          .filter((item): item is string => typeof item === 'string')
          .map(bounded)
      }
    } catch {
      // The outcome and summary still describe the stop.
    }
  }

  const awayLedger = readAwayDecisionLedger(root)
    .filter((record) => record.run_id === run.run_id)
    .slice(-6)
    .map((record) => ({
      decision_kind: record.decision_kind ?? 'evaluated',
      blocker: record.blocker,
      selected: record.selected_action?.action ?? null,
      result: record.result,
      applied_action: record.applied_action ?? null,
      error: record.error ?? null,
      rejected: record.rejected_options,
    }))

  return {
    run_id: run.run_id,
    status: run.status,
    current_stage: run.current_stage,
    pending_action: run.pending_action,
    pause_reason: run.pause_reason ?? null,
    stage_outcome: gate.stage_outcome,
    stage_summary: gate.stage_summary,
    stage_risks: risks,
    stage_unknowns: gate.stage_unknowns,
    stage_next_action: gate.stage_next_action,
    stage_output_path: gate.stage_output_path,
    operator_request: gate.operator_request,
    ladder: run.horizon_ladder ?? null,
    stages: run.stage_history.slice(-8).map((item) => ({
      stage: item.stage,
      outcome: item.outcome,
    })),
    recent_away_decisions: awayLedger,
  }
}

export function arbiterPrompt(
  root: string,
  input: {
    sessionId: string
    taskId: string
    taskTitle: string
    run: RunState | null
    stopReason: string
    overridesSoFar: number
    priorRounds: Array<{ verdict: ArbiterVerdict | null; error: string }>
  },
): string {
  const availableActions = input.run
    ? input.run.status === 'succeeded' || input.run.status === 'failed'
      ? ['restart-task']
      : ARBITER_ACTIONS.filter((action) => action !== 'restart-task')
    : ['restart-task']

  return [
    'You are the arbiter of a long-horizon session. The operator is absent by design and expects continuous meaningful progress. A task in this session has stopped, and the harness may not defer it on its own: you decide.',
    'Reason from the operating principles: accomplish the operator objective, keep the critical path unblocked, minimize operator attention, prefer the smallest reversible action, and never trade correctness, security, or an explicit operator constraint for speed.',
    'Exactly four conditions are hard blocks. Every other stop is overridden.',
    JSON.stringify(HARD_BLOCK_TEXT),
    'These are never hard blocks: a criterion, ceiling, budget, or cadence backed only by cost, speed, or wall time, wherever it sits (waive it with a reason); a condition the run caused itself (its own test run moved a rolling average, its own commit changed a fingerprint); a transient failure (an evaluator reply that did not parse, an executor timeout, a stale build, an apply error); a spent budget or ladder rung; a worker that cited a policy, a rung, or a gate identifier as its reason to report blocked; and any ordinary judgment call.',
    'Your default is override. Return hard_block only when one of the four conditions is genuinely met on the evidence, and name it.',
    `Available actions: ${availableActions.join(', ')}. resume re-attempts the current stage (name a stage to re-attempt another). set-stage routes the run to a stage with a directive note the next worker must act on. decide takes approve, reject, or revise on a pending gate. waive-gate waives the failing criterion; the note is the recorded waiver directive and must name the gate or the destination stage. restart-task opens a fresh run of the task from its stored request.`,
    'Write the note as the directive the next worker or the record needs: what to do, why the stop was not a block, and what you accept.',
    'Return exactly one JSON object and no prose:',
    JSON.stringify({
      verdict: 'override | hard_block',
      hard_block: 'LH-H1..LH-H4, only with hard_block',
      action: {
        type: 'one of the available actions, only with override',
        stage: 'only for set-stage or resume',
        decision: 'approve | reject | revise, only for decide',
        note: 'the directive',
      },
      reasoning: 'two to five sentences naming the evidence you weighed',
    }),
    JSON.stringify({
      session_id: input.sessionId,
      task_id: input.taskId,
      task_title: input.taskTitle,
      stop_reason: input.stopReason,
      overrides_applied_so_far_for_this_task: input.overridesSoFar,
      override_bound: ARBITER_OVERRIDE_BOUND,
      prior_rounds_this_stop: input.priorRounds,
      run: runContext(root, input.run),
    }),
  ].join('\n')
}

function recordExchange(
  root: string,
  sessionId: string,
  taskId: string,
  round: number,
  prompt: string,
  result: { ok: boolean; stdout: string; stderr: string; error?: string },
  parseError?: string,
): string {
  const relative = path.posix.join(
    HORIZON_ROOT.split(path.sep).join('/'),
    sessionId,
    'arbiter',
    `${new Date().toISOString().replaceAll(/[:.]/gu, '-')}-${taskId}-round-${round}-${randomUUID().slice(0, 8)}.json`,
  )

  writeJsonAtomic(resolveInside(root, relative), {
    schema_version: 1,
    prompt,
    ok: result.ok,
    stdout: bounded(result.stdout),
    stderr: bounded(result.stderr),
    ...(result.error ? { error: result.error } : {}),
    ...(parseError ? { parse_error: parseError } : {}),
  })

  return relative
}

export function appendArbiterRecord(
  root: string,
  record: Omit<ArbiterRecord, 'schema_version' | 'record_id' | 'recorded_at'>,
): ArbiterRecord {
  const full: ArbiterRecord = {
    schema_version: 1,
    record_id: randomUUID(),
    actor: 'arbiter',
    ...record,
    recorded_at: new Date().toISOString(),
  }

  appendJsonLine(arbiterLedgerPath(root, record.session_id), full)

  return full
}

/** Apply one override to the run. `restart-task` is the caller's to apply. */
export function applyArbiterAction(
  root: string,
  run: RunState,
  action: ArbiterAction,
  reasoning: string,
): void {
  liftOperatorOnlyPauseForHorizon(root, run.run_id, reasoning)

  const note = `[horizon arbiter] ${action.note}`

  switch (action.type) {
    case 'resume': {
      const stage = action.stage ?? run.current_stage

      if (run.status !== 'paused' && stage) {
        setRunStageAsAway(root, run.run_id, stage, note)
        return
      }

      resumeRunAsAway(root, run.run_id, stage, note)
      return
    }
    case 'set-stage':
      setRunStageAsAway(root, run.run_id, action.stage as string, note)
      return
    case 'decide':
      decideRunAsAway(root, run.run_id, action.decision as string, note)
      return
    case 'waive-gate':
      waiveGate(root, run.run_id, { note, actor: 'away' })
      return
    case 'restart-task':
      return
    default:
      throw new Error(`Unsupported arbiter action: ${String(action.type)}`)
  }
}

export interface ArbitrateOptions {
  runArbiter?: typeof runCursorAgentJson
}

/**
 * Reason about one stop and act on it.
 *
 * Returns `continued` when an override applied to the run, `restart` when the
 * task must reopen from its request, `hard_block` when the arbiter named one
 * of the four, and `harness_unrecoverable` when neither the arbiter nor the
 * deterministic fallback could act. Only the last two reach the deferral
 * ledger, and each carries its classification so a post-run review never
 * mistakes a harness failure for an operator-owned block.
 */
export function arbitrateHorizonStop(
  root: string,
  input: {
    sessionId: string
    taskId: string
    taskTitle: string
    run: RunState | null
    stopReason: string
  },
  options: ArbitrateOptions = {},
): ArbiterOutcome {
  const runArbiter = options.runArbiter ?? runCursorAgentJson
  const overridesSoFar = countArbiterOverrides(
    root,
    input.sessionId,
    input.taskId,
  )
  const base = {
    session_id: input.sessionId,
    task_id: input.taskId,
    run_id: input.run?.run_id ?? null,
    stop_reason: input.stopReason,
  }

  if (overridesSoFar >= ARBITER_OVERRIDE_BOUND) {
    appendArbiterRecord(root, {
      ...base,
      round: 0,
      verdict: null,
      result: 'override_bound',
      error: `The task spent its ${ARBITER_OVERRIDE_BOUND}-override bound; the same stop keeps recurring after arbiter overrides.`,
      exchange_path: null,
    })

    return {
      outcome: 'harness_unrecoverable',
      reason: `The arbiter overrode this task ${overridesSoFar} times and the stop recurs: ${input.stopReason}`,
    }
  }

  const pipeline = loadPipelineConfig(root)
  const model = resolvePersonaMapping(
    pipeline.config,
    'orchestrator',
  ).model_spec
  const priorRounds: Array<{ verdict: ArbiterVerdict | null; error: string }> =
    []

  for (let round = 1; round <= ARBITER_ROUNDS; round++) {
    const prompt = arbiterPrompt(root, {
      ...input,
      overridesSoFar,
      priorRounds,
    })
    const reply = runArbiter({
      cwd: root,
      installationRoot: root,
      model,
      prompt,
    })
    let verdict: ArbiterVerdict | null = null
    let parseError: string | undefined

    if (reply.ok && reply.value !== undefined) {
      try {
        verdict = parseVerdict(reply.value)
      } catch (error) {
        parseError = errorMessage(error)
      }
    }

    const exchangePath = recordExchange(
      root,
      input.sessionId,
      input.taskId,
      round,
      prompt,
      reply,
      parseError,
    )

    if (!verdict) {
      const error =
        parseError ?? reply.error ?? 'The arbiter returned no verdict.'

      appendArbiterRecord(root, {
        ...base,
        round,
        verdict: null,
        result: 'evaluator_failed',
        error,
        exchange_path: exchangePath,
      })
      priorRounds.push({ verdict: null, error })
      continue
    }

    if (verdict.verdict === 'hard_block') {
      appendArbiterRecord(root, {
        ...base,
        round,
        verdict,
        result: 'hard_block',
        exchange_path: exchangePath,
      })

      return {
        outcome: 'hard_block',
        hard_block: verdict.hard_block as HorizonHardBlock,
        reasoning: verdict.reasoning,
      }
    }

    const action = verdict.action as ArbiterAction

    if (action.type === 'restart-task') {
      appendArbiterRecord(root, {
        ...base,
        round,
        verdict,
        result: 'applied',
        exchange_path: exchangePath,
      })

      return { outcome: 'restart', action, reasoning: verdict.reasoning }
    }

    if (!input.run) {
      const error = 'The task has no run, so only restart-task can apply.'

      appendArbiterRecord(root, {
        ...base,
        round,
        verdict,
        result: 'apply_failed',
        error,
        exchange_path: exchangePath,
      })
      priorRounds.push({ verdict, error })
      continue
    }

    try {
      applyArbiterAction(root, input.run, action, verdict.reasoning)
      appendArbiterRecord(root, {
        ...base,
        round,
        verdict,
        result: 'applied',
        exchange_path: exchangePath,
      })

      return { outcome: 'continued', action, reasoning: verdict.reasoning }
    } catch (error) {
      const message = errorMessage(error)

      appendArbiterRecord(root, {
        ...base,
        round,
        verdict,
        result: 'apply_failed',
        error: message,
        exchange_path: exchangePath,
      })
      priorRounds.push({ verdict, error: message })
    }
  }

  // The arbiter could not act in its rounds. A deterministic re-attempt is
  // still an override rather than a deferral: the stop has not been named a
  // hard block, so the run is nudged forward and the next stop is arbitrated
  // again. Only when even that fails is the task recorded as a harness
  // failure.
  const fallback: ArbiterAction = {
    type: 'resume',
    note: `The arbiter reached no applicable verdict in ${ARBITER_ROUNDS} rounds; re-attempt the stage and record what stops it.`,
  }

  if (
    input.run &&
    input.run.status !== 'succeeded' &&
    input.run.status !== 'failed'
  ) {
    try {
      applyArbiterAction(
        root,
        input.run,
        fallback,
        'Deterministic re-attempt after the arbiter rounds were spent.',
      )
      appendArbiterRecord(root, {
        ...base,
        round: ARBITER_ROUNDS + 1,
        verdict: null,
        result: 'fallback_applied',
        exchange_path: null,
      })

      return {
        outcome: 'continued',
        action: fallback,
        reasoning:
          'Deterministic re-attempt after the arbiter rounds were spent.',
      }
    } catch (error) {
      const message = errorMessage(error)

      appendArbiterRecord(root, {
        ...base,
        round: ARBITER_ROUNDS + 1,
        verdict: null,
        result: 'harness_unrecoverable',
        error: message,
        exchange_path: null,
      })

      return {
        outcome: 'harness_unrecoverable',
        reason: `The arbiter and its fallback could not act: ${message}`,
      }
    }
  }

  // A terminal or absent run accepts no in-run action, so the deterministic
  // fallback reopens the task from its stored request. The override bound
  // above is what keeps a task that fails the same way every time from
  // reopening forever.
  const restart: ArbiterAction = {
    type: 'restart-task',
    note: `The arbiter reached no applicable verdict in ${ARBITER_ROUNDS} rounds; reopen the task from its request.`,
  }

  appendArbiterRecord(root, {
    ...base,
    round: ARBITER_ROUNDS + 1,
    verdict: null,
    result: 'fallback_applied',
    exchange_path: null,
  })

  return {
    outcome: 'restart',
    action: restart,
    reasoning:
      'Deterministic reopen after the arbiter rounds were spent on a run that accepts no in-run action.',
  }
}

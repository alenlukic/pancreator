import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { invariant } from './errors.js'
import { makeWorkflowRunId } from './naming.js'
import {
  appendJsonLine,
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
  writeJsonAtomic,
} from './io.js'
import type { RunState } from './types.js'

export function now(): string {
  return new Date().toISOString()
}

export function makeRunId(): string {
  return makeWorkflowRunId()
}

export function runDir(root: string, runId: string): string {
  return path.join(root, 'runtime', 'logs', 'workflows', runId)
}

export function statePath(root: string, runId: string): string {
  return path.join(runDir(root, runId), 'state.json')
}

export function eventPath(root: string, runId: string): string {
  return path.join(runDir(root, runId), 'events.jsonl')
}

export function nextStageSequence(root: string, runId: string): number {
  const eventsFile = eventPath(root, runId)

  if (!fileExists(eventsFile)) {
    return 0
  }

  let sequence = 0

  for (const line of readText(eventsFile).split('\n')) {
    if (line.trim().length === 0) {
      continue
    }

    const event: unknown = JSON.parse(line)

    if (
      isRecord(event) &&
      (event.type === 'invocation_prepared' ||
        event.type === 'harness_stage_executed')
    ) {
      sequence += 1
    }
  }

  return sequence
}

export function operationMutexPath(root: string, runId: string): string {
  invariant(fileExists(statePath(root, runId)), `Unknown run: ${runId}`, {
    code: 'RUN_NOT_FOUND',
  })

  return path.join(runDir(root, runId), '.operation-mutex')
}

export function indexPath(stateRoot: string): string {
  return path.join(stateRoot, 'workspace', 'index.json')
}

export function baselinePath(stateRoot: string, runId: string): string {
  return path.join(stateRoot, 'workflows', runId, 'baseline.json')
}

export function ledgerValidationPath(stateRoot: string, runId: string): string {
  return path.join(stateRoot, 'workflows', runId, 'ledger-validation.json')
}

function parseRunState(value: unknown, source: string): RunState {
  invariant(isRecord(value), `${source} MUST contain a state object.`, {
    code: 'INVALID_STATE',
  })
  invariant(value.schema_version === 1, `${source} schema_version MUST be 1.`, {
    code: 'INVALID_STATE',
  })

  for (const key of ['run_id', 'workflow_slug', 'title', 'status'] as const) {
    invariant(
      typeof value[key] === 'string' && value[key].length > 0,
      `${source}.${key} MUST be a non-empty string.`,
      { code: 'INVALID_STATE' },
    )
  }

  invariant(
    isRecord(value.pending_action),
    `${source}.pending_action MUST be an object.`,
    { code: 'INVALID_STATE' },
  )
  invariant(
    Array.isArray(value.stage_history),
    `${source}.stage_history MUST be an array.`,
    { code: 'INVALID_STATE' },
  )
  invariant(isRecord(value.attempts), `${source}.attempts MUST be an object.`, {
    code: 'INVALID_STATE',
  })

  return value as unknown as RunState
}

/**
 * Load materialized state and recover from a newer write-ahead event when the
 * last event contains a higher revision than state.json.
 */
export function loadState(root: string, runId: string): RunState {
  const filePath = statePath(root, runId)

  invariant(fileExists(filePath), `Unknown run: ${runId}`, {
    code: 'RUN_NOT_FOUND',
  })

  let state = parseRunState(readJson(filePath), filePath)
  const eventsFile = eventPath(root, runId)

  if (!fileExists(eventsFile)) {
    return state
  }

  const lines = readText(eventsFile).trim().split('\n').filter(Boolean)

  if (lines.length === 0) {
    return state
  }

  const latestValue: unknown = JSON.parse(lines.at(-1) ?? '{}')

  if (!isRecord(latestValue) || !isRecord(latestValue.state_after)) {
    return state
  }

  const recovered = parseRunState(
    latestValue.state_after,
    `${eventsFile}:latest.state_after`,
  )

  if (recovered.revision > state.revision) {
    state = recovered
    writeJsonAtomic(filePath, state)
  }

  return state
}

/**
 * Append a write-ahead event with the full post-state, atomically replace
 * state.json, and mirror a compact event to the orchestrator-wide log.
 */
export function persist(
  root: string,
  state: RunState,
  eventType: string,
  payload: Record<string, unknown> = {},
): void {
  state.revision += 1
  state.updated_at = now()

  const event = {
    schema_version: 1,
    event_id: randomUUID(),
    type: eventType,
    timestamp: state.updated_at,
    run_id: state.run_id,
    revision: state.revision,
    ...payload,
    state_after: structuredClone(state),
  }

  appendJsonLine(eventPath(root, state.run_id), event)
  writeJsonAtomic(statePath(root, state.run_id), state)
  appendJsonLine(
    path.join(root, 'runtime', 'logs', 'orchestrator', 'events.jsonl'),
    {
      timestamp: state.updated_at,
      run_id: state.run_id,
      type: eventType,
      status: state.status,
      stage: state.current_stage,
    },
  )
}

/**
 * Write an operator-facing decision record and point the state at it.
 * Returns the repository-relative path.
 */
export function writeDecision(
  root: string,
  state: RunState,
  title: string,
  reasoning: string,
  actionItems: string[] = [],
): string {
  const decisionId = randomUUID()
  const relative =
    `runtime/logs/workflows/${state.run_id}/decisions/` + `${decisionId}.json`
  const decision = {
    $operator: {
      headline: title,
      status: 'paused',
      next_action:
        actionItems[0] ?? 'Inspect the run and decide how to continue.',
    },
    schema_version: 1,
    decision_id: decisionId,
    timestamp: now(),
    run_id: state.run_id,
    stage: state.current_stage,
    title,
    reasoning,
    action_items: actionItems,
  }

  writeJsonAtomic(resolveInside(root, relative), decision)
  state.last_decision_path = relative

  return relative
}

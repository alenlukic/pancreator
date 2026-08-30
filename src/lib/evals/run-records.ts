import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { PanError } from '../errors.js'
import { fileExists, isRecord, readJson, readText } from '../io.js'
import { resolveRunLayout, type RunLayout } from '../run-layout.js'
import type { RunState, StageOutput } from '../types.js'

/**
 * Read-only view over one run's records. Graders read this, never the engine,
 * so a grade can never mutate the run. Every path is harness-relative so a
 * report stays meaningful after the checkout moves.
 */

export interface RunEvent {
  type: string
  [key: string]: unknown
}

export interface RunOutputRecord {
  invocation_id: string
  path: string
  output: StageOutput
}

export interface RunRecords {
  root: string
  run_id: string
  layout: RunLayout
  state: RunState
  events: RunEvent[]
  outputs: RunOutputRecord[]
  /** Harness-relative paths of every file under agent/evidence. */
  evidence_paths: string[]
  /** Harness-relative paths of every file under agent/validations. */
  validation_paths: string[]
  /** Harness-relative paths of every file under agent/invocations. */
  invocation_paths: string[]
  /** Harness-relative paths of every file under agent/decisions. */
  decision_paths: string[]
  /** Harness-relative paths of every file under agent/artifacts/json. */
  artifact_json_paths: string[]
}

function listRelative(root: string, directory: string): string[] {
  if (!existsSync(directory)) {
    return []
  }

  return readdirSync(directory)
    .filter((entry) => !entry.startsWith('.'))
    .sort()
    .map((entry) =>
      path
        .relative(root, path.join(directory, entry))
        .split(path.sep)
        .join('/'),
    )
}

export function loadRunRecords(root: string, runId: string): RunRecords {
  const layout = resolveRunLayout(root, runId)

  if (!fileExists(layout.state.absolute)) {
    throw new PanError(`Run not found: ${runId}`, { code: 'RUN_NOT_FOUND' })
  }

  const state = readJson(layout.state.absolute) as RunState
  const events: RunEvent[] = []

  if (fileExists(layout.events.absolute)) {
    for (const line of readText(layout.events.absolute).split('\n')) {
      if (line.trim().length === 0) {
        continue
      }

      try {
        const parsed = JSON.parse(line) as unknown

        if (isRecord(parsed) && typeof parsed.type === 'string') {
          events.push(parsed as RunEvent)
        }
      } catch {
        // A torn final line is not a grading failure; the state file is
        // authoritative and the graders report what they could read.
      }
    }
  }

  const outputsDirectory = path.join(layout.agent.absolute, 'outputs')
  const outputs: RunOutputRecord[] = []

  for (const relative of listRelative(root, outputsDirectory)) {
    if (!relative.endsWith('.json')) {
      continue
    }

    try {
      const output = readJson(path.join(root, relative))

      if (isRecord(output) && typeof output.invocation_id === 'string') {
        outputs.push({
          invocation_id: output.invocation_id,
          path: relative,
          output: output as unknown as StageOutput,
        })
      }
    } catch {
      // An unreadable output is reported by the graders that need it.
    }
  }

  return {
    root,
    run_id: runId,
    layout,
    state,
    events,
    outputs,
    evidence_paths: listRelative(
      root,
      path.join(layout.agent.absolute, 'evidence'),
    ),
    validation_paths: listRelative(
      root,
      path.join(layout.agent.absolute, 'validations'),
    ),
    invocation_paths: listRelative(
      root,
      path.join(layout.agent.absolute, 'invocations'),
    ),
    decision_paths: listRelative(
      root,
      path.join(layout.agent.absolute, 'decisions'),
    ),
    artifact_json_paths: listRelative(
      root,
      path.join(layout.agent.absolute, 'artifacts', 'json'),
    ),
  }
}

/** Output submitted for one invocation, when it exists. */
export function outputForInvocation(
  records: RunRecords,
  invocationId: string,
): RunOutputRecord | undefined {
  return records.outputs.find((item) => item.invocation_id === invocationId)
}

/** Latest stage_history entry for a stage, or undefined. */
export function latestHistoryForStage(records: RunRecords, stage: string) {
  return [...records.state.stage_history]
    .reverse()
    .find((item) => item.stage === stage)
}

/** Read a dot-path such as `evaluation.verdict` out of a record. */
export function readDotPath(value: unknown, dotPath: string): unknown {
  let current: unknown = value

  for (const segment of dotPath.split('.')) {
    if (!isRecord(current)) {
      return undefined
    }

    current = current[segment]
  }

  return current
}

/**
 * Every string an agent wrote into an output: summary, criteria evidence and
 * explanations, risks, unknowns, and every string nested under data. This is
 * the complete agent-authored text a grader can observe; worker transcripts
 * are not run records.
 */
export function outputStrings(output: StageOutput): string[] {
  const strings: string[] = []
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      strings.push(value)
      return
    }

    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }

    if (isRecord(value)) {
      Object.values(value).forEach(visit)
    }
  }

  visit(output.summary)
  visit(output.criteria)
  visit(output.risks)
  visit(output.unknowns)
  visit(output.data)

  return strings
}

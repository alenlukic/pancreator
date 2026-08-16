import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { invariant } from './errors.js'
import {
  RUN_SUFFIX_MAX_LENGTH,
  keywordRunSuffix,
  makeWorkflowRunId,
} from './naming.js'
import {
  appendJsonLine,
  clearStaleOperationMutex,
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
  sha256,
  writeJsonAtomic,
} from './io.js'
import { resolveRunLayout } from './run-layout.js'
import { loadProjectConfig } from './project-config.js'
import type { RunState } from './types.js'

const DEFAULT_STATE_SIZE_BUDGET_BYTES = 1024 * 1024
const MAX_EVENT_LINE_BYTES = 64 * 1024
const PERSISTED_DELTA_PREVIEW_LIMIT = 10
export const DEFAULT_STAGE_LIVENESS_MS = 30 * 60 * 1000

export function now(): string {
  return new Date().toISOString()
}

export function makeRunId(seed?: string): string {
  const suffix = seed === undefined ? null : keywordRunSuffix(seed)

  return suffix === null
    ? makeWorkflowRunId()
    : makeWorkflowRunId(new Date(), suffix)
}

/**
 * Run ID whose keyword suffix is deduplicated against sibling directories.
 *
 * Keyword suffixes are not unique the way UUID fragments were: two runs
 * created from the same request in the same UTC minute (best-of-N candidates
 * do exactly this) would collide. Ordinal suffixes keep the keywords; the
 * UUID fallback keeps creation collision-free when ordinals are exhausted.
 */
export function makeUniqueRunId(
  parentDirectory: string,
  suffixSeed: string | null,
  at = new Date(),
): string {
  if (suffixSeed !== null) {
    const stem = suffixSeed
      .slice(0, RUN_SUFFIX_MAX_LENGTH - 2)
      .replace(/-+$/u, '')
    const candidates = [
      suffixSeed,
      ...Array.from({ length: 8 }, (_, index) => `${stem}-${index + 2}`),
    ]

    for (const suffix of candidates) {
      const id = makeWorkflowRunId(at, suffix)

      if (!fileExists(path.join(parentDirectory, id))) {
        return id
      }
    }
  }

  return makeWorkflowRunId(at)
}

/** Derive liveness for the active worker invocation without mutating run state. */
export function invocationLiveness(
  state: RunState,
  currentTime = Date.now(),
  staleAfterMs = DEFAULT_STAGE_LIVENESS_MS,
): NonNullable<RunState['invocation_liveness']> | null {
  const invocation = state.current_invocation
  const lastActivity = invocation?.last_activity_at ?? invocation?.prepared_at

  // Liveness is meaningful only while the run is waiting on a delegated
  // worker. current_invocation survives into pauses and operator/supervisor
  // waits, where "stale, re-deliver the card" advice is impossible to follow.
  if (
    !invocation ||
    !lastActivity ||
    state.pending_action?.type !== 'invoke_agent'
  ) {
    return null
  }

  const parsed = Date.parse(lastActivity)
  const ageMs = Number.isFinite(parsed)
    ? Math.max(0, currentTime - parsed)
    : Number.POSITIVE_INFINITY

  return {
    status: ageMs > staleAfterMs ? 'stale' : 'active',
    last_activity_at: lastActivity,
    stale_after_ms: staleAfterMs,
    age_ms: ageMs,
  }
}

export function runDir(root: string, runId: string): string {
  return resolveRunLayout(root, runId).agent.absolute
}

export function statePath(root: string, runId: string): string {
  return resolveRunLayout(root, runId).state.absolute
}

export function eventPath(root: string, runId: string): string {
  return resolveRunLayout(root, runId).events.absolute
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

  return resolveRunLayout(root, runId).operationMutex.absolute
}

function parseRunState(value: unknown, source: string): RunState {
  invariant(isRecord(value), `${source} MUST contain a state object.`, {
    code: 'INVALID_STATE',
  })
  invariant(
    value.schema_version === 1 || value.schema_version === 2,
    `${source} schema_version MUST be 1 or 2.`,
    {
      code: 'INVALID_STATE',
    },
  )

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

function stateFromEvent(
  root: string,
  event: Record<string, unknown>,
  source: string,
): RunState | null {
  if (isRecord(event.state_after)) {
    return parseRunState(event.state_after, `${source}.state_after`)
  }

  if (
    !isRecord(event.state_ref) ||
    typeof event.state_ref.path !== 'string' ||
    typeof event.state_ref.sha256 !== 'string'
  ) {
    return null
  }

  const stateReferencePath = resolveInside(root, event.state_ref.path)

  if (!fileExists(stateReferencePath)) {
    return null
  }

  const referenced = readJson(stateReferencePath)

  invariant(
    sha256(referenced) === event.state_ref.sha256,
    `${source}.state_ref checksum mismatch.`,
    { code: 'INVALID_STATE' },
  )

  return parseRunState(referenced, `${source}.state_ref`)
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

  clearStaleOperationMutex(
    resolveRunLayout(root, runId).operationMutex.absolute,
  )

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

  if (!isRecord(latestValue)) {
    return state
  }

  // Dereference the write-ahead artifact only when the event log is actually
  // ahead of state.json. An unconditional dereference makes every read verify
  // (and depend on) the latest revision artifact, so one corrupt artifact
  // would brick status, resume, and archive even though recovery is unneeded.
  if (
    typeof latestValue.revision === 'number' &&
    latestValue.revision <= state.revision
  ) {
    return state
  }

  const recovered = stateFromEvent(root, latestValue, `${eventsFile}:latest`)

  if (recovered && recovered.revision > state.revision) {
    state = recovered
    writeJsonAtomic(filePath, state)
  }

  return state
}

/** Load one recoverable workflow-state revision from the materialized state or event references. */
export function loadStateRevision(
  root: string,
  runId: string,
  revision: number,
): RunState {
  invariant(
    Number.isInteger(revision) && revision >= 0,
    'State revision MUST be a non-negative integer.',
    { code: 'INVALID_ARGUMENT' },
  )

  const filePath = statePath(root, runId)

  invariant(fileExists(filePath), `Unknown run: ${runId}`, {
    code: 'RUN_NOT_FOUND',
  })

  const materialized = parseRunState(readJson(filePath), filePath)

  if (materialized.revision === revision) {
    return materialized
  }

  const eventsFile = eventPath(root, runId)

  invariant(
    fileExists(eventsFile),
    `State revision ${revision} is unavailable for run ${runId}.`,
    { code: 'STATE_REVISION_UNAVAILABLE' },
  )

  for (const [index, line] of readText(eventsFile).split('\n').entries()) {
    if (line.trim().length === 0) {
      continue
    }

    const event: unknown = JSON.parse(line)

    if (!isRecord(event) || event.revision !== revision) {
      continue
    }

    const recovered = stateFromEvent(
      root,
      event,
      `${eventsFile}:line ${index + 1}`,
    )

    invariant(
      recovered,
      `State revision ${revision} is unavailable for run ${runId}.`,
      { code: 'STATE_REVISION_UNAVAILABLE' },
    )

    return recovered
  }

  invariant(
    false,
    `State revision ${revision} is unavailable for run ${runId}.`,
    {
      code: 'STATE_REVISION_UNAVAILABLE',
    },
  )
}

/**
 * Externalize uncapped repository-check deltas before state persistence.
 */
function externalizeRepositoryCheckDeltas(root: string, state: RunState): void {
  const layout = resolveRunLayout(root, state.run_id)

  for (const history of state.stage_history) {
    for (const result of history.deterministic) {
      const delta = result.repository_check_delta

      if (!delta?.full) {
        continue
      }

      const digest = sha256(delta.full)
      const artifact = layout.artifactJson(
        `repository-check-delta-${digest}.json`,
      )

      if (!fileExists(artifact.absolute)) {
        writeJsonAtomic(artifact.absolute, {
          schema_version: 1,
          sha256: digest,
          delta: delta.full,
        })
      }

      delta.full_delta_ref = {
        sha256: digest,
        path: artifact.relative,
        counts: delta.counts ?? {
          new: delta.full.new.length,
          fixed: delta.full.fixed.length,
          carried: delta.full.carried.length,
        },
      }
      delta.new = delta.new.slice(0, PERSISTED_DELTA_PREVIEW_LIMIT)
      delta.fixed = delta.fixed.slice(0, PERSISTED_DELTA_PREVIEW_LIMIT)
      delta.carried = delta.carried.slice(0, PERSISTED_DELTA_PREVIEW_LIMIT)
      delete delta.full
    }
  }
}

function writeStateReference(
  root: string,
  state: RunState,
): { sha256: string; path: string } {
  // Digest the JSON round-trip of the state, not the in-memory object: an
  // undefined-valued key serializes in stableStringify but is dropped from the
  // written file, so hashing the live object records a digest the artifact can
  // never reproduce and every later load fails its checksum.
  const persisted = JSON.parse(JSON.stringify(state)) as RunState
  const digest = sha256(persisted)
  const artifact = resolveRunLayout(root, state.run_id).artifactJson(
    `state-revision-${state.revision}-${digest}.json`,
  )

  if (!fileExists(artifact.absolute)) {
    writeJsonAtomic(artifact.absolute, persisted)
  }

  return { sha256: digest, path: artifact.relative }
}

/**
 * Append a revision event with a content-addressed state reference, atomically
 * replace state.json, and mirror a compact event to the orchestrator-wide log.
 */
const RESERVED_EVENT_KEYS = [
  'schema_version',
  'event_id',
  'type',
  'timestamp',
  'run_id',
  'revision',
  'state_sha256',
  'state_ref',
  'payload_ref',
] as const

export function persist(
  root: string,
  state: RunState,
  eventType: string,
  payload: Record<string, unknown> = {},
): void {
  const collision = RESERVED_EVENT_KEYS.find((key) => key in payload)

  invariant(
    collision === undefined,
    `Event payload for '${eventType}' MUST NOT set reserved envelope key '${collision}'.`,
    { code: 'RESERVED_EVENT_KEY', details: { key: collision } },
  )

  state.schema_version = 2
  state.revision += 1
  state.updated_at = now()

  if (state.current_invocation) {
    state.current_invocation.last_activity_at = state.updated_at
  }

  externalizeRepositoryCheckDeltas(root, state)

  const stateSizeBudgetBytes =
    loadProjectConfig(root).state_size_budget_bytes ??
    DEFAULT_STATE_SIZE_BUDGET_BYTES
  const stateBytes = Buffer.byteLength(JSON.stringify(state), 'utf8')

  invariant(
    stateBytes <= stateSizeBudgetBytes,
    `Run state exceeds the ${stateSizeBudgetBytes}-byte budget after compaction. ` +
      `Raise config.json state_size_budget_bytes to record this transition, ` +
      `then report the oversized payload as a harness defect.`,
    {
      code: 'STATE_SIZE_BUDGET_EXCEEDED',
      details: { state_bytes: stateBytes },
    },
  )

  const stateReference = writeStateReference(root, state)
  let event: Record<string, unknown> = {
    schema_version: 1,
    event_id: randomUUID(),
    type: eventType,
    timestamp: state.updated_at,
    run_id: state.run_id,
    revision: state.revision,
    ...payload,
    state_sha256: stateReference.sha256,
    state_ref: stateReference,
  }

  // The appended line carries a trailing newline, so budget for it here to
  // keep every physical event-log line under the cap.
  if (
    Buffer.byteLength(JSON.stringify(event), 'utf8') + 1 >=
    MAX_EVENT_LINE_BYTES
  ) {
    const payloadDigest = sha256(payload)
    const payloadArtifact = resolveRunLayout(root, state.run_id).artifactJson(
      `event-payload-${payloadDigest}.json`,
    )

    if (!fileExists(payloadArtifact.absolute)) {
      writeJsonAtomic(payloadArtifact.absolute, payload)
    }

    event = {
      schema_version: 1,
      event_id: event.event_id,
      type: eventType,
      timestamp: state.updated_at,
      run_id: state.run_id,
      revision: state.revision,
      payload_ref: {
        sha256: payloadDigest,
        path: payloadArtifact.relative,
      },
      state_sha256: stateReference.sha256,
      state_ref: stateReference,
    }
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
  const relative = resolveRunLayout(root, state.run_id).decision(
    `${decisionId}.json`,
  ).relative
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

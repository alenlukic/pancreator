import { randomUUID } from 'node:crypto'
import { readdirSync } from 'node:fs'
import path from 'node:path'

import { invariant } from './errors.js'
import {
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
  sha256,
  withOperationMutex,
} from './io.js'
import { loadState, operationMutexPath, persist } from './state.js'
import type { Invocation, RunState } from './types.js'
import { panCommand } from './project-config.js'
import { isInvocationContext } from './policy-delivery.js'
import { resolveRunLayout } from './run-layout.js'

export interface ProceduralExceptionInput {
  schema_version: 1
  client_id: string
  affected: string
  classification: 'harness_defect' | 'procedural_exception' | 'product_failure'
  observed_defect: string
  evidence: string[]
  workaround: string
  justification: string
  preserved_constraints: string[]
  outcome?: string
  required_follow_up?: string
}

export interface ExceptionActor {
  identity: string
  role: 'worker' | 'evidence-worker' | 'supervisor'
  invocation_id: string
  evidence_role?: string
  source: string
}

export interface ProceduralException extends ProceduralExceptionInput {
  id: string
  timestamp: string
  run_id: string
  actor: ExceptionActor
  resolution?: {
    timestamp: string
    actor: ExceptionActor
    outcome: string
    evidence: string[]
  }
}

const INPUT_FIELDS = new Set([
  'schema_version',
  'client_id',
  'affected',
  'classification',
  'observed_defect',
  'evidence',
  'workaround',
  'justification',
  'preserved_constraints',
  'outcome',
  'required_follow_up',
])

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonempty)
}

function readActor(value: unknown): ExceptionActor {
  invariant(
    isRecord(value) &&
      nonempty(value.identity) &&
      (value.role === 'worker' ||
        value.role === 'evidence-worker' ||
        value.role === 'supervisor') &&
      nonempty(value.invocation_id) &&
      nonempty(value.source) &&
      (value.evidence_role === undefined || nonempty(value.evidence_role)),
    'Malformed persisted exception actor.',
    { code: 'EXCEPTION_EVENT_CORRUPT' },
  )
  return {
    identity: value.identity,
    role: value.role,
    invocation_id: value.invocation_id,
    source: value.source,
    ...(nonempty(value.evidence_role)
      ? { evidence_role: value.evidence_role }
      : {}),
  }
}

/** Validate shape, never whether a justification authorizes an action. */
export function validateProceduralException(
  value: unknown,
): ProceduralExceptionInput {
  invariant(
    isRecord(value) &&
      Object.keys(value).every((key) => INPUT_FIELDS.has(key)) &&
      value.schema_version === 1 &&
      [
        'client_id',
        'affected',
        'observed_defect',
        'workaround',
        'justification',
      ].every((key) => nonempty(value[key])) &&
      ['harness_defect', 'procedural_exception', 'product_failure'].includes(
        String(value.classification),
      ) &&
      strings(value.evidence) &&
      strings(value.preserved_constraints) &&
      (value.outcome === undefined || nonempty(value.outcome)) &&
      (value.required_follow_up === undefined ||
        nonempty(value.required_follow_up)) &&
      (nonempty(value.outcome) || nonempty(value.required_follow_up)),
    'Procedural exception requires version 1, a client id, affected rule, classification, defect, evidence, workaround, justification, preserved constraints, and an outcome or follow-up. Authority and status mutation fields are forbidden.',
    { code: 'EXCEPTION_INVALID' },
  )
  return {
    schema_version: 1,
    client_id: String(value.client_id),
    affected: String(value.affected),
    classification:
      value.classification as ProceduralExceptionInput['classification'],
    observed_defect: String(value.observed_defect),
    evidence: value.evidence as string[],
    workaround: String(value.workaround),
    justification: String(value.justification),
    preserved_constraints: value.preserved_constraints as string[],
    ...(nonempty(value.outcome) ? { outcome: value.outcome } : {}),
    ...(nonempty(value.required_follow_up)
      ? { required_follow_up: value.required_follow_up }
      : {}),
  }
}

/** Derive attribution from a declared artifact, never from submitted actor fields. */
export function exceptionActor(
  root: string,
  state: RunState,
  artifact: string,
): ExceptionActor {
  const absolute = resolveInside(root, artifact)
  const source = path.relative(root, absolute).split(path.sep).join('/')
  const samePath = (candidate: string): boolean =>
    resolveInside(root, candidate) === absolute
  const layout = resolveRunLayout(root, state.run_id)
  const evidenceDirectory = layout.evidence('.').absolute
  if (
    path.dirname(absolute) === evidenceDirectory &&
    path.basename(absolute).startsWith('supervisor-exception-') &&
    absolute.endsWith('.json')
  ) {
    return {
      identity: 'orchestrator',
      role: 'supervisor',
      invocation_id: `supervisor-${state.run_id}`,
      source,
    }
  }
  const directory = path.dirname(layout.invocation('', '.json').absolute)
  const candidates = fileExists(directory)
    ? readdirSync(directory)
        .filter((name) => name.endsWith('.json'))
        .map((name) => path.join(directory, name))
    : []
  if (state.current_invocation) {
    candidates.unshift(resolveInside(root, state.current_invocation.json_path))
  }
  for (const candidate of new Set(candidates)) {
    const invocation: unknown = readJson(candidate)
    if (!isInvocationContext(invocation) || invocation.run_id !== state.run_id)
      continue
    if (samePath(invocation.output.path)) {
      return {
        identity: invocation.stage.persona,
        role: 'worker',
        invocation_id: invocation.invocation_id,
        source,
      }
    }
    for (const worker of invocation.evidence_workers ?? []) {
      if (
        [
          worker.evidence_path,
          ...(worker.attempts ?? []).map((attempt) => attempt.evidence_path),
        ].some(samePath)
      ) {
        return {
          identity: worker.persona,
          role: 'evidence-worker',
          invocation_id: invocation.invocation_id,
          evidence_role: worker.role,
          source,
        }
      }
    }
    if (
      path.dirname(absolute) === evidenceDirectory &&
      path.basename(absolute).startsWith(`${invocation.invocation_id}-`) &&
      absolute.endsWith('.json')
    )
      return {
        identity: invocation.stage.persona,
        role: 'worker',
        invocation_id: invocation.invocation_id,
        source,
      }
  }
  invariant(
    false,
    'Exception source must be a declared output/report or invocation-prefixed JSON evidence file.',
    { code: 'EXCEPTION_PATH_FORBIDDEN' },
  )
}

function eventPayload(
  root: string,
  runId: string,
  event: Record<string, unknown>,
): Record<string, unknown> {
  if (!isRecord(event.payload_ref)) return event
  invariant(
    nonempty(event.payload_ref.path) && nonempty(event.payload_ref.sha256),
    'Exception event payload reference is malformed.',
    { code: 'EXCEPTION_EVENT_CORRUPT' },
  )
  const payload = readJson(retainedPath(root, runId, event.payload_ref.path))
  invariant(
    isRecord(payload) && sha256(payload) === event.payload_ref.sha256,
    'Exception event payload digest does not match.',
    { code: 'EXCEPTION_EVENT_CORRUPT' },
  )
  return payload
}

function retainedPath(root: string, runId: string, file: string): string {
  const absolute = resolveInside(root, file)
  if (fileExists(absolute)) return absolute
  const prefix = `runtime/logs/workflows/${runId}/`
  const relative = path.relative(root, absolute).split(path.sep).join('/')
  return relative.startsWith(prefix)
    ? resolveInside(
        root,
        `runtime/logs/workflows/archive/${runId}/${relative.slice(prefix.length)}`,
      )
    : absolute
}

/** Reconstruct the ledger from authoritative events, including externalized payloads. */
export function listProceduralExceptions(
  root: string,
  runId: string,
  options: { unresolved?: boolean; id?: string } = {},
): ProceduralException[] {
  const ledger = new Map<string, ProceduralException>()
  const active = resolveRunLayout(root, runId)
  const archivedRoot = path.join(root, 'runtime/logs/workflows/archive', runId)
  const events = fileExists(active.events.absolute)
    ? active.events.absolute
    : ([
        path.join(archivedRoot, 'agent/events.jsonl'),
        path.join(archivedRoot, 'events.jsonl'),
      ].find(fileExists) ?? active.events.absolute)
  if (!fileExists(events)) return []
  for (const line of readText(events)
    .split('\n')
    .filter((item) => item.trim())) {
    const event: unknown = JSON.parse(line)
    invariant(isRecord(event), 'Malformed exception event envelope.', {
      code: 'EXCEPTION_EVENT_CORRUPT',
    })
    if (
      event.type !== 'procedural_exception_recorded' &&
      event.type !== 'procedural_exception_resolved'
    )
      continue
    const payload = eventPayload(root, runId, event)
    if (event.type === 'procedural_exception_recorded') {
      invariant(
        isRecord(payload.entry) &&
          nonempty(payload.entry.id) &&
          nonempty(payload.entry.timestamp) &&
          payload.entry.run_id === runId,
        'Malformed exception record.',
        { code: 'EXCEPTION_EVENT_CORRUPT' },
      )
      const { id, timestamp, run_id, actor, ...input } = payload.entry
      ledger.set(id, {
        ...validateProceduralException(input),
        id,
        timestamp,
        run_id,
        actor: readActor(actor),
      })
    } else {
      invariant(
        nonempty(payload.entry_id) &&
          isRecord(payload.resolution) &&
          ledger.has(payload.entry_id),
        'Exception resolution has no matching record.',
        { code: 'EXCEPTION_EVENT_CORRUPT' },
      )
      const entry = ledger.get(payload.entry_id)!
      const resolution = payload.resolution
      invariant(
        nonempty(resolution.timestamp) &&
          nonempty(resolution.outcome) &&
          strings(resolution.evidence),
        'Malformed exception resolution.',
        { code: 'EXCEPTION_EVENT_CORRUPT' },
      )
      entry.resolution = {
        timestamp: resolution.timestamp,
        actor: readActor(resolution.actor),
        outcome: resolution.outcome,
        evidence: resolution.evidence,
      }
    }
  }
  return [...ledger.values()].filter(
    (entry) =>
      (!options.id || entry.id === options.id) &&
      (!options.unresolved || !entry.resolution),
  )
}

export function proceduralExceptionContext(
  root: string,
  runId: string,
  persona?: string,
): NonNullable<Invocation['procedural_exception_context']> {
  return {
    command: `${panCommand(root)} exception list ${runId} --unresolved`,
    unresolved: listProceduralExceptions(root, runId, { unresolved: true })
      .filter(
        (entry) =>
          !persona ||
          entry.actor.identity === persona ||
          entry.classification === 'harness_defect',
      )
      .slice(-5)
      .map((entry) => ({
        id: entry.id,
        affected: entry.affected.slice(0, 160),
        follow_up: (entry.required_follow_up ?? entry.outcome ?? '').slice(
          0,
          240,
        ),
      })),
  }
}

/** Caller holds the run mutex. Submission must not acquire it recursively. */
export function recordProceduralExceptionLocked(
  root: string,
  state: RunState,
  actor: ExceptionActor,
  value: unknown,
): ProceduralException {
  const trustedActor = exceptionActor(root, state, actor.source)
  invariant(
    sha256(actor) === sha256(trustedActor),
    'Exception actor must match its declared source.',
    { code: 'EXCEPTION_ACTOR_INVALID' },
  )
  const input = validateProceduralException(value)
  const previous = listProceduralExceptions(root, state.run_id).find(
    (entry) =>
      entry.client_id === input.client_id &&
      entry.actor.invocation_id === actor.invocation_id &&
      entry.actor.identity === actor.identity &&
      entry.actor.evidence_role === actor.evidence_role,
  )
  if (previous) {
    const {
      id: _id,
      timestamp: _timestamp,
      run_id: _run,
      actor: _actor,
      resolution: _resolution,
      ...original
    } = previous
    invariant(
      sha256(original) === sha256(input),
      'Client id was already used for a different exception.',
      { code: 'EXCEPTION_REPLAY_CONFLICT' },
    )
    return previous
  }
  const entry: ProceduralException = {
    ...input,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    run_id: state.run_id,
    actor,
  }
  persist(root, state, 'procedural_exception_recorded', { entry })
  return entry
}

export function recordProceduralException(
  root: string,
  runId: string,
  file: string,
): ProceduralException {
  return withOperationMutex(
    operationMutexPath(root, runId),
    () => {
      const state = loadState(root, runId)
      return recordProceduralExceptionLocked(
        root,
        state,
        exceptionActor(root, state, file),
        readJson(resolveInside(root, file)),
      )
    },
    { waitForHolderMs: 10_000 },
  )
}

export function resolveProceduralException(
  root: string,
  runId: string,
  entryId: string,
  file: string,
): ProceduralException {
  return withOperationMutex(
    operationMutexPath(root, runId),
    () => {
      const state = loadState(root, runId)
      const actor = exceptionActor(root, state, file)
      const value = readJson(resolveInside(root, file))
      invariant(
        isRecord(value) &&
          Object.keys(value).every((key) =>
            ['outcome', 'evidence'].includes(key),
          ) &&
          nonempty(value.outcome) &&
          strings(value.evidence),
        'Resolution requires only outcome and nonempty evidence.',
        { code: 'EXCEPTION_RESOLUTION_INVALID' },
      )
      const entry = listProceduralExceptions(root, runId, { id: entryId })[0]
      invariant(entry, 'Unknown exception entry.', {
        code: 'EXCEPTION_NOT_FOUND',
      })
      const resolution = {
        timestamp: new Date().toISOString(),
        actor,
        outcome: value.outcome,
        evidence: value.evidence,
      }
      if (entry.resolution) {
        invariant(
          entry.resolution.outcome === resolution.outcome &&
            sha256(entry.resolution.evidence) === sha256(resolution.evidence),
          'Exception already has a different resolution.',
          { code: 'EXCEPTION_RESOLUTION_CONFLICT' },
        )
        return entry
      }
      persist(root, state, 'procedural_exception_resolved', {
        entry_id: entryId,
        resolution,
      })
      return { ...entry, resolution }
    },
    { waitForHolderMs: 10_000 },
  )
}

/** Extract a bounded ledger subrecord without accepting any product claim. */
export function proceduralExceptionRecords(value: unknown): unknown[] {
  if (typeof value === 'string') {
    const headings = [...value.matchAll(/^## Procedural exceptions\s*$/gmu)]
    if (headings.length === 0) return []
    invariant(
      headings.length === 1,
      'Report permits one Procedural exceptions section.',
      { code: 'EXCEPTION_REPORT_INVALID' },
    )
    const start = headings[0]!.index! + headings[0]![0].length
    const markers = [
      ...value.matchAll(/^<!-- evidence-(?:verdict:|report:)/gmu),
    ]
    invariant(
      markers.every((marker) => marker.index! > start),
      'Procedural exceptions section must precede verdict and completion markers.',
      { code: 'EXCEPTION_REPORT_INVALID' },
    )
    const tail = value.slice(start)
    const section = tail.split(/^## /mu)[0]!
    const blocks = [...section.matchAll(/```json\s*\n([\s\S]*?)\n```/gu)]
    invariant(
      blocks.length === 1,
      'Exception report section requires exactly one JSON fence.',
      { code: 'EXCEPTION_REPORT_INVALID' },
    )
    return proceduralExceptionRecords(JSON.parse(blocks[0]![1]!))
  }
  if (!isRecord(value)) return []
  if (typeof value.revises === 'string' && isRecord(value.patch)) {
    const pending = value.patch.procedural_exceptions
    if (pending === undefined || pending === null) return []
    return proceduralExceptionRecords({ procedural_exceptions: pending })
  }
  if (value.procedural_exceptions === undefined) return []
  invariant(
    Array.isArray(value.procedural_exceptions),
    'procedural_exceptions MUST be an array.',
    { code: 'EXCEPTION_INVALID' },
  )
  return value.procedural_exceptions
}

export function reconcileProceduralExceptionsLocked(
  root: string,
  state: RunState,
  artifact: string,
  value?: unknown,
): ProceduralException[] {
  const absolute = resolveInside(root, artifact)
  const records = proceduralExceptionRecords(
    value ??
      (absolute.endsWith('.json') ? readJson(absolute) : readText(absolute)),
  )
  if (records.length === 0) return []
  const actor = exceptionActor(root, state, artifact)
  const validated = records.map(validateProceduralException)
  return validated.map((record) =>
    recordProceduralExceptionLocked(root, state, actor, record),
  )
}

export function reconcileProceduralExceptions(
  root: string,
  runId: string,
  artifact: string,
): ProceduralException[] {
  return withOperationMutex(
    operationMutexPath(root, runId),
    () =>
      reconcileProceduralExceptionsLocked(
        root,
        loadState(root, runId),
        artifact,
      ),
    { waitForHolderMs: 10_000 },
  )
}

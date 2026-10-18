import path from 'node:path'
import { readdirSync } from 'node:fs'

import {
  fileExists,
  isRecord,
  readJson,
  stableStringify,
  writeJsonAtomic,
} from '../io.js'
import { resolveRunLayout } from '../run-layout.js'
import type { Invocation } from '../types.js'
import {
  custodyAuthorityRoot,
  isDelegationWriteBoundary,
} from './scope-custody.js'

export interface DelegationLiveIdentity {
  run_id: string
  invocation_id: string
  role: string
  attempt: number
  /** Unique for each fresh or resumed process, including a failed resume. */
  launch_id: string
}

export interface DelegationLiveRecord extends DelegationLiveIdentity {
  schema_version: 1
  executor: 'copilot'
  launched_at: string
  heartbeat_at: string
  relay_pid: number
  relay_start_identity: string | null
  child_pid?: number
  child_start_identity?: string | null
  wrapper_record_path?: string
  /** CLI binding, not evidence that the session was observed or completed. */
  requested_session_id?: string
  /** Session identity explicitly named by an accepted CLI event. */
  session_id?: string
  resumed_from_session_id?: string
  sequence: number
  stream_sequences: { stdout: number; stderr: number }
  truncated: boolean
  ended_at?: string
  /** Child process exit clock; relay finalization and wrapper drain are separate. */
  child_ended_at?: string
  exit_code?: number | null
  signal?: string
  error?: string
  write_boundary?: DelegationWriteBoundary
  write_observations?: DelegationWriteObservation[]
}

/**
 * The child exit clock of a live record. Relays before v9.8.2 wrote only the
 * relay's `ended_at` with the exit code, so that pair stands in for it.
 */
export function liveChildEndedAt(
  record: DelegationLiveRecord,
): string | undefined {
  if (record.child_ended_at !== undefined) {
    return record.child_ended_at
  }

  return record.ended_at !== undefined &&
    (Number.isSafeInteger(record.exit_code) || record.signal !== undefined)
    ? record.ended_at
    : undefined
}

export interface DelegationWriteBoundary {
  write_roots: string[]
  effective_write_roots: string[]
  mode: 'sandbox-exec' | 'none'
  reason: string
}

export interface DelegationWriteObservation {
  path: string
  outcome: 'written' | 'denied'
  evidence: string
}

export interface DelegationLiveEvent {
  schema_version: 1
  launch_id: string
  sequence: number
  stream: 'stdout' | 'stderr' | 'relay'
  stream_sequence: number
  received_at: string
  kind: 'assistant' | 'tool' | 'session' | 'completion' | 'diagnostic'
  /** Sanitized complete line, never a raw byte chunk. */
  text: string
}

function validateIdentity(identity: DelegationLiveIdentity): void {
  for (const value of [
    identity.run_id,
    identity.invocation_id,
    identity.role,
    identity.launch_id,
  ]) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]+$/u.test(value)) {
      throw new Error('Invalid delegation live path identity.')
    }
  }

  if (!Number.isSafeInteger(identity.attempt) || identity.attempt < 1) {
    throw new Error('Invalid delegation live attempt.')
  }
}

/** Paths are immutable per launch; callers must keep the full identity. */
export function delegationLivePaths(
  root: string,
  identity: DelegationLiveIdentity,
): { record: string; events: string } {
  validateIdentity(identity)

  const stem =
    `${identity.invocation_id}.copilot.${identity.role}.` +
    `attempt-${identity.attempt}.${identity.launch_id}`
  const directory = resolveRunLayout(root, identity.run_id).evidence(
    '',
  ).absolute

  return {
    record: path.join(directory, `${stem}.live.json`),
    events: path.join(directory, `${stem}.events.jsonl`),
  }
}

export function delegationCustodyDirectory(
  root: string,
  identity: Pick<DelegationLiveIdentity, 'run_id' | 'invocation_id'>,
): string {
  validateIdentity({
    ...identity,
    role: 'stage',
    attempt: 1,
    launch_id: 'path',
  })
  return path.join(
    custodyAuthorityRoot(root),
    identity.run_id,
    identity.invocation_id,
  )
}

export function delegationCustodyPreparationPath(
  root: string,
  identity: Pick<DelegationLiveIdentity, 'run_id' | 'invocation_id'>,
): string {
  return `${delegationCustodyDirectory(root, identity)}.prepared.json`
}

function custodyRecordPath(
  root: string,
  identity: DelegationLiveIdentity,
): string {
  return path.join(
    delegationCustodyDirectory(root, identity),
    path.basename(delegationLivePaths(root, identity).record),
  )
}

/** Freeze only scope authority; delivery/session bookkeeping may still change. */
export function invocationCustodyIdentity(invocation: Invocation) {
  return {
    run_id: invocation.run_id,
    invocation_id: invocation.invocation_id,
    attempt: invocation.attempt,
    stage: {
      slug: invocation.stage.slug,
      persona: invocation.stage.persona,
      persona_executor: invocation.stage.persona_executor ?? 'cursor',
      model: invocation.stage.model,
      workspace_policy: invocation.stage.workspace_policy ?? null,
    },
    workspace_root: invocation.workspace_root,
    harness_root: invocation.harness_root ?? null,
    evidence_workers: (invocation.evidence_workers ?? []).map(
      ({ role, model }) => ({ role, model }),
    ),
  }
}

/** Preparation owns the complete inventory, before any worker can run. */
export function initializeDelegationCustody(
  root: string,
  invocation: Invocation,
): void {
  const directory = delegationCustodyDirectory(root, invocation)
  const target = path.join(directory, 'invocation.json')
  const identity = invocationCustodyIdentity(invocation)
  const preparation = delegationCustodyPreparationPath(root, invocation)
  if (
    fileExists(directory) &&
    readdirSync(directory).some((name) => name.endsWith('.live.json'))
  ) {
    if (
      !fileExists(target) ||
      stableStringify(readJson(target)) !== stableStringify(identity) ||
      (fileExists(preparation) &&
        stableStringify(readJson(preparation)) !== stableStringify(identity))
    ) {
      throw new Error('Cannot replace invocation custody after a launch.')
    }
    writeJsonAtomic(preparation, identity)
    return
  }
  // Keep preparation evidence outside the inventory it protects from deletion.
  writeJsonAtomic(preparation, identity)
  writeJsonAtomic(target, identity)
}

/** Missing evidence is unobserved. Malformed or mismatched evidence is an error. */
export function loadDelegationLiveRecord(
  root: string,
  identity: DelegationLiveIdentity,
  authority = false,
): DelegationLiveRecord | null {
  const recordPath = authority
    ? custodyRecordPath(root, identity)
    : delegationLivePaths(root, identity).record

  if (!fileExists(recordPath)) {
    return null
  }

  const value = readJson(recordPath) as Partial<DelegationLiveRecord>

  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    value.executor !== 'copilot' ||
    !(
      ['run_id', 'invocation_id', 'role', 'attempt', 'launch_id'] as const
    ).every((key) => value[key] === identity[key]) ||
    !Number.isSafeInteger(value.relay_pid) ||
    Number(value.relay_pid) < 1 ||
    !(
      value.relay_start_identity === null ||
      typeof value.relay_start_identity === 'string'
    ) ||
    typeof value.launched_at !== 'string' ||
    !Number.isFinite(Date.parse(value.launched_at)) ||
    typeof value.heartbeat_at !== 'string' ||
    !Number.isFinite(Date.parse(value.heartbeat_at)) ||
    !Number.isSafeInteger(value.sequence) ||
    Number(value.sequence) < 0 ||
    !isRecord(value.stream_sequences) ||
    !Number.isSafeInteger(value.stream_sequences.stdout) ||
    !Number.isSafeInteger(value.stream_sequences.stderr) ||
    value.stream_sequences.stdout < 0 ||
    value.stream_sequences.stderr < 0 ||
    typeof value.truncated !== 'boolean'
  ) {
    throw new Error(`Invalid delegation live record: ${recordPath}`)
  }

  for (const key of [
    'wrapper_record_path',
    'requested_session_id',
    'session_id',
    'resumed_from_session_id',
    'ended_at',
    'child_ended_at',
    'signal',
    'error',
  ] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      throw new Error(`Invalid delegation live field ${key}: ${recordPath}`)
    }
  }

  if (
    (value.child_pid !== undefined &&
      (!Number.isSafeInteger(value.child_pid) || value.child_pid < 1)) ||
    (value.child_start_identity !== undefined &&
      value.child_start_identity !== null &&
      typeof value.child_start_identity !== 'string') ||
    (value.exit_code !== undefined &&
      value.exit_code !== null &&
      !Number.isSafeInteger(value.exit_code)) ||
    (value.child_ended_at !== undefined &&
      (!value.child_pid ||
        !Number.isFinite(Date.parse(value.child_ended_at)) ||
        Date.parse(value.child_ended_at) < Date.parse(value.launched_at) ||
        (value.ended_at !== undefined &&
          Date.parse(value.child_ended_at) > Date.parse(value.ended_at)))) ||
    (value.ended_at !== undefined &&
      (!Number.isFinite(Date.parse(value.ended_at)) ||
        Date.parse(value.ended_at) < Date.parse(value.launched_at)))
  ) {
    throw new Error(`Invalid delegation live process fields: ${recordPath}`)
  }

  if (
    value.write_boundary !== undefined &&
    !isDelegationWriteBoundary(value.write_boundary)
  ) {
    throw new Error(`Invalid delegation write boundary: ${recordPath}`)
  }

  if (
    value.write_observations !== undefined &&
    (!Array.isArray(value.write_observations) ||
      !value.write_observations.every(
        (item) =>
          isRecord(item) &&
          typeof item.path === 'string' &&
          ['written', 'denied'].includes(item.outcome) &&
          typeof item.evidence === 'string' &&
          item.evidence.length > 0,
      ))
  ) {
    throw new Error(`Invalid delegation write observations: ${recordPath}`)
  }

  return value as DelegationLiveRecord
}

/** The relay is the sole writer; reusing an earlier launch is forbidden. */
export function writeDelegationLiveLaunch(
  root: string,
  record: DelegationLiveRecord,
): void {
  const paths = delegationLivePaths(root, record)
  const authorityPath = custodyRecordPath(root, record)

  if (
    fileExists(paths.record) ||
    fileExists(paths.events) ||
    fileExists(authorityPath)
  ) {
    throw new Error(`Delegation launch already exists: ${paths.record}`)
  }

  writeJsonAtomic(authorityPath, record)
  writeJsonAtomic(paths.record, record)
}

/** Atomically replace a launch snapshot, keeping append-only events separate. */
export function updateDelegationLiveRecord(
  root: string,
  record: DelegationLiveRecord,
): void {
  const previous = loadDelegationLiveRecord(root, record, true)

  if (
    previous === null ||
    previous.ended_at !== undefined ||
    record.sequence < previous.sequence ||
    record.stream_sequences.stdout < previous.stream_sequences.stdout ||
    record.stream_sequences.stderr < previous.stream_sequences.stderr ||
    record.relay_pid !== previous.relay_pid ||
    record.requested_session_id !== previous.requested_session_id ||
    record.launched_at !== previous.launched_at ||
    record.relay_start_identity !== previous.relay_start_identity ||
    (previous.child_ended_at !== undefined &&
      record.child_ended_at !== previous.child_ended_at) ||
    (previous.child_pid !== undefined &&
      (record.child_pid !== previous.child_pid ||
        record.child_start_identity !== previous.child_start_identity)) ||
    stableStringify(record.write_boundary) !==
      stableStringify(previous.write_boundary) ||
    !(previous.write_observations ?? []).every(
      (observation, index) =>
        stableStringify(observation) ===
        stableStringify(record.write_observations?.[index]),
    )
  ) {
    throw new Error('Delegation live update would reuse or regress a launch.')
  }

  writeJsonAtomic(custodyRecordPath(root, record), record)
  writeJsonAtomic(delegationLivePaths(root, record).record, record)
}

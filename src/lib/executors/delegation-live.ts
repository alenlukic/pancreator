import path from 'node:path'

import { fileExists, isRecord, readJson, writeJsonAtomic } from '../io.js'
import { resolveRunLayout } from '../run-layout.js'

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
  exit_code?: number | null
  signal?: string
  error?: string
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

/** Missing evidence is unobserved. Malformed or mismatched evidence is an error. */
export function loadDelegationLiveRecord(
  root: string,
  identity: DelegationLiveIdentity,
): DelegationLiveRecord | null {
  const { record: recordPath } = delegationLivePaths(root, identity)

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
    'signal',
    'error',
  ] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      throw new Error(`Invalid delegation live field ${key}: ${recordPath}`)
    }
  }

  if (
    (value.child_pid !== undefined && !Number.isSafeInteger(value.child_pid)) ||
    (value.child_start_identity !== undefined &&
      value.child_start_identity !== null &&
      typeof value.child_start_identity !== 'string') ||
    (value.exit_code !== undefined &&
      value.exit_code !== null &&
      !Number.isSafeInteger(value.exit_code))
  ) {
    throw new Error(`Invalid delegation live process fields: ${recordPath}`)
  }

  return value as DelegationLiveRecord
}

/** The relay is the sole writer; reusing an earlier launch is forbidden. */
export function writeDelegationLiveLaunch(
  root: string,
  record: DelegationLiveRecord,
): void {
  const paths = delegationLivePaths(root, record)

  if (fileExists(paths.record) || fileExists(paths.events)) {
    throw new Error(`Delegation launch already exists: ${paths.record}`)
  }

  writeJsonAtomic(paths.record, record)
}

/** Atomically replace a launch snapshot, keeping append-only events separate. */
export function updateDelegationLiveRecord(
  root: string,
  record: DelegationLiveRecord,
): void {
  const previous = loadDelegationLiveRecord(root, record)

  if (
    previous === null ||
    previous.ended_at !== undefined ||
    record.sequence < previous.sequence ||
    record.stream_sequences.stdout < previous.stream_sequences.stdout ||
    record.stream_sequences.stderr < previous.stream_sequences.stderr ||
    record.relay_pid !== previous.relay_pid ||
    record.requested_session_id !== previous.requested_session_id ||
    record.launched_at !== previous.launched_at
  ) {
    throw new Error('Delegation live update would reuse or regress a launch.')
  }

  writeJsonAtomic(delegationLivePaths(root, record).record, record)
}

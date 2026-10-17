/** Non-executing verification evidence validation shared by gates and collection. */
import path from 'node:path'
import { collectSecrets, redact } from '../agent-index/store.js'
import { gitSourceContentFingerprint } from '../git.js'
import {
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
  sha256,
} from '../io.js'
import type { Invocation } from '../types.js'
import type {
  VerificationExecutionContract,
  VerificationExecutionEvidence,
  VerificationExecutionManifest,
  VerificationExecutionOperation,
  VerificationExecutionSource,
} from '../types/verification-execution.js'
import { profileCommandInArgv } from './profile-command.js'
const MAX_TIMEOUT_MS = 120_000
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
type ExecutionInvocation = Pick<
  Invocation,
  | 'run_id'
  | 'invocation_id'
  | 'attempt'
  | 'workspace_root'
  | 'verification_execution'
>

function isSource(value: unknown): value is VerificationExecutionSource {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    typeof value.sha256 === 'string' &&
    typeof value.invocation_id === 'string' &&
    (value.authority === 'approved_plan' ||
      value.authority === 'source_allowed')
  )
}

function isEvidence(value: unknown): value is VerificationExecutionEvidence {
  return (
    isRecord(value) &&
    value.schema_version === 1 &&
    [
      'run_id',
      'invocation_id',
      'operation_id',
      'definition_sha256',
      'cwd',
      'started_at',
      'ended_at',
      'stdout',
      'stderr',
    ].every((key) => typeof value[key] === 'string') &&
    Number.isInteger(value.attempt) &&
    Number.isInteger(value.timeout_ms) &&
    typeof value.duration_ms === 'number' &&
    typeof value.timed_out === 'boolean' &&
    (value.source_fingerprint === null ||
      typeof value.source_fingerprint === 'string') &&
    (value.exit_code === null || Number.isInteger(value.exit_code)) &&
    (value.signal === null || typeof value.signal === 'string') &&
    (value.error === undefined || typeof value.error === 'string') &&
    ['collected', 'failed', 'gap'].includes(String(value.status)) &&
    isSource(value.source) &&
    ['argv', 'write_roots', 'evidence_paths'].every(
      (key) =>
        Array.isArray(value[key]) &&
        value[key].every((item: unknown) => typeof item === 'string'),
    ) &&
    Array.isArray(value.observations) &&
    value.observations.every(
      (item) =>
        isRecord(item) &&
        typeof item.path === 'string' &&
        typeof item.content === 'string' &&
        typeof item.sha256 === 'string',
    ) &&
    isRecord(value.enforcement) &&
    ['none', 'sandbox-exec'].includes(String(value.enforcement.mode)) &&
    (value.enforcement.processes === undefined ||
      ['single-process', 'unverified'].includes(
        String(value.enforcement.processes),
      )) &&
    typeof value.enforcement.reason === 'string'
  )
}

function isGap(value: unknown): value is { id: string; reason: string } {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.reason === 'string'
  )
}

export function relativePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.includes('\0') &&
    !path.isAbsolute(value) &&
    !value.split(/[\\/]/u).includes('..')
  )
}

/** Validate declaration data without executing it, also used by plan gates. */
export function verificationExecutionOperationErrors(
  root: string,
  value: unknown,
  workspaceRoot = root,
): string[] {
  if (!isRecord(value)) {
    return ['Operation must be an object, never free-text shell code.']
  }

  const errors: string[] = []
  const fields = new Set([
    'schema_version',
    'id',
    'criterion',
    'finding',
    'argv',
    'cwd',
    'timeout_ms',
    'write_roots',
    'evidence_paths',
    'required',
  ])
  if (Object.keys(value).some((key) => !fields.has(key))) {
    errors.push('Operation contains undeclared fields.')
  }
  if (value.schema_version !== 1) errors.push('schema_version must be 1.')
  if (typeof value.id !== 'string' || !ID.test(value.id)) {
    errors.push('id must be a stable operation identifier.')
  }
  if (
    ![value.criterion, value.finding].some(
      (item) => typeof item === 'string' && item.trim().length > 0,
    )
  ) {
    errors.push('An operation must name a criterion or finding.')
  }
  for (const key of ['criterion', 'finding']) {
    if (
      value[key] !== undefined &&
      (typeof value[key] !== 'string' || !value[key].trim())
    ) {
      errors.push(`${key} must be a non-empty string when supplied.`)
    }
  }
  const argv = value.argv
  if (
    !Array.isArray(argv) ||
    argv.length === 0 ||
    argv.length > 256 ||
    !argv.every(
      (arg) =>
        typeof arg === 'string' && !arg.includes('\0') && arg.length < 900,
    ) ||
    !argv[0]
  ) {
    errors.push('argv must be a non-empty bounded string array.')
  } else {
    const executable = path.basename(String(argv[0]))
    if (
      /^(?:ba|da|z|fi|c|k)?sh$|^cmd(?:\.exe)?$|^powershell$|^pwsh$|^eval$/iu.test(
        executable,
      ) ||
      /^(?:env|sudo|doas|xargs|timeout)$/iu.test(executable)
    ) {
      errors.push('Shell interpreters are not execution operations.')
    }
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(executable)) {
      const script = argv[1] === 'run' ? argv[2] : argv[1]
      if (typeof script !== 'string' || script.startsWith('-')) {
        errors.push(
          'Package-manager wrappers must name a direct focused command.',
        )
      }
    }
    if (
      profileCommandInArgv(
        root,
        argv,
        typeof value.cwd === 'string' ? value.cwd : '.',
        workspaceRoot,
      )
    ) {
      errors.push('Repository-check profiles cannot substitute for a case.')
    }
  }
  if (!relativePath(value.cwd)) errors.push('cwd must be workspace-relative.')
  if (
    !Number.isInteger(value.timeout_ms) ||
    Number(value.timeout_ms) < 1 ||
    Number(value.timeout_ms) > MAX_TIMEOUT_MS
  ) {
    errors.push(`timeout_ms must be between 1 and ${MAX_TIMEOUT_MS}.`)
  }
  for (const field of ['write_roots', 'evidence_paths']) {
    const values = value[field]
    if (!Array.isArray(values) || !values.every(relativePath)) {
      errors.push(`${field} must contain workspace-relative paths.`)
    }
    if (Array.isArray(value.write_roots) && value.write_roots.length === 0) {
      errors.push('Declare at least one operation scratch root.')
    }
  }
  if (value.required !== undefined && typeof value.required !== 'boolean') {
    errors.push('required must be a boolean.')
  }
  return errors
}

export function fingerprint(workspace: string): string | null {
  return gitSourceContentFingerprint(workspace, new Set())
}

export function definitionDigest(
  entry: VerificationExecutionContract['operations'][number],
): string {
  return sha256(JSON.stringify(entry))
}

function areExecutionRequests(
  value: unknown,
): value is { id: string; reason: string }[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isRecord(entry) &&
        Object.keys(entry).every((key) => key === 'id' || key === 'reason') &&
        typeof entry.id === 'string' &&
        ID.test(entry.id) &&
        typeof entry.reason === 'string' &&
        entry.reason.trim().length > 0,
    )
  )
}

/** Requests can select ids and explain missing observations, and nothing else. */
export function verificationExecutionRequests(
  value: unknown,
): { id: string; reason: string }[] {
  if (!areExecutionRequests(value)) {
    throw new Error(
      'Execution requests must contain only authorized operation ids and non-empty reasons.',
    )
  }
  return value.map((entry: { id: string; reason: string }) => ({
    id: entry.id,
    reason: entry.reason,
  }))
}

export function isOperation(
  root: string,
  value: unknown,
  workspaceRoot = root,
): value is VerificationExecutionOperation {
  return (
    verificationExecutionOperationErrors(root, value, workspaceRoot).length ===
    0
  )
}

function isManifest(value: unknown): value is VerificationExecutionManifest {
  return (
    isRecord(value) &&
    value.schema_version === 1 &&
    typeof value.run_id === 'string' &&
    typeof value.invocation_id === 'string' &&
    Number.isInteger(value.attempt) &&
    (value.source_fingerprint === null ||
      typeof value.source_fingerprint === 'string') &&
    Array.isArray(value.records) &&
    value.records.every(isEvidence) &&
    Array.isArray(value.history) &&
    value.history.every(isEvidence) &&
    Array.isArray(value.gaps) &&
    value.gaps.every(isGap)
  )
}

export function loadManifest(
  root: string,
  contract: VerificationExecutionContract,
): VerificationExecutionManifest | null {
  const absolute = resolveInside(root, contract.manifest_path)
  if (!fileExists(absolute)) return null
  const value: unknown = readJson(absolute)
  if (!isManifest(value)) {
    throw new Error(`Invalid execution manifest: ${contract.manifest_path}`)
  }
  return value
}

export function currentRecord(
  record: VerificationExecutionEvidence,
  invocation: ExecutionInvocation,
  entry: VerificationExecutionContract['operations'][number],
  sourceFingerprint: string | null,
  secrets: string[] = [],
): boolean {
  return (
    sourceFingerprint !== null &&
    record.enforcement.processes === 'single-process' &&
    record.schema_version === 1 &&
    record.run_id === invocation.run_id &&
    record.invocation_id === invocation.invocation_id &&
    record.attempt === invocation.attempt &&
    record.operation_id === entry.operation.id &&
    record.definition_sha256 === definitionDigest(entry) &&
    record.source_fingerprint === sourceFingerprint &&
    record.timeout_ms === entry.operation.timeout_ms &&
    JSON.stringify(record.argv) ===
      JSON.stringify(entry.operation.argv.map((arg) => redact(arg, secrets))) &&
    record.cwd === entry.operation.cwd &&
    JSON.stringify(record.write_roots) ===
      JSON.stringify(entry.operation.write_roots) &&
    JSON.stringify(record.evidence_paths) ===
      JSON.stringify(entry.operation.evidence_paths) &&
    JSON.stringify(record.source) === JSON.stringify(entry.source)
  )
}

/** Fail passing verification on absent, stale, failed, or substituted evidence. */
export function verificationExecutionGaps(
  root: string,
  value: unknown,
  requests: unknown = [],
): string[] {
  if (!areExecutionRequests(requests)) {
    return ['Execution requests must select only authorized ids and reasons.']
  }
  const selected = verificationExecutionRequests(requests)
  if (!isRecord(value) || value.verification_execution === undefined)
    return selected.length > 0
      ? ['Execution requests have no declared invocation authority.']
      : []
  const contractValue = value.verification_execution
  const workspace =
    typeof value.workspace_root === 'string'
      ? path.resolve(root, value.workspace_root)
      : root
  if (
    typeof value.workspace_root !== 'string' ||
    typeof value.run_id !== 'string' ||
    typeof value.invocation_id !== 'string' ||
    !Number.isInteger(value.attempt) ||
    !isRecord(contractValue) ||
    contractValue.schema_version !== 1 ||
    typeof contractValue.manifest_path !== 'string' ||
    contractValue.write_root !== 'runtime/verification-execution' ||
    !Array.isArray(contractValue.sources) ||
    !contractValue.sources.every(isSource) ||
    !Array.isArray(contractValue.operations) ||
    !contractValue.operations.every(
      (entry) =>
        isRecord(entry) &&
        isSource(entry.source) &&
        isOperation(root, entry.operation, workspace),
    ) ||
    !Array.isArray(contractValue.gaps) ||
    !contractValue.gaps.every(isGap)
  ) {
    return ['Invalid verification execution invocation authority.']
  }
  const invocation = value as ExecutionInvocation
  const contract = invocation.verification_execution
  if (!contract) return []
  const manifest = loadManifest(root, contract)
  if (!manifest)
    return [`Missing execution manifest: ${contract.manifest_path}`]
  const current = fingerprint(workspace)
  const secrets = [...collectSecrets(root), ...collectSecrets(workspace)]
  const gaps = manifest.gaps.map((gap) => `${gap.id}: ${gap.reason}`)
  for (const request of selected) {
    if (
      !contract.operations.some((entry) => entry.operation.id === request.id) ||
      !manifest.records.some((record) => record.operation_id === request.id)
    ) {
      gaps.push(`Requested observation is unavailable: ${request.id}`)
    }
  }
  if (
    manifest.invocation_id !== invocation.invocation_id ||
    manifest.run_id !== invocation.run_id ||
    manifest.attempt !== invocation.attempt ||
    (!current && contract.operations.length > 0) ||
    manifest.source_fingerprint !== current
  ) {
    gaps.push(
      'Execution manifest belongs to a different source, invocation, or attempt.',
    )
  }
  for (const entry of contract.operations) {
    const record = manifest.records.find(
      (item) => item.operation_id === entry.operation.id,
    )
    if (entry.operation.required === false && !record) continue
    if (
      !record ||
      !currentRecord(record, invocation, entry, current, secrets) ||
      record.enforcement.mode !== 'sandbox-exec' ||
      record.enforcement.processes !== 'single-process' ||
      record.status !== 'collected' ||
      record.exit_code !== 0 ||
      record.signal !== null ||
      record.timed_out ||
      record.error ||
      !Array.isArray(record.observations) ||
      record.observations.length !== entry.operation.evidence_paths.length ||
      record.observations.some(
        (observation, index) =>
          observation.path !== entry.operation.evidence_paths[index] ||
          sha256(observation.content) !== observation.sha256,
      )
    ) {
      gaps.push(`Missing current successful observation: ${entry.operation.id}`)
    }
    const sourcePath = resolveInside(root, entry.source.path)
    if (
      !fileExists(sourcePath) ||
      sha256(readText(sourcePath)) !== entry.source.sha256
    ) {
      gaps.push(`Execution authority source changed: ${entry.source.path}`)
    }
  }
  return gaps
}

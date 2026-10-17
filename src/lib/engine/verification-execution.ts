/**
 * Harness-owned bounded observations for shell-less verification. Requests
 * select pinned definitions; they never become executable definitions.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
} from 'node:fs'
import path from 'node:path'

import { collectSecrets, redact } from '../agent-index/store.js'
import { runAcceptanceProofs } from '../acceptance-proof.js'
import { resolveWriteSandbox } from '../executors/write-sandbox.js'
import {
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
  sha256,
  writeJsonAtomic,
  writeTextAtomic,
  withOperationMutex,
} from '../io.js'
import { resolveRunLayout } from '../run-layout.js'
import { loadState, statePath } from '../state.js'
import type { Invocation, RunState } from '../types.js'
import type {
  VerificationExecutionContract,
  VerificationExecutionEvidence,
  VerificationExecutionManifest,
  VerificationExecutionSource,
} from '../types/verification-execution.js'
import {
  relativePath,
  fingerprint,
  definitionDigest,
  isOperation,
  loadManifest,
  currentRecord,
  verificationExecutionOperationErrors,
  verificationExecutionRequests,
} from '../validators/verification-execution.js'
export {
  verificationExecutionOperationErrors,
  verificationExecutionRequests,
  verificationExecutionGaps,
} from '../validators/verification-execution.js'
import { loadRunWorkflow, workspaceDirectory } from './core.js'
import { runVerificationExecutionProcess } from './verification-execution-process.js'

export type {
  VerificationExecutionOperation,
  VerificationExecutionEvidence,
} from '../types/verification-execution.js'

const MAX_TIMEOUT_MS = 120_000
const MAX_OUTPUT_BYTES = 1024 * 1024
const MISSING_REQUEST =
  'No authorized operation definition. Source-authorized recovery must supply it before grading.'
function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  )
}

/** Check existing ancestors too: a missing leaf does not hide a symlink escape. */
function confinedPath(
  workspace: string,
  relative: string,
  ceiling?: string,
): string {
  if (!relativePath(relative))
    throw new Error(`Invalid relative path: ${relative}`)
  const target = path.resolve(workspace, relative)
  const boundary = path.resolve(workspace, ceiling ?? '.')
  if (!inside(boundary, target))
    throw new Error(`Path escapes collector root: ${relative}`)
  let ancestor = target
  while (!existsSync(ancestor)) {
    if (lstatExists(ancestor)) throw new Error(`Dangling symlink: ${relative}`)
    ancestor = path.dirname(ancestor)
  }
  if (!inside(realpathSync(workspace), realpathSync(ancestor))) {
    throw new Error(`Symlink escapes workspace: ${relative}`)
  }
  // No symlink in a write grant may redirect authority, even within runtime.
  if (ceiling) {
    let current = workspace
    for (const part of path.relative(workspace, target).split(path.sep)) {
      current = path.join(current, part)
      if (lstatExists(current) && lstatSync(current).isSymbolicLink()) {
        throw new Error(`Symlink in collector write path: ${relative}`)
      }
    }
  }
  return target
}

function lstatExists(target: string): boolean {
  try {
    lstatSync(target)
    return true
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return false
    throw error
  }
}

/**
 * Only successful, declared source-stage records and the effective approved
 * plan supply authority. A QA/verifier output can never add commands.
 */
export function resolveVerificationExecutionOperations(
  root: string,
  state: RunState,
  invocation: Invocation,
): VerificationExecutionContract {
  const contract: VerificationExecutionContract = {
    schema_version: 1,
    manifest_path: resolveRunLayout(root, state.run_id).evidence(
      `${invocation.invocation_id}-verification-execution.json`,
    ).relative,
    write_root: 'runtime/verification-execution',
    sources: [],
    operations: [],
    gaps: [],
  }
  const workflow = loadRunWorkflow(root, state)
  const proofs = runAcceptanceProofs(root, { ...state })
  const declared = new Set(invocation.inputs.references.map((ref) => ref.path))
  const missingCases: { id: string; criterion: string }[] = []
  const inherited = state.approved_plan
  const history = [...state.stage_history]
  if (inherited) {
    const planState = fileExists(statePath(root, inherited.run_id))
      ? loadState(root, inherited.run_id)
      : null
    const record = [...(planState?.stage_history ?? [])]
      .reverse()
      .find((item) => item.stage === 'plan' && item.outcome === 'success')
    const absolute = resolveInside(root, inherited.output_path)
    if (
      planState?.workflow_slug !== 'planning' ||
      record?.output_path !== inherited.output_path ||
      record.invocation_id !== inherited.invocation_id ||
      !fileExists(absolute) ||
      sha256(readText(absolute)) !== inherited.sha256
    ) {
      contract.gaps.push({
        id: 'approved_plan',
        reason:
          'Approved plan authority identity or digest changed after delivery routing.',
      })
    } else {
      history.unshift(record)
    }
  }
  const effectivePlan = [...history]
    .reverse()
    .find((item) => item.stage === 'plan' && item.outcome === 'success')
  const latest = new Map(
    history
      .filter((item) => item.outcome === 'success')
      .map((item) => [item.stage, item]),
  )
  for (const item of latest.values()) {
    const definition = workflow.stages.find(
      (stage) => stage.slug === item.stage,
    )
    const plan = item === effectivePlan
    if (
      !declared.has(item.output_path) ||
      (!plan && definition?.workspace_policy !== 'source_allowed')
    )
      continue
    const absolute = resolveInside(root, item.output_path)
    if (!fileExists(absolute)) {
      contract.gaps.push({
        id: item.stage,
        reason: `Missing authority source: ${item.output_path}`,
      })
      continue
    }
    const value: unknown = readJson(absolute)
    if (
      !isRecord(value) ||
      value.invocation_id !== item.invocation_id ||
      value.result !== 'success' ||
      !isRecord(value.data)
    ) {
      contract.gaps.push({
        id: item.stage,
        reason: `Wrong authority identity: ${item.output_path}`,
      })
      continue
    }
    const source: VerificationExecutionSource = {
      path: item.output_path,
      sha256: sha256(readText(absolute)),
      invocation_id: item.invocation_id,
      authority: plan ? 'approved_plan' : 'source_allowed',
    }
    contract.sources.push(source)
    const declarations: { value: unknown; case_id?: string }[] = []
    if (plan && Array.isArray(value.data.test_plan)) {
      for (const entry of value.data.test_plan) {
        if (!isRecord(entry)) continue
        if (
          inherited &&
          item.output_path === inherited.output_path &&
          (typeof entry.criterion !== 'string' || !proofs.has(entry.criterion))
        )
          continue
        const caseId = typeof entry.id === 'string' ? entry.id : 'unnamed-case'
        const execution = isRecord(entry.execution) ? entry.execution : null
        if (
          !Array.isArray(execution?.operations) ||
          !execution.operations.some(
            (operation: unknown) =>
              isRecord(operation) && operation.required !== false,
          )
        ) {
          if (
            typeof entry.criterion === 'string' &&
            proofs.get(entry.criterion) === 'live'
          ) {
            missingCases.push({ id: caseId, criterion: entry.criterion })
          }
          if (!Array.isArray(execution?.operations)) continue
        }
        declarations.push(
          ...execution.operations.map((operation: unknown) => ({
            value: operation,
            case_id: caseId,
          })),
        )
      }
    }
    if (!plan && Array.isArray(value.data.verification_execution_operations)) {
      declarations.push(
        ...value.data.verification_execution_operations.map(
          (operation: unknown) => ({ value: operation }),
        ),
      )
    }
    for (const entry of declarations) {
      const errors = verificationExecutionOperationErrors(
        root,
        entry.value,
        workspaceDirectory(root, state),
      )
      if (errors.length > 0) {
        contract.gaps.push({
          id:
            isRecord(entry.value) && typeof entry.value.id === 'string'
              ? entry.value.id
              : item.stage,
          reason: errors.join(' '),
        })
        continue
      }
      // The guard above checks every field before the JSON boundary is crossed.
      if (!isOperation(root, entry.value, workspaceDirectory(root, state)))
        continue
      const operation = entry.value
      if (
        contract.operations.some(
          (existing) => existing.operation.id === operation.id,
        )
      ) {
        contract.gaps.push({
          id: operation.id,
          reason: 'Duplicate operation identity.',
        })
        continue
      }
      contract.operations.push({
        operation,
        source,
        ...(entry.case_id ? { case_id: entry.case_id } : {}),
      })
    }
  }
  for (const missing of missingCases) {
    if (
      !contract.operations.some(
        (entry) =>
          entry.source.authority === 'source_allowed' &&
          entry.operation.criterion === missing.criterion &&
          entry.operation.required !== false,
      )
    ) {
      contract.gaps.push({
        id: missing.id,
        reason:
          'Live case has no authorized structured operation; source-authorized recovery must supply it.',
      })
    }
  }
  const live = [...proofs].filter(([, proof]) => proof === 'live')
  for (const [criterion] of live) {
    if (
      !contract.operations.some(
        (entry) =>
          entry.operation.criterion === criterion &&
          entry.operation.required !== false,
      )
    ) {
      contract.gaps.push({
        id: criterion,
        reason:
          'Live criterion lacks an authorized execution definition. Supply it in a plan or source-authorized handoff.',
      })
    }
  }
  return contract
}

/** Persist raw, sanitized observations; no record contains a product verdict. */
export function collectVerificationExecutionEvidence(
  root: string,
  state: RunState,
  invocation: Invocation,
  requests: unknown = [],
): {
  manifest: VerificationExecutionManifest
  collected: number
  updated: boolean
} {
  const contract = invocation.verification_execution
  if (!contract)
    throw new Error('Invocation has no verification execution authority.')
  return withOperationMutex(
    resolveInside(root, `${contract.manifest_path}.collection.mutex`),
    () =>
      collectVerificationExecutionEvidenceUnlocked(
        root,
        state,
        invocation,
        requests,
      ),
    { waitForHolderMs: MAX_TIMEOUT_MS * (contract.operations.length + 1) },
  )
}

function collectVerificationExecutionEvidenceUnlocked(
  root: string,
  state: RunState,
  invocation: Invocation,
  requests: unknown,
): {
  manifest: VerificationExecutionManifest
  collected: number
  updated: boolean
} {
  const contract = invocation.verification_execution
  if (!contract)
    throw new Error('Invocation has no verification execution authority.')
  const selected = verificationExecutionRequests(requests)
  const workspace = workspaceDirectory(root, state)
  const sourceFingerprint = fingerprint(workspace)
  const previous = loadManifest(root, contract)
  const manifest: VerificationExecutionManifest = {
    schema_version: 1,
    run_id: invocation.run_id,
    invocation_id: invocation.invocation_id,
    attempt: invocation.attempt,
    source_fingerprint: sourceFingerprint,
    records: [],
    gaps: [
      ...contract.gaps,
      ...(previous?.gaps ?? []).filter(
        (gap) =>
          gap.reason === MISSING_REQUEST &&
          !contract.operations.some((entry) => entry.operation.id === gap.id),
      ),
    ],
    history: [...(previous?.history ?? [])],
  }
  const secrets = [...collectSecrets(root), ...collectSecrets(workspace)]
  let collected = 0
  for (const request of selected) {
    if (
      !contract.operations.some((entry) => entry.operation.id === request.id)
    ) {
      manifest.gaps.push({
        id: request.id,
        reason: MISSING_REQUEST,
      })
    }
  }
  for (const entry of contract.operations) {
    const operation = entry.operation
    const old = previous?.records.find(
      (record) => record.operation_id === operation.id,
    )
    if (
      operation.required === false &&
      !selected.some((request) => request.id === operation.id) &&
      !old
    )
      continue
    const started = Date.now()
    const record: VerificationExecutionEvidence = {
      schema_version: 1,
      run_id: invocation.run_id,
      invocation_id: invocation.invocation_id,
      attempt: invocation.attempt,
      operation_id: operation.id,
      definition_sha256: definitionDigest(entry),
      source_fingerprint: sourceFingerprint,
      source: entry.source,
      argv: operation.argv.map((arg) => redact(arg, secrets)),
      cwd: operation.cwd,
      timeout_ms: operation.timeout_ms,
      write_roots: operation.write_roots,
      evidence_paths: operation.evidence_paths,
      started_at: new Date(started).toISOString(),
      ended_at: new Date(started).toISOString(),
      duration_ms: 0,
      exit_code: null,
      signal: null,
      timed_out: false,
      status: 'gap',
      stdout: '',
      stderr: '',
      observations: [],
      enforcement: {
        mode: 'none',
        reason: 'Not launched.',
        processes: 'unverified',
      },
    }
    try {
      const errors = verificationExecutionOperationErrors(
        root,
        operation,
        workspace,
      )
      if (errors.length > 0) throw new Error(errors.join(' '))
      if (contract.write_root !== 'runtime/verification-execution') {
        throw new Error('Invocation expands the fixed collector write policy.')
      }
      const sourcePath = resolveInside(root, entry.source.path)
      if (
        !fileExists(sourcePath) ||
        sha256(readText(sourcePath)) !== entry.source.sha256
      ) {
        throw new Error(
          'Authority source changed after preparation; prepare a new invocation.',
        )
      }
      if (!sourceFingerprint)
        throw new Error('Workspace source fingerprint is unavailable.')
      const cwd = confinedPath(workspace, operation.cwd)
      const operationRoot = `${contract.write_root}/${operation.id}`
      const writeRoots = operation.write_roots.map((directory) =>
        confinedPath(workspace, directory, operationRoot),
      )
      const destinations = operation.evidence_paths.map((destination) => {
        const absolute = confinedPath(
          workspace,
          destination,
          contract.write_root,
        )
        if (!writeRoots.some((directory) => inside(directory, absolute))) {
          throw new Error(
            `Evidence destination is outside operation write roots: ${destination}`,
          )
        }
        return absolute
      })
      if (
        old &&
        currentRecord(old, invocation, entry, sourceFingerprint, secrets)
      ) {
        manifest.records.push(old)
        continue
      }
      for (const directory of writeRoots)
        mkdirSync(directory, { recursive: true })
      const scratch = confinedPath(
        workspace,
        operationRoot,
        contract.write_root,
      )
      mkdirSync(scratch, { recursive: true })
      const sandbox = resolveWriteSandbox(writeRoots, {
        strict: true,
        denySubprocesses: true,
      })
      record.enforcement = {
        mode: sandbox.mode,
        reason: sandbox.reason,
        processes:
          sandbox.mode === 'sandbox-exec' ? 'single-process' : 'unverified',
      }
      if (sandbox.mode === 'none')
        throw new Error(`Write enforcement unavailable: ${sandbox.reason}`)
      // Archive old destinations so an exit-zero process cannot reuse a stale file.
      for (const destination of destinations) {
        if (existsSync(destination)) archiveVerificationReport(destination)
      }
      const launch = sandbox.wrap(operation.argv[0], operation.argv.slice(1))
      try {
        const result = runVerificationExecutionProcess(
          {
            binary: launch.binary,
            argv: launch.argv,
            timeout_ms: operation.timeout_ms,
            max_bytes: MAX_OUTPUT_BYTES,
          },
          cwd,
          {
            PATH: process.env.PATH,
            HOME: scratch,
            TMPDIR: writeRoots[0] ?? scratch,
          },
        )
        collected += 1
        record.exit_code = result.status
        record.signal = result.signal
        record.timed_out = result.timed_out
        record.stdout = redact(result.stdout ?? '', secrets)
        record.stderr = redact(result.stderr ?? '', secrets)
        record.status =
          result.status === 0 && !result.error ? 'collected' : 'failed'
        if (result.error) record.error = redact(result.error, secrets)
        for (const [index, destination] of destinations.entries()) {
          confinedPath(
            workspace,
            operation.evidence_paths[index],
            contract.write_root,
          )
          if (!existsSync(destination))
            throw new Error(
              `Missing expected evidence: ${operation.evidence_paths[index]}`,
            )
          if (
            !statSync(destination).isFile() ||
            statSync(destination).size > MAX_OUTPUT_BYTES
          ) {
            throw new Error(
              `Evidence is not a bounded file: ${operation.evidence_paths[index]}`,
            )
          }
          const content = redact(readFileSync(destination, 'utf8'), secrets)
          writeTextAtomic(destination, content)
          record.observations.push({
            path: operation.evidence_paths[index],
            content,
            sha256: sha256(content),
          })
        }
        if (fingerprint(workspace) !== sourceFingerprint) {
          throw new Error(
            'Source changed during collection; observations are stale.',
          )
        }
      } finally {
        launch.cleanup()
      }
    } catch (error) {
      record.error = redact(
        error instanceof Error ? error.message : String(error),
        secrets,
      )
      if (record.status !== 'failed') record.status = 'gap'
      if (
        old &&
        old.status === 'gap' &&
        old.error === record.error &&
        currentRecord(old, invocation, entry, sourceFingerprint, secrets)
      ) {
        manifest.records.push(old)
        continue
      }
    }
    record.ended_at = new Date().toISOString()
    record.duration_ms = Date.now() - started
    if (old) manifest.history.push(old)
    manifest.records.push(record)
  }
  for (const record of manifest.records) {
    if (record.status === 'gap')
      manifest.gaps.push({
        id: record.operation_id,
        reason: record.error ?? 'Observation unavailable.',
      })
  }
  manifest.gaps = [
    ...new Map(
      manifest.gaps.map((gap) => [`${gap.id}\0${gap.reason}`, gap]),
    ).values(),
  ]
  const updated =
    !previous || JSON.stringify(previous) !== JSON.stringify(manifest)
  if (updated) {
    writeJsonAtomic(resolveInside(root, contract.manifest_path), manifest)
  }
  return { manifest, collected, updated }
}

/** Preserve completed worker work before an authorized recollection reruns it. */
export function archiveVerificationReport(absolute: string): void {
  let ordinal = 1
  while (existsSync(`${absolute}.execution-archive-${ordinal}`)) ordinal += 1
  renameSync(absolute, `${absolute}.execution-archive-${ordinal}`)
}

/** One consumer owns its sidecar and archives, including parallel dispatch. */
export function consumeEvidenceExecutionRequest(
  root: string,
  state: RunState,
  invocation: Invocation,
  report: string,
): boolean {
  return withOperationMutex(
    `${report}.execution-recovery.mutex`,
    () => {
      const request = `${report}.execution-request.json`
      if (!fileExists(request)) return false
      const collection = collectVerificationExecutionEvidence(
        root,
        state,
        invocation,
        readJson(request),
      )
      archiveVerificationReport(request)
      if (collection.updated && fileExists(report))
        archiveVerificationReport(report)
      return collection.updated
    },
    {
      waitForHolderMs:
        MAX_TIMEOUT_MS *
        ((invocation.verification_execution?.operations.length ?? 0) + 1),
    },
  )
}

/** Idempotent preparation shared by fresh cards and an existing prepared visit. */
export function prepareVerificationExecution(
  root: string,
  state: RunState,
  invocation: Invocation,
  evidenceRoles?: readonly string[],
): boolean {
  if (
    invocation.stage.persona !== 'verifier' &&
    !invocation.evidence_workers?.some((worker) => worker.role === 'qa')
  )
    return false
  invocation.verification_execution ??= resolveVerificationExecutionOperations(
    root,
    state,
    invocation,
  )
  collectVerificationExecutionEvidence(root, state, invocation)
  let requestedStageObservation = false
  const stageReport = resolveInside(root, invocation.output.path)

  if (invocation.stage.persona === 'verifier' && fileExists(stageReport)) {
    const output: unknown = readJson(stageReport)

    if (
      isRecord(output) &&
      isRecord(output.data) &&
      output.data.verification_execution_requests !== undefined
    ) {
      requestedStageObservation = collectVerificationExecutionEvidence(
        root,
        state,
        invocation,
        output.data.verification_execution_requests,
      ).updated
    }
  }

  const current = loadManifest(root, invocation.verification_execution)
  if (!current)
    throw new Error('Execution collection did not produce its manifest.')
  const consumerKey = sha256(
    JSON.stringify({
      invocation_id: invocation.invocation_id,
      source_fingerprint: current.source_fingerprint,
      records: current.records.filter((record) =>
        invocation.verification_execution?.operations.some(
          (entry) =>
            entry.operation.id === record.operation_id &&
            entry.operation.required !== false,
        ),
      ),
      gaps: invocation.verification_execution.gaps,
    }),
  )
  const invalidate = (report: string): boolean => {
    const context = `${report}.execution-context.json`
    const prior: unknown = fileExists(context) ? readJson(context) : null
    const changed = !isRecord(prior) || prior.key !== consumerKey
    const archived = changed && fileExists(report)
    if (archived) archiveVerificationReport(report)
    if (changed)
      writeJsonAtomic(context, {
        invocation_id: invocation.invocation_id,
        key: consumerKey,
      })
    return archived
  }
  for (const worker of invocation.evidence_workers ?? []) {
    if (evidenceRoles && !evidenceRoles.includes(worker.role)) continue
    const report = resolveInside(root, worker.evidence_path)
    if (worker.role === 'qa') {
      withOperationMutex(
        `${report}.execution-recovery.mutex`,
        () => invalidate(report),
        {
          waitForHolderMs:
            MAX_TIMEOUT_MS *
            (invocation.verification_execution!.operations.length + 1),
        },
      )
    }
    consumeEvidenceExecutionRequest(root, state, invocation, report)
  }
  let rerunStage = false
  if (invocation.stage.persona === 'verifier') {
    rerunStage = invalidate(stageReport)

    if (requestedStageObservation && fileExists(stageReport)) {
      archiveVerificationReport(stageReport)
      rerunStage = true
    }
  }
  if (
    !invocation.inputs.references.some(
      (ref) => ref.path === invocation.verification_execution?.manifest_path,
    )
  ) {
    invocation.inputs.references.push({
      path: invocation.verification_execution.manifest_path,
      description:
        'Harness-collected raw execution observations and explicit evidence gaps. Independently grade these observations; they are not product or browser verdicts.',
      retrieval: 'required',
    })
  }
  return rerunStage
}

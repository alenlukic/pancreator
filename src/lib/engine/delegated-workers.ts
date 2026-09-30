/**
 * Delegated worker records: the launch a supervisor records, the watch it arms,
 * and the worker state it reads back.
 */

import { statSync } from 'node:fs'

import { readEvidenceReady } from '../watch-evidence.js'
import { invariant } from '../errors.js'
import {
  resolveInside,
  withOperationMutex,
  writeJsonAtomic,
  writeTextAtomic,
} from '../io.js'
import {
  evidenceWorkerAttemptPaths,
  nextAttemptOrdinal,
  resolveRunLayout,
} from '../run-layout.js'
import {
  resolveWatchedInvocation,
  summarizeDelegationWatch,
  watchInvocation,
  type WatchOptions,
  type WatchResult,
} from '../watch.js'
import {
  buildInvocationContractManifest,
  renderEvidenceWorkerBrief,
  renderInvocationDeliveryPrompt,
  renderInvocationMarkdown,
} from '../render.js'
import { operationMutexPath, loadState, now } from '../state.js'
import type {
  DelegatedWorkerRecord,
  EvidenceWorkerAttempt,
  Invocation,
  RunState,
} from '../types.js'

import { persistRun, readInvocationRecord } from './core.js'

/** The stage worker's own role name in the delegated-worker record. */
export const STAGE_WORKER_ROLE = 'worker'

export interface RecordDelegatedWorkerOptions {
  /** Identity the platform returned for the launch. */
  handle: string
  /** Evidence-worker role, or `worker` for the stage worker itself. */
  role?: string
  invocationId?: string
  agent?: string
  model?: string
  launchMode?: DelegatedWorkerRecord['launch_mode']
  /**
   * Allocate a fresh evidence attempt instead of attaching to the latest
   * declared one. The caller knows it relaunched a worker whose first handle
   * was never recorded; nothing on disk distinguishes that from a late
   * handle for the launch that wrote the report already there.
   */
  newAttempt?: boolean
}

export interface DelegatedWorkerLaunch {
  record: DelegatedWorkerRecord
  /** Paths this launch owns, when the role is an evidence worker. */
  evidence_attempt?: EvidenceWorkerAttempt
  /** Non-blocking notice when recording the launch extends a prepared card. */
  warnings?: string[]
}

/**
 * Re-render the artifacts that quote an invocation's declared paths.
 *
 * A relaunch changes the evidence paths the consuming card names, and the
 * contract digest describes those rendered bytes, so both are rebuilt from
 * the amended record rather than left to disagree with it.
 */
function rerenderInvocationArtifacts(
  root: string,
  invocation: Invocation,
  jsonPath: string,
): void {
  const markdownPath = resolveRunLayout(root, invocation.run_id).invocation(
    invocation.invocation_id,
    '.md',
  ).relative
  const renderedMarkdown = renderInvocationMarkdown(invocation)

  writeTextAtomic(resolveInside(root, markdownPath), renderedMarkdown)

  const delegation = invocation.delegation

  if (delegation?.mode === 'referenced' && delegation.delivery_prompt_path) {
    invocation.contract_manifest = buildInvocationContractManifest(
      markdownPath,
      renderedMarkdown,
      invocation.policies,
    )
    writeTextAtomic(
      resolveInside(root, delegation.delivery_prompt_path),
      renderInvocationDeliveryPrompt(invocation, invocation.contract_manifest),
    )
  }

  writeJsonAtomic(resolveInside(root, jsonPath), invocation)
}

/** The run already recorded a stage-worker launch for this invocation. */
function recordedStageWorker(state: RunState, invocationId: string): boolean {
  return (state.delegated_workers ?? []).some(
    (item) =>
      item.invocation_id === invocationId && item.role === STAGE_WORKER_ROLE,
  )
}

/**
 * Record the handle the platform returned for one delegated worker.
 *
 * The harness watches a worker through files, so a worker that crashed before
 * its first write is indistinguishable from one that was never launched. The
 * handle is what makes that launch visible. For an evidence role the same
 * call allocates the launch's own declared paths, which is what stops a
 * relaunched worker from being handed the path the first one already wrote.
 */
export function recordDelegatedWorker(
  root: string,
  runId: string,
  options: RecordDelegatedWorkerOptions,
): DelegatedWorkerLaunch {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)
    const handle = options.handle.trim()

    invariant(handle.length > 0, 'A worker handle is required.', {
      code: 'INVALID_ARGUMENT',
    })

    const invocationId = options.invocationId ?? state.current_invocation?.id

    invariant(
      invocationId,
      `Run ${runId} has no pending invocation. Name one with --invocation.`,
      { code: 'NO_ACTIVE_INVOCATION' },
    )

    const { invocation, json_path: jsonPath } = readInvocationRecord(
      root,
      state,
      invocationId,
    )
    const role = (options.role ?? STAGE_WORKER_ROLE).trim() || STAGE_WORKER_ROLE
    const recordedForRole = (state.delegated_workers ?? []).filter(
      (item) => item.invocation_id === invocationId && item.role === role,
    )

    let attempt = recordedForRole.length + 1
    let declaredPaths = [invocation.output.path]
    let harnessPaths: string[] = []
    let evidenceAttempt: EvidenceWorkerAttempt | undefined

    const warnings: string[] = []

    if (role !== STAGE_WORKER_ROLE) {
      const worker = (invocation.evidence_workers ?? []).find(
        (item) => item.role === role,
      )

      invariant(
        worker,
        `Invocation ${invocationId} declares no evidence worker for role ` +
          `'${role}'. Declared roles: ` +
          ((invocation.evidence_workers ?? [])
            .map((item) => item.role)
            .join(', ') || 'none') +
          `. Use role '${STAGE_WORKER_ROLE}' for the stage worker itself.`,
        { code: 'EVIDENCE_ROLE_UNKNOWN' },
      )

      const recordedAttempts = new Set(
        recordedForRole.map((item) => item.attempt),
      )
      const declaredAttempts = [...(worker.attempts ?? [])].sort(
        (left, right) => right.attempt - left.attempt,
      )
      // Only the latest declared attempt is attachable. An older attempt
      // left unrecorded stays unrecorded, because a handle that attaches
      // behind an attempt that already carries one names the wrong launch.
      const latestDeclared = declaredAttempts[0]
      const attachable =
        options.newAttempt === true ||
        latestDeclared === undefined ||
        recordedAttempts.has(latestDeclared.attempt)
          ? undefined
          : latestDeclared

      // `prepare` allocates the evidence paths before launch. Recording the
      // handle afterwards attaches it to that allocation, whether or not the
      // worker already wrote its report. A role whose latest attempt already
      // carries a handle receives a new attempt, and so does a caller that
      // asked for one because it relaunched an unrecorded worker.
      attempt =
        attachable?.attempt ??
        Math.max(
          attempt,
          // A new attempt sits above every declared one. Without this floor
          // an unrecorded earlier attempt lowers the count and the fresh
          // allocation lands back on paths another launch already owns.
          (latestDeclared?.attempt ?? 0) + 1,
          nextAttemptOrdinal(
            resolveRunLayout(root, runId).evidence('.').absolute,
            `${invocationId}.${role}-evidence`,
            '.md',
          ),
        )

      const existing = (worker.attempts ?? []).find(
        (item) => item.attempt === attempt,
      )

      evidenceAttempt = existing ?? {
        attempt,
        ...evidenceWorkerAttemptPaths(root, runId, invocationId, role, attempt),
        recorded_at: now(),
      }
      declaredPaths = [
        evidenceAttempt.brief_path,
        evidenceAttempt.evidence_path,
      ]
      harnessPaths = [evidenceAttempt.brief_path]

      if (!existing) {
        worker.attempts = [...(worker.attempts ?? []), evidenceAttempt]
        const cardPath = resolveRunLayout(root, runId).invocation(
          invocationId,
          '.md',
        ).relative
        const cardDigest =
          invocation.contract_manifest?.contract_sha256 ?? 'unavailable'
        warnings.push(
          `Recording role '${role}' allocated attempt ${attempt} and would ` +
            `change the paths required by prepared card '${cardPath}' ` +
            `(sha256:${cardDigest}); continuing.`,
        )
        writeTextAtomic(
          resolveInside(root, evidenceAttempt.brief_path),
          renderEvidenceWorkerBrief(invocation, {
            ...worker,
            brief_path: evidenceAttempt.brief_path,
            evidence_path: evidenceAttempt.evidence_path,
          }),
        )

        // A stage worker that was already launched is holding the card whose
        // digest it attested, and re-rendering moves that digest under it.
        // The new attempt still reaches the invocation record, so the watch
        // and the worker-state view see it; only the card the running worker
        // holds stays as it read it.
        if (recordedStageWorker(state, invocationId)) {
          writeJsonAtomic(resolveInside(root, jsonPath), invocation)
        } else {
          rerenderInvocationArtifacts(root, invocation, jsonPath)
        }
      }
    }

    const record: DelegatedWorkerRecord = {
      invocation_id: invocationId,
      role,
      attempt,
      handle,
      ...(options.agent ? { agent: options.agent } : {}),
      ...(options.model ? { model: options.model } : {}),
      launch_mode: options.launchMode ?? 'unknown',
      launched_at: now(),
      declared_paths: declaredPaths,
      ...(harnessPaths.length > 0 ? { harness_paths: harnessPaths } : {}),
    }

    state.delegated_workers = [...(state.delegated_workers ?? []), record]
    state.updated_at = now()
    persistRun(root, state, 'delegated_worker_recorded', {
      invocation_id: invocationId,
      role,
      attempt,
      handle,
    })

    return {
      record,
      ...(evidenceAttempt ? { evidence_attempt: evidenceAttempt } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    }
  })
}

export interface ArmWorkerWatchOptions extends WatchOptions {
  /** Named agent definition the supervisor launched, when it reported one. */
  workerAgent?: string
  workerModel?: string
}

/**
 * Arm the watch over a delegated worker, recording the platform handle the
 * supervisor supplies with it.
 *
 * `pan worker record` asked the supervisor to remember a separate command,
 * and no Phase 3 run ever recorded a handle. The arming is an action the
 * supervisor already owes for every launch, so the handle rides along with
 * it. A watch armed without one still arms, and the launch record says that
 * none was supplied rather than leaving the absence unexplained.
 */
export async function armWorkerWatch(
  root: string,
  runId: string,
  options: ArmWorkerWatchOptions = {},
): Promise<WatchResult> {
  const handle = options.workerHandle?.trim()

  if (handle) {
    const invocationId = resolveWatchedInvocation(
      root,
      runId,
      options.invocationId,
    ).invocation_id
    const recorded = describeDelegatedWorkers(root, runId, {
      invocationId,
      role: STAGE_WORKER_ROLE,
    })

    // Re-arming a watch over the same worker is ordinary supervision, not a
    // second launch, so the same handle records once.
    if (!recorded.some((worker) => worker.handle === handle)) {
      recordDelegatedWorker(root, runId, {
        handle,
        invocationId,
        ...(options.workerAgent ? { agent: options.workerAgent } : {}),
        ...(options.workerModel ? { model: options.workerModel } : {}),
        launchMode: options.markBackground ? 'background' : 'unknown',
      })
    }
  }

  return watchInvocation(root, runId, options)
}

/** One declared path of a delegated worker, as it stands on disk. */
export interface DelegatedWorkerPathState {
  path: string
  /**
   * Who writes this path. An evidence worker's brief is `harness`: it exists
   * from the moment of the launch record and says nothing about the worker.
   */
  producer: 'worker' | 'harness'
  exists: boolean
  size: number | null
  modified_at: string | null
}

export interface DelegatedWorkerStateView {
  run_id: string
  invocation_id: string
  role: string
  attempt: number
  handle: string
  agent: string | null
  model: string | null
  launch_mode: DelegatedWorkerRecord['launch_mode']
  launched_at: string
  seconds_since_launch: number
  declared_paths: DelegatedWorkerPathState[]
  /**
   * Not one path the worker itself owns exists. The worker died before its
   * first write, and the handle is the only evidence the launch happened at
   * all. The harness-written brief of an evidence worker is excluded, because
   * counting it would report every such worker as having written.
   */
  wrote_nothing: boolean
  /** Terminal state of the watch over the worker's invocation, when armed. */
  watch_terminal_state: string | null
  /**
   * The evidence-complete watch recorded this role's report as complete in
   * the invocation's ready marker. Always false for the stage worker.
   */
  evidence_ready: boolean
}

/**
 * Report the last known state of every delegated worker the run recorded.
 *
 * `ORCH-001` used to leave the supervisor reading a transcript's size and
 * modification time, which are not liveness signals. This is the answer that
 * is: the recorded handle, when it was launched, and whether the worker has
 * written anything since.
 */
export function describeDelegatedWorkers(
  root: string,
  runId: string,
  options: { invocationId?: string; role?: string } = {},
): DelegatedWorkerStateView[] {
  const state = loadState(root, runId)
  const nowMs = Date.now()

  return (state.delegated_workers ?? [])
    .filter(
      (record) =>
        (options.invocationId === undefined ||
          record.invocation_id === options.invocationId) &&
        (options.role === undefined || record.role === options.role),
    )
    .map((record) => {
      const harnessPaths = new Set(record.harness_paths ?? [])
      const declared = record.declared_paths.map(
        (relative): DelegatedWorkerPathState => {
          const producer = harnessPaths.has(relative) ? 'harness' : 'worker'

          try {
            const stats = statSync(resolveInside(root, relative))

            return {
              path: relative,
              producer,
              exists: true,
              size: stats.size,
              modified_at: new Date(stats.mtimeMs).toISOString(),
            }
          } catch {
            return {
              path: relative,
              producer,
              exists: false,
              size: null,
              modified_at: null,
            }
          }
        },
      )

      return {
        run_id: runId,
        invocation_id: record.invocation_id,
        role: record.role,
        attempt: record.attempt,
        handle: record.handle,
        agent: record.agent ?? null,
        model: record.model ?? null,
        launch_mode: record.launch_mode,
        launched_at: record.launched_at,
        seconds_since_launch: (nowMs - Date.parse(record.launched_at)) / 1000,
        declared_paths: declared,
        wrote_nothing: declared
          .filter((item) => item.producer === 'worker')
          .every((item) => !item.exists),
        watch_terminal_state:
          summarizeDelegationWatch(root, runId, record.invocation_id)
            .terminal_state ?? null,
        evidence_ready:
          readEvidenceReady(root, runId, record.invocation_id)?.roles.some(
            (role) => role.role === record.role,
          ) ?? false,
      }
    })
}

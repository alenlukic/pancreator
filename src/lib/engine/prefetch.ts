/**
 * Detached low-priority prefetch of the ship release profile: when a submission
 * starts one, how its child runs, and how a run lists and stops its children.
 */

import { spawn } from 'node:child_process'
import { setPriority } from 'node:os'
import { fileURLToPath } from 'node:url'

import {
  fileExists,
  isRecord,
  readJson,
  resolveInside,
  writeJsonAtomic,
} from '../io.js'
import {
  nextPrefetchAttempt,
  prefetchRecordPath,
  prefetchRecordPaths,
} from '../run-layout.js'
import { effectiveRepositoryCheckProfile } from '../verification.js'
import {
  HARNESS_LAUNCH_TOKEN_ENV,
  newHarnessLaunchToken,
} from '../repository-checks.js'
import {
  gateCacheEnabled,
  gateCacheKey,
  gateCacheLookupForGate,
  repositoryCheckGateCommand,
} from '../gate-cache.js'
import { now } from '../state.js'
import type {
  RunState,
  StageDefinition,
  StageOutcome,
  WorkflowDefinition,
} from '../types.js'

import { persistRun } from './core.js'

/** Set to `0` to stop the speculative release-profile prefetch. */
export const PREFETCH_RELEASE_PROFILE_ENV = 'PAN_PREFETCH_FULL'

/** Lower scheduling priority for the prefetch child, on a nice-like scale. */
const PREFETCH_PROCESS_PRIORITY = 10

/** What the harness recorded about one speculative release-profile child. */
export interface ReleaseProfilePrefetchRecord {
  profile: string
  pid: number
  workspace_fingerprint: string
  started_at: string
  evidence_path: string
}

/**
 * The repository-check profile an entry gate of this workflow will run, under
 * the run's own verification level. A level that disables the gate maps it to
 * nothing, and a prefetch for that run would compute a result nobody reads.
 */
function entryGateRepositoryCheckProfile(
  workflow: WorkflowDefinition,
  state: RunState,
): string | null {
  for (const stage of workflow.stages) {
    const criterionId = stage.entry_gate?.criterion

    if (!criterionId) {
      continue
    }

    const criterion = stage.criteria.find((item) => item.id === criterionId)

    if (!criterion || criterion.type !== 'shell') {
      continue
    }

    const { profile } = effectiveRepositoryCheckProfile(
      state.verification,
      criterion,
    )

    if (profile) {
      return profile
    }
  }

  return null
}

/**
 * Start computing the release profile while the read-only evidence stage runs.
 *
 * The inputs of the entry gate stopped changing when the source stage passed,
 * so the answer can be computed during the stage that reads the work rather
 * than at the gate that waits for it. The child is detached and unreferenced
 * because nothing joins it: a clean result reaches the gate through the
 * recorded-pass store, and a killed, failed, or unfinished child simply
 * leaves no entry, which is today's behaviour.
 */
export function startReleaseProfilePrefetch(
  root: string,
  state: RunState,
  profile: string,
  workspaceFingerprint: string,
): ReleaseProfilePrefetchRecord | null {
  const cliPath = fileURLToPath(new URL('../../cli.js', import.meta.url))
  const startedAt = now()
  // The child proves it is this launch by presenting the token whose digest
  // the record below carries. The record lands before the spawn so the child
  // can never look for it too early, and the token itself never reaches disk.
  const launch = newHarnessLaunchToken()
  const evidence = prefetchRecordPath(
    root,
    state.run_id,
    profile,
    nextPrefetchAttempt(root, state.run_id, profile),
  )

  const record = {
    schema_version: 1,
    run_id: state.run_id,
    profile,
    workspace_fingerprint: workspaceFingerprint,
    started_at: startedAt,
    launch_digest: launch.digest,
  }

  writeJsonAtomic(evidence.absolute, record)

  const child = spawn(
    process.execPath,
    [
      cliPath,
      'repository-check',
      profile,
      '--run',
      state.run_id,
      '--harness-initiated',
    ],
    {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, [HARNESS_LAUNCH_TOKEN_ENV]: launch.token },
    },
  )

  if (child.pid === undefined) {
    return null
  }

  try {
    setPriority(child.pid, PREFETCH_PROCESS_PRIORITY)
  } catch {
    // Priority is an optimization; a platform that refuses it still prefetches.
  }

  child.unref()

  // Keyed to the launch: a second qualifying submission for the same run and
  // profile writes its own marker rather than erasing the record of a child
  // that may still be running.
  writeJsonAtomic(evidence.absolute, { ...record, pid: child.pid })

  return {
    profile,
    pid: child.pid,
    workspace_fingerprint: workspaceFingerprint,
    started_at: startedAt,
    evidence_path: evidence.relative,
  }
}

/** One recorded prefetch launch, reconciled against the process table. */
export interface ReleaseProfilePrefetchState extends ReleaseProfilePrefetchRecord {
  /** The recorded pid still names a live process. */
  running: boolean
}

/** Whether a pid names a process this user can still signal. */
function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch (error) {
    // A live process owned by another user answers EPERM, which is still a
    // process. Only ESRCH means the pid names nothing.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Every prefetch launch a run recorded, with its current process state.
 *
 * A marker whose pid no longer names a process is a child that finished,
 * crashed, or was killed. All three are finished as far as the run is
 * concerned: a clean result already reached the recorded-pass store, and
 * anything else leaves the gate free to execute the profile itself.
 */
export function releaseProfilePrefetches(
  root: string,
  runId: string,
): ReleaseProfilePrefetchState[] {
  const states: ReleaseProfilePrefetchState[] = []

  for (const relative of prefetchRecordPaths(root, runId)) {
    const absolute = resolveInside(root, relative)

    if (!fileExists(absolute)) {
      continue
    }

    const record = readJson(absolute)

    if (!isRecord(record) || typeof record.pid !== 'number') {
      continue
    }

    states.push({
      profile: String(record.profile ?? ''),
      pid: record.pid,
      workspace_fingerprint: String(record.workspace_fingerprint ?? ''),
      started_at: String(record.started_at ?? ''),
      evidence_path: relative,
      running: processIsAlive(record.pid),
    })
  }

  return states
}

/**
 * Stop every prefetch child this run started and is still running.
 *
 * Nothing joins a prefetch, so a run that ends while one is alive leaves a
 * process consuming a machine nobody is watching. The gate it was computing
 * for will never run.
 */
function stopReleaseProfilePrefetches(
  root: string,
  runId: string,
): ReleaseProfilePrefetchState[] {
  const stopped: ReleaseProfilePrefetchState[] = []

  for (const prefetch of releaseProfilePrefetches(root, runId)) {
    if (!prefetch.running) {
      continue
    }

    try {
      process.kill(prefetch.pid, 'SIGTERM')
      stopped.push(prefetch)
    } catch {
      // The child exited between the liveness read and the signal, which is
      // the state this call was trying to reach.
    }
  }

  return stopped
}

/** Stop the run's surviving prefetch children and record what was stopped. */
export function recordStoppedPrefetches(root: string, state: RunState): void {
  const stopped = stopReleaseProfilePrefetches(root, state.run_id)

  if (stopped.length > 0) {
    persistRun(root, state, 'release_profile_prefetch_stopped', {
      stopped: stopped.map((prefetch) => ({
        profile: prefetch.profile,
        pid: prefetch.pid,
        evidence_path: prefetch.evidence_path,
      })),
    })
  }
}

/**
 * The release profile this submission should start computing now, or null.
 *
 * Only a passing source stage that hands the run to a read-only evidence
 * stage qualifies: its workspace stops changing at that moment, and the
 * evidence stage is long enough to absorb the work. A level that disables the
 * entry gate, a disabled gate cache, or the operator's own switch each leave
 * the gate to run the profile itself.
 */
export function pendingReleaseProfilePrefetch(
  root: string,
  state: RunState,
  workflow: WorkflowDefinition,
  stage: StageDefinition,
  outcome: StageOutcome,
  workspaceFingerprint: string,
): { profile: string; workspace_fingerprint: string } | null {
  if (
    outcome !== 'success' ||
    stage.workspace_policy !== 'source_allowed' ||
    state.status !== 'running' ||
    state.current_stage === null ||
    process.env[PREFETCH_RELEASE_PROFILE_ENV] === '0' ||
    !gateCacheEnabled()
  ) {
    return null
  }

  const nextStage = workflow.stages.find(
    (candidate) => candidate.slug === state.current_stage,
  )

  if (nextStage?.workspace_policy !== 'read_only') {
    return null
  }

  const profile = entryGateRepositoryCheckProfile(workflow, state)

  if (!profile) {
    return null
  }

  // A recorded pass at this fingerprint already satisfies the gate, so a
  // second computation of the same answer would be the waste this removes.
  if (
    gateCacheLookupForGate(
      root,
      gateCacheKey(
        root,
        workspaceFingerprint,
        repositoryCheckGateCommand(profile),
      ),
    ).entry
  ) {
    return null
  }

  return { profile, workspace_fingerprint: workspaceFingerprint }
}

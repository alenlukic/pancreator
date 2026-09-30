/**
 * One wake's observation of an invocation: its output, evidence paths,
 * workspace fingerprint, and the launched agent's activity.
 */

import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import {
  gitWorkspaceActivityFingerprint,
  gitWorkspaceSnapshot,
} from '../git.js'
import {
  getAgentByRunInvocation,
  readAgentActivity,
  type AgentActivity,
} from '../agent-index.js'
import { fileExists, isRecord, readText, resolveInside, sha256 } from '../io.js'
import { isUntouchedScaffold } from '../requirements/scaffold.js'
import { resolveRunLayout } from '../run-layout.js'
import type { Invocation } from '../types.js'

import {
  type AgentStopReason,
  DEFAULT_WATCH_CADENCE_SECONDS,
  type WatchedPathObservation,
  type WatchObservation,
} from './types.js'
import {
  backgroundMarkerPath,
  evidenceReadyPath,
  evidenceWatchLockPath,
  evidenceWatchRecordPath,
  foregroundReturnRecordPath,
  watchLockPath,
  watchRecordPath,
} from './paths.js'
import { launchedMsFromRecord, readLaunchRecord } from './launch.js'
import { BLOCKED_OUTPUT_SNAPSHOT_PATTERN } from './blocked-snapshot.js'

/**
 * Returns whether a root-relative path exists, with its size and modification
 * time. A missing or unreadable path reports `exists: false` instead of
 * throwing.
 */
export function observePath(
  root: string,
  relativePath: string,
): WatchedPathObservation {
  try {
    const stats = statSync(resolveInside(root, relativePath))

    return {
      path: relativePath,
      exists: true,
      size: stats.size,
      mtime_ms: stats.mtimeMs,
    }
  } catch {
    return { path: relativePath, exists: false, size: null, mtime_ms: null }
  }
}

/**
 * Evidence paths the invocation owns: the files already on disk under the
 * `<invocation-id>` name prefix, plus every evidence-worker report the
 * invocation declares.
 *
 * The listing alone cannot see a report nobody has written, so a watch armed
 * before an evidence worker produced anything read its absence as no change
 * at all. Declaring the path makes that report pending rather than invisible.
 */
export function invocationEvidencePaths(
  root: string,
  runId: string,
  invocation: Pick<Invocation, 'invocation_id' | 'evidence_workers'>,
): string[] {
  const invocationId = invocation.invocation_id
  const evidenceDir = resolveRunLayout(root, runId).evidence('.')
  const own = new Set([
    path.basename(watchRecordPath(root, runId, invocationId)),
    path.basename(backgroundMarkerPath(root, runId, invocationId)),
    path.basename(foregroundReturnRecordPath(root, runId, invocationId)),
    path.basename(watchLockPath(root, runId, invocationId)),
    path.basename(evidenceWatchRecordPath(root, runId, invocationId)),
    path.basename(evidenceWatchLockPath(root, runId, invocationId)),
    path.basename(evidenceReadyPath(root, runId, invocationId)),
  ])
  const paths = new Set<string>()

  try {
    for (const name of readdirSync(evidenceDir.absolute)) {
      if (name.startsWith(invocationId) && !own.has(name)) {
        paths.add(path.posix.join(evidenceDir.relative, name))
      }
    }
  } catch {
    // A run whose evidence directory does not exist yet still declares paths.
  }

  // Every attempt of a role, not the role's first path alone: a relaunched
  // worker writes its own report, and the watch is what says that report is
  // still pending.
  for (const worker of invocation.evidence_workers ?? []) {
    for (const declared of [
      worker.evidence_path,
      ...(worker.attempts ?? []).map((attempt) => attempt.evidence_path),
    ]) {
      if (typeof declared === 'string') {
        paths.add(declared)
      }
    }
  }

  return [...paths].sort()
}

/**
 * Declared required fields the observed output document does not carry.
 *
 * `required_data` keys are dotted paths under `data`. `result` is checked
 * alongside them because a submission without it is rejected, so a document
 * missing it is not one the supervisor could submit. The scaffold emits
 * `result`, so an untouched scaffold reaches this check with nothing
 * missing; `output_is_scaffold` is what separates a scaffold from a
 * finished output.
 */
export function missingRequiredOutputFields(
  parsed: unknown,
  requiredData: Record<string, string> | undefined,
): string[] {
  if (!isRecord(parsed)) {
    return []
  }

  const missing: string[] = []

  if (typeof parsed.result !== 'string' || parsed.result.trim().length === 0) {
    missing.push('result')
  }

  for (const dotted of Object.keys(requiredData ?? {})) {
    let current: unknown = parsed.data

    for (const key of dotted.split('.')) {
      current = isRecord(current) ? current[key] : undefined
    }

    if (current === undefined || current === null) {
      missing.push(`data.${dotted}`)
    }
  }

  return missing
}

/**
 * Digest of every regular file under one directory tree by relative path,
 * size, and mtime. The run's `agent/` tree is small, so a full walk per wake
 * costs less than one missed evidence write.
 */
function directoryTreeFingerprint(
  directory: string,
  exclude: (relativePath: string) => boolean,
): string {
  const lines: string[] = []
  const pending = [directory]

  while (pending.length > 0) {
    const current = pending.pop() as string
    let names: string[]

    try {
      names = readdirSync(current)
    } catch {
      continue
    }

    for (const name of names) {
      const absolute = path.join(current, name)

      try {
        const stats = statSync(absolute)

        if (stats.isDirectory()) {
          pending.push(absolute)
        } else if (stats.isFile()) {
          const relative = path.relative(directory, absolute)

          if (!exclude(relative)) {
            lines.push(`${relative}:${stats.size}:${stats.mtimeMs}`)
          }
        }
      } catch {
        continue
      }
    }
  }

  return sha256(lines.sort().join('\n'))
}

/**
 * Fingerprint of the workspace the invocation edits, or null when the
 * invocation names no readable workspace. Failures are swallowed: a watch
 * must never die because a fingerprint could not be taken.
 */
function workspaceFingerprint(
  root: string,
  invocation: Invocation,
): string | null {
  const declared = invocation.workspace_root

  if (typeof declared !== 'string' || declared.length === 0) {
    return null
  }

  const workspace = path.isAbsolute(declared)
    ? declared
    : path.resolve(root, declared)

  if (!fileExists(workspace)) {
    return null
  }

  try {
    return gitWorkspaceActivityFingerprint(workspace)
  } catch {
    return null
  }
}

/** Inspect the invocation's output and evidence paths once. */
export const OUTPUT_SCAFFOLD_ORDER_ADVISORY =
  'OUTPUT_SCAFFOLD_MISSING_BEFORE_WORKSPACE_CHANGE'

function workspaceChangedFromInvocation(
  root: string,
  invocation: Invocation,
): boolean | null {
  const declared = invocation.workspace_root

  if (typeof declared !== 'string' || declared.length === 0) {
    return null
  }

  const workspace = path.isAbsolute(declared)
    ? declared
    : path.resolve(root, declared)

  if (!fileExists(workspace)) {
    return null
  }

  try {
    return (
      gitWorkspaceSnapshot(workspace).fingerprint !==
      invocation.workspace_before.fingerprint
    )
  } catch {
    return null
  }
}

/**
 * The indexed agent behind one invocation: the launch record's handle when
 * the index knows it, else the newest agent registered for the run and
 * invocation ids its task text named.
 */
export function watchedAgentActivity(
  root: string,
  invocation: Invocation,
  nowMs: number,
  cadenceSeconds: number,
): AgentActivity | null {
  const handle = readLaunchRecord(
    root,
    invocation.run_id,
    invocation.invocation_id,
  )?.worker_handle

  const byHandle = handle
    ? readAgentActivity(root, handle, nowMs, cadenceSeconds)
    : null

  if (byHandle) {
    return byHandle
  }

  const registered = getAgentByRunInvocation(
    root,
    invocation.run_id,
    invocation.invocation_id,
  )

  return registered
    ? readAgentActivity(root, registered.agent_id, nowMs, cadenceSeconds)
    : null
}

/**
 * What an agent stop decides for a run-scoped watch. A completed stop with a
 * terminal output completes on the agent's own state; a stop with an error,
 * an abort, or no terminal output ends the watch unverified with the reason.
 */
export function agentStopVerdict(
  observation: WatchObservation,
):
  | { terminal: 'completed'; basis: 'agent_state' }
  | { terminal: 'unverified'; reason: AgentStopReason }
  | null {
  const stop = observation.agent_activity?.stop

  if (!stop) {
    return null
  }

  if (stop.status === 'error') {
    return { terminal: 'unverified', reason: 'agent_stopped_error' }
  }

  if (stop.status === 'aborted') {
    return { terminal: 'unverified', reason: 'agent_stopped_aborted' }
  }

  return isTerminalObservation(observation)
    ? { terminal: 'completed', basis: 'agent_state' }
    : { terminal: 'unverified', reason: 'agent_stopped_without_output' }
}

/**
 * Takes one watch observation of an invocation: whether its output exists,
 * parses, matches the invocation, is still the scaffold, or lacks required
 * fields, plus the watched output and evidence paths, run-tree and workspace
 * fingerprints, and the launched agent's activity. The combined `fingerprint`
 * changes whenever the worker makes progress; the watch's own records and
 * markers are excluded so a stall stays observable. Reads only.
 */
export function observeInvocation(
  root: string,
  invocation: Invocation,
  cadenceSeconds: number = DEFAULT_WATCH_CADENCE_SECONDS,
): WatchObservation {
  const outputPath = invocation.output.path
  const outputAbsolute = resolveInside(root, outputPath)

  let outputPresent = false
  let outputParses = false
  let outputMatches = false
  let outputIsScaffold = false

  let missingRequired: string[] = []

  if (fileExists(outputAbsolute)) {
    outputPresent = true

    try {
      const parsed = JSON.parse(readText(outputAbsolute)) as unknown

      outputParses = isRecord(parsed)
      outputMatches =
        isRecord(parsed) &&
        (parsed.invocation_id === invocation.invocation_id ||
          // A revision submission names the current card inside its patch.
          (isRecord(parsed.patch) &&
            parsed.patch.invocation_id === invocation.invocation_id))
      outputIsScaffold = isUntouchedScaffold(parsed)
      // A revision patch declares only the fields it changes, so the whole
      // contract cannot be required of it.
      missingRequired =
        isRecord(parsed) && isRecord(parsed.patch)
          ? []
          : missingRequiredOutputFields(
              parsed,
              invocation.output?.required_data,
            )
    } catch {
      outputParses = false
    }
  }

  // The delegation artifact is the worker's input, not its product. A change
  // to it is the supervisor re-rendering a card, so counting it as progress
  // reset the stall count and the confirming wake on an idle worker.
  const watched = [
    outputPath,
    ...invocationEvidencePaths(root, invocation.run_id, invocation),
  ].map((relative) => observePath(root, relative))
  // The watch's own records, the background marker, the preserved blocked
  // outputs, and the event log change on every wake by construction, so they
  // are excluded from the progress digest; otherwise no watch could ever
  // observe a stall.
  const layout = resolveRunLayout(root, invocation.run_id)
  const runTree = directoryTreeFingerprint(layout.root.absolute, (relative) => {
    const name = path.basename(relative)

    return (
      name.endsWith('-watch.jsonl') ||
      name.endsWith('-watch.lock') ||
      name.endsWith('-delegation-background.json') ||
      name.endsWith('-evidence-ready.json') ||
      name.endsWith('-launch.json') ||
      name.endsWith('.delegation.md') ||
      BLOCKED_OUTPUT_SNAPSHOT_PATTERN.test(name) ||
      name === 'events.jsonl' ||
      name === 'state.json' ||
      name.startsWith('.')
    )
  })
  const workspace = workspaceFingerprint(root, invocation)
  const workspaceChanged = outputPresent
    ? null
    : workspaceChangedFromInvocation(root, invocation)
  const observedMs = Date.now()
  const agentActivity = watchedAgentActivity(
    root,
    invocation,
    observedMs,
    cadenceSeconds,
  )
  // A new agent event counts as progress, so a worker that only reads and
  // thinks between turns is never called stalled.
  const fingerprint = [
    ...watched.map(
      (item) => `${item.path}:${item.exists}:${item.size}:${item.mtime_ms}`,
    ),
    `run-tree:${runTree}`,
    `workspace:${workspace ?? 'none'}`,
    `agent:${agentActivity?.signature ?? 'none'}`,
  ].join('|')

  return {
    observed_at: new Date(observedMs).toISOString(),
    output_path: outputPath,
    output_present: outputPresent,
    output_parses: outputParses,
    output_is_scaffold: outputIsScaffold,
    output_missing_required_fields: missingRequired,
    output_matches_invocation: outputMatches,
    watched_paths: watched,
    run_tree_fingerprint: runTree,
    ...(workspace ? { workspace_fingerprint: workspace } : {}),
    ...(workspaceChanged !== null
      ? { workspace_changed_from_invocation: workspaceChanged }
      : {}),
    ...(agentActivity ? { agent_activity: agentActivity } : {}),
    fingerprint,
  }
}

/**
 * The conditions that make an observation terminal.
 *
 * Parsing as a non-scaffold document is not enough: a plausible draft reads
 * exactly like a finished stage until the declared required fields are all
 * there, so the invocation's own output contract decides.
 */
export function isTerminalObservation(observation: WatchObservation): boolean {
  return (
    observation.output_present &&
    observation.output_parses &&
    observation.output_matches_invocation &&
    !observation.output_is_scaffold &&
    (observation.output_missing_required_fields ?? []).length === 0
  )
}

/**
 * Seconds between the launch and the output the watch is about to call
 * terminal, or null when either time is unreadable. The launch time is the
 * one the launch record holds, which is also what the foreground-return
 * attestation reports.
 */
export function launchToOutputSeconds(
  root: string,
  runId: string,
  invocationId: string,
): number | null {
  const launchedMs = launchedMsFromRecord(
    readLaunchRecord(root, runId, invocationId),
  )
  const output = observePath(
    root,
    resolveRunLayout(root, runId).output(invocationId).relative,
  )

  if (launchedMs === null || output.mtime_ms === null) {
    return null
  }

  return (output.mtime_ms - launchedMs) / 1000
}

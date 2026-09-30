/** Numbered snapshots of a `blocked` worker output and their audit events. */

import {
  fileExists,
  isRecord,
  readText,
  resolveInside,
  sha256,
  withOperationMutex,
  writeTextAtomic,
} from '../io.js'
import { resolveRunLayout } from '../run-layout.js'
import { loadState, operationMutexPath, persist } from '../state.js'

/** Snapshots of a `blocked` output, numbered from 1 beside their invocation. */
export const BLOCKED_OUTPUT_SNAPSHOT_PATTERN = /\.blocked-\d+\.json$/u

/**
 * Returns the root-relative path of the numbered snapshot
 * `<invocation>.blocked-<ordinal>.json` that preserves one `blocked` worker
 * output beside its invocation.
 */
export function blockedOutputSnapshotPath(
  root: string,
  runId: string,
  invocationId: string,
  ordinal: number,
): string {
  return resolveRunLayout(root, runId).invocation(
    invocationId,
    `.blocked-${ordinal}.json`,
  ).relative
}

/**
 * How long the snapshot event waits for a `pan` command holding the run mutex.
 *
 * The watched worker runs `./bin/pan` concurrently with the watch by design,
 * so contention here is an expected operational failure. A short wait clears
 * the common collision; a longer one would stall the wake that found it.
 */
const SNAPSHOT_EVENT_MUTEX_WAIT_MS = 250

/**
 * Append the `blocked_output_snapshotted` event, and report whether it landed.
 *
 * Losing the event must never end supervision: the snapshot file is already
 * on disk when this runs, so a contended run mutex costs the event-log entry
 * and nothing else. Every failure is swallowed rather than narrowed to
 * `RUN_OPERATION_IN_PROGRESS`, because no way of failing to write one audit
 * line is worth the watch the run depends on. A later observation retries.
 */
function recordBlockedSnapshotEvent(
  root: string,
  runId: string,
  invocationId: string,
  snapshotPath: string,
  ordinal: number,
): boolean {
  try {
    withOperationMutex(
      operationMutexPath(root, runId),
      () => {
        persist(root, loadState(root, runId), 'blocked_output_snapshotted', {
          invocation_id: invocationId,
          snapshot_path: snapshotPath,
          ordinal,
        })
      },
      { waitForHolderMs: SNAPSHOT_EVENT_MUTEX_WAIT_MS },
    )

    return true
  } catch {
    return false
  }
}

/** Whether the run's event log already names this snapshot. */
function blockedSnapshotEventRecorded(
  root: string,
  runId: string,
  snapshotPath: string,
): boolean {
  const absolute = resolveRunLayout(root, runId).events.absolute

  if (!fileExists(absolute)) {
    return false
  }

  return readText(absolute)
    .split('\n')
    .some((line) => {
      if (!line.includes('blocked_output_snapshotted')) {
        return false
      }

      try {
        const parsed = JSON.parse(line) as unknown

        return (
          isRecord(parsed) &&
          parsed.type === 'blocked_output_snapshotted' &&
          parsed.snapshot_path === snapshotPath
        )
      } catch {
        return false
      }
    })
}

/**
 * Preserve an output that reports `blocked` beside its own invocation.
 *
 * The output path belongs to the invocation rather than to the attempt, so a
 * worker relaunched against the same card rewrites it in place. A `blocked`
 * output is usually the most valuable thing a stage produced — it names the
 * precondition the run lacks — and it is exactly the one the supervisor
 * resolves without submitting, so nothing else in the run ever records it.
 *
 * Returns the snapshot path, or null when there is nothing new to preserve.
 * A second, different blocked output takes the next ordinal; the same one
 * observed again on a later wake is already preserved and writes nothing —
 * except the event a contended earlier observation could not write, which
 * this re-observation takes then.
 */
export function snapshotBlockedOutput(
  root: string,
  runId: string,
  invocationId: string,
): string | null {
  const outputAbsolute = resolveInside(
    root,
    resolveRunLayout(root, runId).output(invocationId).relative,
  )

  if (!fileExists(outputAbsolute)) {
    return null
  }

  let text: string
  let parsed: unknown

  try {
    text = readText(outputAbsolute)
    parsed = JSON.parse(text) as unknown
  } catch {
    return null
  }

  if (!isRecord(parsed) || parsed.result !== 'blocked') {
    return null
  }

  const digest = sha256(text)
  let ordinal = 1

  for (;;) {
    const candidate = blockedOutputSnapshotPath(
      root,
      runId,
      invocationId,
      ordinal,
    )
    const candidateAbsolute = resolveInside(root, candidate)

    if (!fileExists(candidateAbsolute)) {
      writeTextAtomic(candidateAbsolute, text)
      recordBlockedSnapshotEvent(root, runId, invocationId, candidate, ordinal)

      return candidate
    }

    let candidateDigest: string

    try {
      candidateDigest = sha256(readText(candidateAbsolute))
    } catch {
      return null
    }

    if (candidateDigest === digest) {
      // Already preserved. The event it owes the run log is not durable the
      // way the file is, so a contended write on the observation that made
      // this snapshot lands here instead.
      if (!blockedSnapshotEventRecorded(root, runId, candidate)) {
        recordBlockedSnapshotEvent(
          root,
          runId,
          invocationId,
          candidate,
          ordinal,
        )
      }

      return null
    }

    ordinal += 1
  }
}

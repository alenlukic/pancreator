/**
 * Run-relative paths of watch records, locks, and markers, and invocation
 * resolution.
 */

import { invariant } from '../errors.js'
import { fileExists, isRecord, readJson, resolveInside } from '../io.js'
import { resolveRunLayout } from '../run-layout.js'
import { loadState } from '../state.js'
import type { Invocation } from '../types.js'

/**
 * Returns the root-relative path of an invocation's watch ledger,
 * `<invocation>-watch.jsonl`, in the run's evidence directory.
 */
export function watchRecordPath(
  root: string,
  runId: string,
  invocationId: string,
): string {
  return resolveRunLayout(root, runId).evidence(`${invocationId}-watch.jsonl`)
    .relative
}

/**
 * Returns the root-relative path of the marker
 * `<invocation>-delegation-background.json`, which records that the platform
 * turned the launch into a background subagent.
 */
export function backgroundMarkerPath(
  root: string,
  runId: string,
  invocationId: string,
): string {
  return resolveRunLayout(root, runId).evidence(
    `${invocationId}-delegation-background.json`,
  ).relative
}

/**
 * The ownership lock one live watcher holds over its invocation. It is
 * independent of the run-operation mutex: a watch holds it for minutes while
 * ordinary `pan` commands keep mutating the run.
 */
export function watchLockPath(
  root: string,
  runId: string,
  invocationId: string,
): string {
  return resolveRunLayout(root, runId).evidence(`${invocationId}-watch.lock`)
    .relative
}

/**
 * Ledger of the evidence-complete watch. It is separate from the stage
 * watch ledger because the evidence workers and the stage worker share one
 * invocation id: a completed evidence wake in the stage ledger would read as
 * the stage worker's own completion.
 */
export function evidenceWatchRecordPath(
  root: string,
  runId: string,
  invocationId: string,
): string {
  return resolveRunLayout(root, runId).evidence(
    `${invocationId}-evidence-watch.jsonl`,
  ).relative
}

/** Ownership lock of the evidence-complete watch. */
export function evidenceWatchLockPath(
  root: string,
  runId: string,
  invocationId: string,
): string {
  return resolveRunLayout(root, runId).evidence(
    `${invocationId}-evidence-watch.lock`,
  ).relative
}

/** Marker the evidence-complete watch writes when every report is complete. */
export function evidenceReadyPath(
  root: string,
  runId: string,
  invocationId: string,
): string {
  return resolveRunLayout(root, runId).evidence(
    `${invocationId}-evidence-ready.json`,
  ).relative
}

/**
 * Returns the root-relative path of an invocation's foreground-return record,
 * `<invocation>-foreground-return.json`, which attests that a foreground launch
 * returned control.
 */
export function foregroundReturnRecordPath(
  root: string,
  runId: string,
  invocationId: string,
): string {
  return resolveRunLayout(root, runId).evidence(
    `${invocationId}-foreground-return.json`,
  ).relative
}

/**
 * Resolve the invocation a watch targets: the named one, else the run's
 * current pending invocation.
 */
export function resolveWatchedInvocation(
  root: string,
  runId: string,
  invocationId?: string,
): Invocation {
  const state = loadState(root, runId)
  const targetId = invocationId ?? state.current_invocation?.id

  invariant(
    targetId,
    `Run ${runId} has no pending invocation to watch. Name one with --invocation.`,
    { code: 'NO_ACTIVE_INVOCATION' },
  )

  const jsonPath = resolveRunLayout(root, runId).invocation(
    targetId,
    '.json',
  ).relative
  const absolute = resolveInside(root, jsonPath)

  invariant(fileExists(absolute), `Invocation record not found: ${jsonPath}`, {
    code: 'INVOCATION_NOT_FOUND',
  })

  const value = readJson(absolute)

  invariant(
    isRecord(value) && value.invocation_id === targetId,
    `${jsonPath} MUST contain invocation ${targetId}.`,
    { code: 'INVALID_INVOCATION' },
  )

  return value as unknown as Invocation
}

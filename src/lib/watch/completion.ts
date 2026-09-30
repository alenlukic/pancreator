/**
 * Completion evidence for a terminal observation and the foreground-return
 * attestation.
 */

import { invariant } from '../errors.js'
import { resolveInside, writeJsonAtomic } from '../io.js'
import { resolveRunLayout } from '../run-layout.js'

import type {
  CompletionEvidence,
  ForegroundReturnOptions,
  ForegroundReturnRecord,
  WatchAgentState,
  WatchObservation,
} from './types.js'
import {
  foregroundReturnRecordPath,
  resolveWatchedInvocation,
  watchRecordPath,
} from './paths.js'
import {
  isTerminalObservation,
  observeInvocation,
  observePath,
} from './observe.js'
import {
  type LaunchRecordOptions,
  launchRecordPath,
  recordInvocationLaunch,
  resolveLaunchMs,
} from './launch.js'
import {
  type AgentStateEvidence,
  watchWakeSpanSeconds,
} from './process-evidence.js'

/**
 * How strong the evidence is that one observation shows a finished worker.
 *
 * Both the pre-loop check and every wake run this. Run 63310 genre-label
 * showed why: the early-output guard sat only before the timer, so a draft
 * that appeared after the loop started still terminated the watch.
 *
 * Three separate conditions used to end a watch on an answer it did not
 * have — a supervisor's running report, an output younger than one cadence,
 * and an unreadable elapsed time. All three mean the same thing, so all three
 * now produce `weak`, which buys one confirming wake rather than a verdict.
 */
export function completionEvidenceForObservation(
  observation: WatchObservation,
  sinceLaunchSeconds: number | null,
  cadenceSeconds: number,
  agentState?: WatchAgentState,
  agentStateEvidence?: AgentStateEvidence | null,
): CompletionEvidence {
  if (!isTerminalObservation(observation)) {
    return { strength: 'none' }
  }

  if (agentState === 'completed') {
    // A completion report without its recorded inspection is an assertion
    // nobody can audit, so it buys the same confirming wake a running report
    // does. The supplied record keeps the strong basis it validates.
    return agentStateEvidence
      ? { strength: 'strong', basis: 'agent_state' }
      : { strength: 'weak', reason: 'agent_completion_basis_missing' }
  }

  if (agentState === 'running') {
    return { strength: 'weak', reason: 'agent_reported_running' }
  }

  if (sinceLaunchSeconds === null) {
    return { strength: 'weak', reason: 'elapsed_time_unreadable' }
  }

  // An output written within one cadence of the launch is a draft far more
  // often than a finished stage, and files cannot tell the two apart.
  return sinceLaunchSeconds < cadenceSeconds
    ? { strength: 'weak', reason: 'output_younger_than_cadence' }
    : { strength: 'strong', basis: 'output_plausible' }
}

/** One POSIX shell word, safe for any free-text value. */
export function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

/**
 * The observed state of the output file itself, used to decide whether the
 * output moved across a confirming wake. The whole-observation fingerprint
 * cannot answer that: it also covers the run tree and the workspace, which
 * the watch's own records change on every wake.
 */
export function outputSignature(observation: WatchObservation): string {
  const output = observation.watched_paths.find(
    (item) => item.path === observation.output_path,
  )

  return `${output?.exists ?? false}:${output?.size ?? null}:${output?.mtime_ms ?? null}`
}

function foregroundReturnNotTerminalMessage(
  observation: WatchObservation,
): string {
  return (
    `A foreground return cannot be attested: the output ` +
    `${observation.output_path} does not exist. The attestation records a ` +
    `launch the harness saw finish, and the output path is unique to this ` +
    `invocation. When the launch returned before the output existed, await ` +
    `\`pan watch <run-id>\` instead.`
  )
}

/**
 * Record that a foreground launch returned, with the launch and return
 * wall-clock times.
 *
 * The launch time comes from the invocation's launch record. A supervisor
 * that supplies `--launched-at` writes that record here; an arming watch
 * wrote it earlier. Only an attestation with neither falls back to the
 * invocation record's modification time, which is an upper bound on the
 * launch rather than the launch itself.
 */
export function recordForegroundReturn(
  root: string,
  runId: string,
  options: ForegroundReturnOptions = {},
): ForegroundReturnRecord {
  const invocation = resolveWatchedInvocation(root, runId, options.invocationId)
  const invocationId = invocation.invocation_id
  const returnedMs = Date.now()

  // File times carry sub-millisecond precision; `Date.now()` does not, so a
  // fractional mtime taken in the same millisecond would read as later.
  const invocationRecord = observePath(
    root,
    resolveRunLayout(root, runId).invocation(invocationId, '.json').relative,
  )
  const launchOptions: LaunchRecordOptions = {
    ...(options.launchedAt !== undefined
      ? { launchedAt: options.launchedAt }
      : {}),
    defaultLaunchedAtMs: Math.floor(invocationRecord.mtime_ms ?? returnedMs),
    defaultSource: 'invocation_record',
    launchMode: 'foreground',
  }

  const proposedMs = resolveLaunchMs(root, runId, invocationId, launchOptions)

  // A rejected launch time must not reach the record every later reader
  // trusts, so the impossible case fails before the write.
  invariant(
    proposedMs <= returnedMs,
    `The launch time ${new Date(proposedMs).toISOString()} is after the ` +
      `return time ${new Date(returnedMs).toISOString()}.`,
    { code: 'INVALID_ARGUMENT' },
  )

  const launch = recordInvocationLaunch(
    root,
    runId,
    invocationId,
    launchOptions,
  )
  const launchedMs = Date.parse(launch.launched_at)

  // The attestation is evidence that the harness saw the worker finish, so it
  // requires the worker's output to exist rather than the supervisor's word.
  // The output path is unique to the invocation. Whether the output parses
  // and names the invocation is the submission's judgment: a malformed output
  // is still a returned worker, and submit must be able to fail it.
  const observation = observeInvocation(root, invocation)

  invariant(
    observation.output_present,
    foregroundReturnNotTerminalMessage(observation),
    {
      code: 'FOREGROUND_RETURN_NOT_TERMINAL',
      details: {
        output_path: observation.output_path,
        output_present: observation.output_present,
        output_parses: observation.output_parses,
        output_matches_invocation: observation.output_matches_invocation,
      },
    },
  )

  const elapsedSeconds = (returnedMs - launchedMs) / 1000
  const lowerBoundSeconds = watchWakeSpanSeconds(root, runId, invocationId)
  // The record is labeled rather than refused. A return that happened is
  // evidence whether or not its clock agrees with the watch, and refusing it
  // would delete the supervisor's only account of the launch while leaving
  // the disagreement undiagnosed. Naming both numbers puts the contradiction
  // in the durable record, where a reader can act on it.
  const implausible =
    lowerBoundSeconds !== null && elapsedSeconds < lowerBoundSeconds
  const record: ForegroundReturnRecord = {
    schema_version: 1,
    run_id: runId,
    invocation_id: invocationId,
    launch_mode: 'foreground',
    launched_at: launch.launched_at,
    launched_at_source: launch.launched_at_source,
    returned_at: new Date(returnedMs).toISOString(),
    elapsed_seconds: elapsedSeconds,
    elapsed_lower_bound_seconds: lowerBoundSeconds,
    elapsed_implausible: implausible,
    elapsed_implausibility: implausible
      ? `The attested elapsed time ${elapsedSeconds.toFixed(1)}s is shorter ` +
        `than the ${lowerBoundSeconds.toFixed(1)}s the watch record ` +
        `${watchRecordPath(root, runId, invocationId)} spans between its ` +
        `first and last wake, so the launch time ` +
        `${launch.launched_at} (source ${launch.launched_at_source}) is ` +
        `later than the launch actually was.`
      : null,
    observation,
    watch_record_path: watchRecordPath(root, runId, invocationId),
    launch_record_path: launchRecordPath(root, runId, invocationId),
    recorded_at: new Date(returnedMs).toISOString(),
  }

  writeJsonAtomic(
    resolveInside(root, foregroundReturnRecordPath(root, runId, invocationId)),
    record,
  )

  return record
}

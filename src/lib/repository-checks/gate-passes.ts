import path from 'node:path'
import {
  buildGateCacheEntry,
  gateCacheableSnapshot,
  gateCacheKey,
  gateCacheStore,
  repositoryCheckGateCommand,
} from '../gate-cache.js'
import { gitWorkspaceSnapshot } from '../git.js'
import { fileExists, isRecord, readText, writeTextAtomic } from '../io.js'
import {
  attemptStampedName,
  nextAttemptOrdinal,
  resolveRunLayout,
} from '../run-layout.js'
import {
  SUITE_PROFILE_GATE_PROFILE,
  suiteProfileEvidencePath,
} from '../suite-profile.js'
import type { RepositoryCheckResult } from './config.js'
import { summarizeRepositoryCheckResult } from './diagnostics.js'
import type { RepositoryCheckInitiator } from './launch.js'
import { AGENT_REPOSITORY_CHECK_RUNS_FILE } from './ledger.js'

/** A recorded passing execution that answers a repeated request for a profile. */
export interface ReusableProfileExecution {
  profile: string
  invocation_id: string | null
  /** Evidence-worker role the entry belongs to, or `null` for the stage worker. */
  worker_role: string | null
  workspace_fingerprint: string
  started_at: string
  invoked_by: RepositoryCheckInitiator
  /** Captured output of that execution, when it stored a clean pass. */
  evidence_log: string | null
  /** Ledger the entry was read from, so the caller can cite its source. */
  ledger_path: string
}

/**
 * The recorded pass a repeated run-bound profile request reuses, or `null`
 * when the request has to execute (`DEV-001`).
 *
 * A ledger entry answers a later request only when nothing it describes has
 * moved: the same profile, under the same invocation and worker role, at the
 * same Git workspace fingerprint, and passing. A failure has to re-run to
 * show its repair, and any other fingerprint describes a different tree.
 *
 * The role is part of the key because the artifact the key protects is
 * worker-scoped: the two evidence workers of one verify stage share an
 * invocation id, and each owes its own log for the report it writes.
 */
export function reusableProfileExecution(
  root: string,
  runId: string,
  invocationId: string | null,
  profileName: string,
  fingerprint: string,
  workerRole: string | null = null,
): ReusableProfileExecution | null {
  const evidence = resolveRunLayout(root, runId).evidence(
    AGENT_REPOSITORY_CHECK_RUNS_FILE,
  )

  if (!fileExists(evidence.absolute)) {
    return null
  }

  let reusable: ReusableProfileExecution | null = null

  for (const line of readText(evidence.absolute).split('\n')) {
    if (line.trim().length === 0) {
      continue
    }

    let record: unknown

    try {
      record = JSON.parse(line)
    } catch {
      continue
    }

    if (
      !isRecord(record) ||
      record.profile !== profileName ||
      record.status !== 'passed' ||
      record.workspace_fingerprint !== fingerprint ||
      (record.invocation_id ?? null) !== invocationId ||
      (record.worker_role ?? null) !== workerRole
    ) {
      continue
    }

    // The newest matching entry wins: its evidence log is the one a reader
    // sent to these bytes should land on.
    reusable = {
      profile: profileName,
      invocation_id: invocationId,
      worker_role: workerRole,
      workspace_fingerprint: fingerprint,
      started_at:
        typeof record.started_at === 'string' ? record.started_at : '',
      invoked_by: record.invoked_by === 'harness' ? 'harness' : 'agent',
      evidence_log:
        typeof record.evidence_log === 'string' ? record.evidence_log : null,
      ledger_path: evidence.relative,
    }
  }

  return reusable
}

/**
 * Evidence name of one command-line profile execution recorded for a run.
 *
 * The runner writes the artifacts and the recorder looks for them after the
 * execution, so both derive the name from the profile and the fingerprint the
 * store already requires to be unchanged.
 */
export function agentGatePassArtifactStem(
  profileName: string,
  fingerprint: string,
): string {
  return `agent-repository-check-${profileName}-${fingerprint.slice(0, 12)}`
}

/** Artifact id of an agent-run profile execution: the gate-pass stem, stamped with the attempt when it is above 1. */
export function agentGatePassArtifactId(
  profileName: string,
  fingerprint: string,
  attempt = 1,
): string {
  return attemptStampedName(
    agentGatePassArtifactStem(profileName, fingerprint),
    attempt,
    '',
  )
}

/**
 * The ordinal the next permitted execution of one profile owns in a run.
 *
 * A stage with parallel evidence workers permits several agents one run
 * each, and they can land at one workspace fingerprint. Without an ordinal
 * the second execution overwrites the first one's log, and the ledger then
 * carries two entries pointing at one body.
 */
export function nextAgentGatePassAttempt(
  root: string,
  runId: string,
  profileName: string,
  fingerprint: string,
): number {
  return nextAttemptOrdinal(
    resolveRunLayout(root, runId).evidence('.').absolute,
    agentGatePassArtifactStem(profileName, fingerprint),
    '.log',
  )
}

/**
 * Suite-profile artifact a command-line execution of the profiled profile
 * writes for one run, or `null` for a profile the harness does not profile.
 *
 * The gate names this target through `PAN_TEST_PROFILE` before it runs; the
 * command-line runner does the same so a pass it stores carries the profile
 * a later accepting gate reuses instead of re-running the suite.
 */
export function agentGatePassSuiteProfile(
  root: string,
  runId: string,
  profileName: string,
  fingerprint: string,
  attempt = 1,
): { absolute: string; relative: string } | null {
  if (profileName !== SUITE_PROFILE_GATE_PROFILE) {
    return null
  }

  return resolveRunLayout(root, runId).evidence(
    path.basename(
      suiteProfileEvidencePath(
        '.',
        agentGatePassArtifactId(profileName, fingerprint, attempt),
      ),
    ),
  )
}

/** What a stored clean pass left behind, for the caller's own reporting. */
export interface RecordedProfileGatePass {
  cache_key: string
  evidence_path: string
}

export interface RecordProfileGatePassOptions {
  /** Runs the execution is evidence for. The first one holds the log. */
  run_ids: string[]
  /** Git workspace fingerprint observed immediately before the run started. */
  fingerprint_before: string | null
  started_at: string
  /**
   * Ordinal this execution owns among permitted runs at the same fingerprint.
   * The caller resolves it before the run so the suite-profile target and the
   * log agree; omitted, it is resolved here.
   */
  attempt?: number
  /**
   * Who started the execution. The ledger row and this log header report the
   * same provenance because both take this one value from the call site; a
   * header that names its own transport instead can contradict the row.
   */
  initiator?: RepositoryCheckInitiator
}

/**
 * Store a clean command-line profile execution where the submission gate looks
 * for a recorded pass (`DEV-001`).
 *
 * The gate and this runner execute the identical resolved command through the
 * same code, so a pass here answers the gate's question — provided the
 * workspace never moved. The fingerprint bracket is what proves that: an
 * identical Git-visible snapshot before and after the run. Anything weaker
 * stores nothing and the gate executes the profile as it does today. A
 * non-Git workspace fingerprints as one constant and is never stored, and an
 * invocation that named no run has no evidence path inside a run to cite.
 */
export function recordProfileGatePass(
  root: string,
  profileName: string,
  result: RepositoryCheckResult,
  options: RecordProfileGatePassOptions,
): RecordedProfileGatePass | null {
  const runId = options.run_ids[0]

  if (
    runId === undefined ||
    result.status !== 'passed' ||
    options.fingerprint_before === null ||
    result.results.some((entry) => entry.timed_out)
  ) {
    return null
  }

  const snapshot = gitWorkspaceSnapshot(result.workspace_root)

  if (
    !gateCacheableSnapshot(snapshot) ||
    snapshot.fingerprint !== options.fingerprint_before
  ) {
    return null
  }

  const command = repositoryCheckGateCommand(profileName)
  const cacheKey = gateCacheKey(root, snapshot.fingerprint, command)
  const attempt =
    options.attempt ??
    nextAgentGatePassAttempt(root, runId, profileName, snapshot.fingerprint)
  const evidence = resolveRunLayout(root, runId).evidence(
    `${agentGatePassArtifactId(profileName, snapshot.fingerprint, attempt)}.log`,
  )

  // The execution wrote its profile only when this command told the reporter
  // where to put it, which it does for the profiled profile and a named run.
  const suiteProfile = agentGatePassSuiteProfile(
    root,
    runId,
    profileName,
    snapshot.fingerprint,
    attempt,
  )

  // The gate copies these bytes forward as its own evidence, so the log
  // carries the same header and body a gate execution would have written.
  writeTextAtomic(
    evidence.absolute,
    [
      `$ ${command}`,
      `started_at=${options.started_at}`,
      `finished_at=${new Date().toISOString()}`,
      `workspace_fingerprint=${snapshot.fingerprint}`,
      'exit_code=0',
      `invoked_by=${options.initiator ?? 'agent'}`,
      '',
      '--- stdout ---',
      `${JSON.stringify(summarizeRepositoryCheckResult(result).summary, null, 2)}\n`,
      '--- stderr ---',
      '',
    ].join('\n'),
  )

  gateCacheStore(
    root,
    buildGateCacheEntry({
      key: cacheKey,
      criterion_id: `agent:${profileName}`,
      command,
      workspace_fingerprint: snapshot.fingerprint,
      run_id: runId,
      evidence_path: evidence.relative,
      recorded_by: options.initiator ?? 'agent',
      repository_result: result,
      suite_profile_path:
        suiteProfile && fileExists(suiteProfile.absolute)
          ? suiteProfile.relative
          : null,
    }),
  )

  return { cache_key: cacheKey, evidence_path: evidence.relative }
}

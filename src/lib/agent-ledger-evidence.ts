import { fileExists, isRecord, readText } from './io.js'
import { AGENT_REPOSITORY_CHECK_RUNS_FILE } from './repository-checks.js'
import { resolveRunLayout } from './run-layout.js'

/**
 * The one statement a card makes about agent-side profile execution.
 *
 * The card used to carry two: the citable branch permitted an evidence worker
 * one `fast` run, and the superseded branch forbade running the profile at
 * all. A worker that met both had no rule it could follow, so both branches
 * now render this sentence and the branches differ only in what they say
 * about citing the evidence beside it.
 */
export const AGENT_PROFILE_EXECUTION_ALLOWANCE =
  'An evidence worker iterates on the impacted profile plus the tests the ' +
  'change added, may run the fast profile once as the final validation of ' +
  'its own evidence, and never runs the full profile. The harness runs the ' +
  'interior gate profiles at submission and the full profile only as the ' +
  'ship release gate.'

/** One profile execution recorded against a run, whoever started it. */
export interface RecordedProfileRun {
  profile: string
  status: string
  /** `agent` for a worker-started execution, `harness` for harness-started. */
  invokedBy: string
  invocationId: string | null
  fingerprint: string
  startedAt: string
  /** Captured output of that execution, when it stored one. */
  evidencePath: string | null
  ledgerPath: string
}

/**
 * Every execution the run's agent profile ledger holds, in recorded order,
 * or `null` when the run has no ledger.
 *
 * `null` and `[]` say different things. An absent ledger means nothing was
 * recorded, which a reader may resolve from another source; an empty ledger
 * means the record exists and holds no execution.
 */
export function recordedProfileRuns(
  root: string,
  runId: string,
): RecordedProfileRun[] | null {
  const ledger = resolveRunLayout(root, runId).evidence(
    AGENT_REPOSITORY_CHECK_RUNS_FILE,
  )

  if (!fileExists(ledger.absolute)) {
    return null
  }

  const runs: RecordedProfileRun[] = []

  for (const line of readText(ledger.absolute).split('\n')) {
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
      typeof record.profile !== 'string' ||
      typeof record.status !== 'string' ||
      typeof record.workspace_fingerprint !== 'string'
    ) {
      continue
    }

    runs.push({
      profile: record.profile,
      status: record.status,
      invokedBy:
        typeof record.invoked_by === 'string' ? record.invoked_by : 'agent',
      invocationId:
        typeof record.invocation_id === 'string' ? record.invocation_id : null,
      fingerprint: record.workspace_fingerprint,
      startedAt: typeof record.started_at === 'string' ? record.started_at : '',
      evidencePath:
        typeof record.evidence_log === 'string' ? record.evidence_log : null,
      ledgerPath: ledger.relative,
    })
  }

  return runs
}

/** A passing profile execution an agent recorded against a run. */
export interface AgentRecordedProfilePass {
  profile: string
  /** Captured output of that execution, which a reader can cite. */
  evidencePath: string
  fingerprint: string
  invocationId: string | null
  startedAt: string
  /** Ledger the entry was read from, so a card can name its source. */
  ledgerPath: string
}

/**
 * The latest passing execution of each profile an agent recorded against a
 * run (`DEV-001`).
 *
 * A card that reads only stage-history gates and baselines declares a gap
 * whenever the evidence it holds predates the current workspace, even though
 * a worker of this same run already paid for the profile at the fingerprint
 * the card is judging. An entry qualifies only when it names the log it left
 * behind: an entry without one sends a reader nowhere.
 */
export function agentRecordedProfilePasses(
  root: string,
  runId: string,
): AgentRecordedProfilePass[] {
  const byProfile = new Map<string, AgentRecordedProfilePass>()

  for (const run of recordedProfileRuns(root, runId) ?? []) {
    if (run.status !== 'passed' || run.evidencePath === null) {
      continue
    }

    byProfile.set(run.profile, {
      profile: run.profile,
      evidencePath: run.evidencePath,
      fingerprint: run.fingerprint,
      invocationId: run.invocationId,
      startedAt: run.startedAt,
      ledgerPath: run.ledgerPath,
    })
  }

  return [...byProfile.values()]
}

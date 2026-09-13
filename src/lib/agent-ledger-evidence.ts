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
  const ledger = resolveRunLayout(root, runId).evidence(
    AGENT_REPOSITORY_CHECK_RUNS_FILE,
  )

  if (!fileExists(ledger.absolute)) {
    return []
  }

  const byProfile = new Map<string, AgentRecordedProfilePass>()

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
      record.status !== 'passed' ||
      typeof record.profile !== 'string' ||
      typeof record.workspace_fingerprint !== 'string' ||
      typeof record.evidence_log !== 'string'
    ) {
      continue
    }

    byProfile.set(record.profile, {
      profile: record.profile,
      evidencePath: record.evidence_log,
      fingerprint: record.workspace_fingerprint,
      invocationId:
        typeof record.invocation_id === 'string' ? record.invocation_id : null,
      startedAt: typeof record.started_at === 'string' ? record.started_at : '',
      ledgerPath: ledger.relative,
    })
  }

  return [...byProfile.values()]
}

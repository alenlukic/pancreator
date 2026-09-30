import { gateCachePassAtFingerprint } from '../gate-cache.js'
import { gitWorkspaceSnapshot } from '../git.js'
import {
  appendJsonLine,
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
} from '../io.js'
import { panCommand } from '../project-config.js'
import { resolveRunLayout } from '../run-layout.js'
import { liveRunsBoundToWorktree, loadState } from '../state.js'
import { loadWorkflowFile } from '../workflow/load.js'
import { loadRepositoryChecks, type RepositoryCheckResult } from './config.js'
import type { RepositoryCheckInitiator } from './launch.js'

/** Evidence file, relative to a run's `agent/evidence/`, of agent-run profiles. */
export const AGENT_REPOSITORY_CHECK_RUNS_FILE = 'repository-check-runs.jsonl'

/**
 * Append an agent-run profile execution to every live run bound to a worktree.
 *
 * `DEV-001` lets an agent run `fast` at most once, and the supervisor can audit
 * that rule only from harness records. A worker runs
 * `pan repository-check <profile> --worktree <name>` inside its run's
 * worktree, so the run's managed-worktree binding is what resolves it. No
 * bound live run means nothing to record. The record is bounded on purpose:
 * the command output stays on the worker's terminal, and the fingerprint is
 * what lets a later gate compare the execution with the workspace it judges.
 */
export function recordAgentRepositoryCheck(
  root: string,
  worktreeName: string,
  result: RepositoryCheckResult,
  startedAt: string,
  initiator: RepositoryCheckInitiator = 'agent',
): string[] {
  return recordAgentRepositoryCheckForRuns(
    root,
    liveRunsBoundToWorktree(root, worktreeName).map((state) => state.run_id),
    result,
    startedAt,
    initiator,
  )
}

/**
 * Append an agent-run profile execution to the named runs. A worker that names
 * its run with `--run` bypasses the worktree scan, which is the path for a run
 * whose workspace is not a managed worktree. The record names the run's
 * current invocation, so the per-invocation "fast at most once" rule can be
 * counted from the file.
 *
 * `initiator` separates work the harness started for itself, such as the
 * speculative release-profile prefetch, from work an agent ran. Only agent
 * runs count against the per-invocation allowance.
 */
export function recordAgentRepositoryCheckForRuns(
  root: string,
  runIds: string[],
  result: RepositoryCheckResult,
  startedAt: string,
  initiator: RepositoryCheckInitiator = 'agent',
  /**
   * Log this execution left behind, when it stored a clean pass. Two
   * permitted executions at one fingerprint keep separate logs, so an entry
   * that does not name its own log sends a reader to the wrong bytes.
   */
  evidenceLog: string | null = null,
  /**
   * The worker asked for this repeat by name over a reusable recorded pass.
   * Deduplication makes an ordinary repeat invisible in the ledger, so a
   * repeat that did execute has to say that someone chose it.
   */
  forcedRepeat = false,
  /**
   * Declared role of the evidence worker that ran the profile, when one did.
   * Two evidence workers of a stage share an invocation id, so the role is
   * what keeps their entries — and the artifacts those entries name — apart.
   */
  workerRole: string | null = null,
  /** Invocation being prepared, before state.current_invocation is durable. */
  invocationIdOverride: string | null = null,
): string[] {
  const recorded: string[] = []
  let fingerprint: string | null = null

  for (const runId of runIds) {
    fingerprint ??= gitWorkspaceSnapshot(result.workspace_root).fingerprint

    const evidence = resolveRunLayout(root, runId).evidence(
      AGENT_REPOSITORY_CHECK_RUNS_FILE,
    )

    appendJsonLine(evidence.absolute, {
      profile: result.profile,
      invocation_id:
        invocationIdOverride ??
        loadState(root, runId).current_invocation?.id ??
        null,
      ...(workerRole ? { worker_role: workerRole } : {}),
      workspace_fingerprint: fingerprint,
      status: result.status,
      duration_ms: result.total_duration_ms,
      started_at: startedAt,
      invoked_by: initiator,
      ...(evidenceLog ? { evidence_log: evidenceLog } : {}),
      ...(forcedRepeat ? { forced_repeat: true } : {}),
    })
    recorded.push(evidence.relative)
  }

  return recorded
}

/** Diagnostic id for a `fast` profile an invocation's agents ran more than once. */
export const REPOSITORY_CHECK_FAST_REPEATED = 'repository_check_fast_repeated'

/** Diagnostic id for a claimed profile pass absent from the run ledger. */
export const REPOSITORY_CHECK_CLAIM_UNRECORDED =
  'repository_check_claim_unrecorded'

/** A non-blocking observation about the agent-run profiles of one invocation. */
export interface RepositoryCheckAdvisory {
  id:
    | typeof REPOSITORY_CHECK_FAST_REPEATED
    | typeof REPOSITORY_CHECK_CLAIM_UNRECORDED
  message: string
}

/**
 * How many `fast` runs one invocation's agents may record together.
 *
 * Each agent may run `fast` once, and a stage that dispatches parallel
 * evidence workers puts several agents under one invocation: the `verify`
 * stage sends a reviewer and a QA tester, each permitted one run, while the
 * consolidating verifier runs none. The allowance is therefore the number of
 * evidence workers the invocation's stage declares, and one for a stage that
 * declares none. The stage comes from the invocation record, else from the
 * run's current stage, and its definition from the run's own workflow
 * snapshot. A run whose records cannot be read keeps the one-agent allowance.
 */
function agentFastRunAllowance(
  root: string,
  runId: string,
  invocationId: string,
): { allowance: number; evidence_workers: number } {
  const single = { allowance: 1, evidence_workers: 0 }

  try {
    const layout = resolveRunLayout(root, runId)
    const invocationPath = layout.invocation(invocationId, '.json').absolute
    const record = fileExists(invocationPath) ? readJson(invocationPath) : null
    const state = loadState(root, runId)

    const stageSlug =
      isRecord(record) &&
      isRecord(record.stage) &&
      typeof record.stage.slug === 'string'
        ? record.stage.slug
        : state.current_stage

    if (!stageSlug || !state.workflow_snapshot?.path) {
      return single
    }

    const workflow = loadWorkflowFile(
      root,
      resolveInside(root, state.workflow_snapshot.path),
    )
    const workers =
      workflow.stages.find((stage) => stage.slug === stageSlug)
        ?.evidence_workers?.length ?? 0

    return { allowance: Math.max(1, workers), evidence_workers: workers }
  } catch {
    return single
  }
}

/**
 * The prose of a stage output that asserts something on the worker's behalf.
 *
 * A claim is an assertion the worker makes, so the scan reads the summary and
 * each criterion explanation. It deliberately skips findings, risks, and
 * evidence entries: a finding that reports an unrecorded pass, or a note that
 * says a profile passed before the last edit, reads identically to a claim,
 * and an advisory raised against a report of the problem trains a reader to
 * ignore advisories.
 */
function claimStrings(output: unknown): string[] {
  if (!isRecord(output)) {
    return []
  }

  const strings: string[] = []

  if (typeof output.summary === 'string') {
    strings.push(output.summary)
  }

  const criteria = Array.isArray(output.criteria) ? output.criteria : []

  for (const criterion of criteria) {
    if (isRecord(criterion) && typeof criterion.explanation === 'string') {
      strings.push(criterion.explanation)
    }
  }

  return strings
}

function profilePassClaimed(profileName: string, strings: string[]): boolean {
  const escaped = profileName.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const pattern = new RegExp(
    `(?:\\b${escaped}\\b(?:\\s+(?:profile|repository[- ]check))?` +
      `\\s+(?:(?:has|was)\\s+)?pass(?:ed|es)?\\b|` +
      `\\bpass(?:ed|es)?\\s+(?:the\\s+)?${escaped}` +
      `(?:\\s+profile)?\\b)`,
    'iu',
  )

  return strings.some((entry) => pattern.test(entry))
}

/**
 * Profile-pass claims that lack a passing ledger row at the submitted
 * invocation's current workspace fingerprint.
 */
export function unrecordedProfileClaimAdvisories(
  root: string,
  runId: string,
  workspaceFingerprint: string,
  output: unknown,
): RepositoryCheckAdvisory[] {
  const strings = claimStrings(output)
  const claimedProfiles = Object.keys(
    loadRepositoryChecks(root).profiles,
  ).filter((profileName) => profilePassClaimed(profileName, strings))

  if (claimedProfiles.length === 0) {
    return []
  }

  const evidence = resolveRunLayout(root, runId).evidence(
    AGENT_REPOSITORY_CHECK_RUNS_FILE,
  )
  const recorded = new Set<string>()

  if (fileExists(evidence.absolute)) {
    for (const line of readText(evidence.absolute).split('\n')) {
      if (line.trim().length === 0) {
        continue
      }

      try {
        const entry: unknown = JSON.parse(line)

        // Any passing row of this run at this fingerprint answers the
        // claim. Scoping the lookup to the submitting invocation reported a
        // worker that correctly cited an earlier stage's gate evidence as
        // having no evidence at all, and then named a command its own
        // contract forbade it to run.
        if (
          isRecord(entry) &&
          typeof entry.profile === 'string' &&
          entry.workspace_fingerprint === workspaceFingerprint &&
          entry.status === 'passed'
        ) {
          recorded.add(entry.profile)
        }
      } catch {
        continue
      }
    }
  }

  return claimedProfiles
    .filter(
      (profileName) =>
        !recorded.has(profileName) &&
        !gateCachePassAtFingerprint(root, profileName, workspaceFingerprint),
    )
    .map((profileName) => ({
      id: REPOSITORY_CHECK_CLAIM_UNRECORDED,
      message:
        `The output claims the '${profileName}' profile passed, but run ` +
        `'${runId}' holds no passing execution of it at workspace ` +
        `fingerprint '${workspaceFingerprint}': neither a row in ` +
        `${evidence.relative} nor a gate pass. Cite the gate evidence for ` +
        `that profile, or, when your contract permits the execution, run ` +
        `${panCommand(root)} repository-check ${profileName} --run ${runId} ` +
        `so the result is recorded.`,
    }))
}

/**
 * Advisory diagnostics read from a run's agent-run profile records for one
 * invocation. `DEV-001` and `VERIFY-001` let each agent run `fast` at most
 * once, so more `fast` records for the submitting invocation than its stage
 * has agents are reported by name. It never fails a gate: the records are
 * evidence for the supervisor's audit, not a submission requirement.
 */
export function agentRepositoryCheckAdvisories(
  root: string,
  runId: string,
  invocationId: string,
): RepositoryCheckAdvisory[] {
  const evidence = resolveRunLayout(root, runId).evidence(
    AGENT_REPOSITORY_CHECK_RUNS_FILE,
  )

  if (!fileExists(evidence.absolute)) {
    return []
  }

  let fastRuns = 0

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
      isRecord(record) &&
      record.profile === 'fast' &&
      record.invocation_id === invocationId &&
      record.invoked_by !== 'harness'
    ) {
      fastRuns += 1
    }
  }

  if (fastRuns <= 1) {
    return []
  }

  const { allowance, evidence_workers: workers } = agentFastRunAllowance(
    root,
    runId,
    invocationId,
  )

  return fastRuns > allowance
    ? [
        {
          id: REPOSITORY_CHECK_FAST_REPEATED,
          message:
            `Agents ran the fast profile ${fastRuns} times during invocation ` +
            `${invocationId}; the policy allows one run per agent, ` +
            `${allowance} for this stage ` +
            (workers > 0
              ? `(${workers} evidence worker(s))`
              : '(one stage worker)') +
            `. See ${evidence.relative}.`,
        },
      ]
    : []
}

/**
 * Profiles an implementing worker may run itself under `DEV-001` and
 * `REMED-001`: the iteration profile and the cheap static and configuration
 * checks. Every other profile is a suite the exit gate owns.
 */
const WORKER_SANCTIONED_PROFILES = new Set([
  'impacted',
  'static',
  'configuration',
])

/**
 * Agent-run executions of gate-owned suite profiles recorded for one
 * invocation, counted per profile. The sanctioned profiles above are
 * excluded, and so are harness executions such as the release-profile
 * prefetch.
 */
export function agentGateProfileRuns(
  root: string,
  runId: string,
  invocationId: string,
): Record<string, number> {
  const evidence = resolveRunLayout(root, runId).evidence(
    AGENT_REPOSITORY_CHECK_RUNS_FILE,
  )
  const counts: Record<string, number> = {}

  if (!fileExists(evidence.absolute)) {
    return counts
  }

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
      isRecord(record) &&
      typeof record.profile === 'string' &&
      !WORKER_SANCTIONED_PROFILES.has(record.profile) &&
      record.invocation_id === invocationId &&
      record.invoked_by !== 'harness'
    ) {
      counts[record.profile] = (counts[record.profile] ?? 0) + 1
    }
  }

  return counts
}

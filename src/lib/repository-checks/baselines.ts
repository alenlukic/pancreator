import type {
  RepositoryCheckBaselinePointer,
  RepositoryCheckDelta,
  RepositoryCheckDiagnostic,
} from '../types.js'
import type { RepositoryCheckResult } from './config.js'
import {
  failureDiagnostics,
  failureStatuses,
  sortDiagnostics,
} from './diagnostics.js'

const EMBEDDED_DELTA_LIMIT = 100

export interface RepositoryCheckBaselineComparison {
  passed: boolean
  explanation: string
  delta: RepositoryCheckDelta
}

function emptyDelta(): RepositoryCheckDelta {
  return { new: [], fixed: [], carried: [] }
}

/** The two workspaces a baseline comparison spans, when they differ. */
export type BaselineWorkspaceDivergence = NonNullable<
  RepositoryCheckDelta['baseline_workspace_divergence']
>

/**
 * Divergence a run carries when it was graded against a baseline another
 * workspace produced, or `null` when the two are the same tree.
 *
 * Only an adopted baseline can span two trees: a cohort session shares one
 * baseline across chunk runs that each own a worktree (`DEV-001`), and the
 * adopting run is graded against evidence it never observed. A run that
 * captured its own baseline is compared exactly as it was before, whatever
 * absolute path it happens to sit at now.
 *
 * A pointer recorded before the capture path existed asserts nothing about
 * where it ran, so it reports no divergence.
 */
export function adoptedBaselineWorkspaceDivergence(
  pointer: RepositoryCheckBaselinePointer | undefined,
  currentWorkspace: string,
): BaselineWorkspaceDivergence | null {
  const captured = pointer?.capture_workspace_path

  if (
    !pointer?.shared_from_cohort ||
    captured === undefined ||
    captured === currentWorkspace
  ) {
    return null
  }

  return {
    baseline_workspace: captured,
    current_workspace: currentWorkspace,
  }
}

/**
 * Compare a repository-check result with its pre-implementation baseline as a
 * multiset of diagnostic identities.
 *
 * The carried count for an identity is the smaller of the two counts. A positive
 * surplus in the current run is a regression, and a positive surplus in the
 * baseline is a repair. Duplicate identical diagnostics therefore stay
 * distinguishable from one duplicated diagnostic that is genuinely new.
 *
 * A caller that knows the baseline was captured in another workspace passes
 * that divergence in. A new diagnostic is then reported as a divergence
 * rather than attributed to the change, because the tree it ran on is as
 * plausible a cause. The gate still fails, because a new diagnostic is still
 * unexplained.
 */
export function compareRepositoryCheckToBaseline(
  baseline: RepositoryCheckResult,
  current: RepositoryCheckResult,
  divergence: BaselineWorkspaceDivergence | null = null,
): RepositoryCheckBaselineComparison {
  if (current.status === 'not_configured') {
    return {
      passed: false,
      explanation: `Repository check '${current.profile}' is not configured.`,
      delta: emptyDelta(),
    }
  }

  const baselineDiagnostics = failureDiagnostics(baseline)
  const currentDiagnostics = failureDiagnostics(current)

  const added: RepositoryCheckDiagnostic[] = []
  const fixed: RepositoryCheckDiagnostic[] = []
  const carried: RepositoryCheckDiagnostic[] = []

  for (const [key, entry] of currentDiagnostics) {
    const before = baselineDiagnostics.get(key)?.count ?? 0
    const shared = Math.min(before, entry.count)

    if (shared > 0) {
      carried.push({ ...entry.identity, count: shared })
    }

    if (entry.count > before) {
      added.push({ ...entry.identity, count: entry.count - before })
    }
  }

  for (const [key, entry] of baselineDiagnostics) {
    const after = currentDiagnostics.get(key)?.count ?? 0

    if (entry.count > after) {
      fixed.push({ ...entry.identity, count: entry.count - after })
    }
  }

  // A status identity participates only when the two sides disagree about it, so
  // an unchanged exit code adds no noise while a command that starts failing,
  // stops failing, times out, or dies on a signal is always visible.
  const baselineStatuses = failureStatuses(baseline)
  const currentStatuses = failureStatuses(current)

  for (const [key, identity] of currentStatuses) {
    if (baselineStatuses.get(key)?.diagnostic !== identity.diagnostic) {
      added.push({ ...identity, count: 1 })
    }
  }

  for (const [key, identity] of baselineStatuses) {
    if (currentStatuses.get(key)?.diagnostic !== identity.diagnostic) {
      fixed.push({ ...identity, count: 1 })
    }
  }

  const sorted = {
    new: sortDiagnostics(added),
    fixed: sortDiagnostics(fixed),
    carried: sortDiagnostics(carried),
  }
  const delta: RepositoryCheckDelta = {
    new: sorted.new.slice(0, EMBEDDED_DELTA_LIMIT),
    fixed: sorted.fixed.slice(0, EMBEDDED_DELTA_LIMIT),
    carried: sorted.carried.slice(0, EMBEDDED_DELTA_LIMIT),
    counts: {
      new: sorted.new.length,
      fixed: sorted.fixed.length,
      carried: sorted.carried.length,
    },
    ...(sorted.new.length > EMBEDDED_DELTA_LIMIT ||
    sorted.fixed.length > EMBEDDED_DELTA_LIMIT ||
    sorted.carried.length > EMBEDDED_DELTA_LIMIT
      ? { full: sorted }
      : {}),
    ...(divergence ? { baseline_workspace_divergence: divergence } : {}),
  }
  const passed = current.status === 'passed' || sorted.new.length === 0
  const counts =
    `${sorted.new.length} new, ${sorted.fixed.length} fixed, ` +
    `${sorted.carried.length} carried`

  if (!passed) {
    const first = delta.new.find(
      (diagnostic) => !diagnostic.diagnostic.startsWith('<status>'),
    )
    const failure =
      first === undefined
        ? `a new failure state, but its output exposed no genuine failure ` +
          `identity (${counts})`
        : `a new failure in '${first.command}': ${first.diagnostic} (${counts})`

    return {
      passed: false,
      explanation: divergence
        ? `Repository check '${current.profile}' reports ${failure}. Its ` +
          `baseline was captured in '${divergence.baseline_workspace}' and ` +
          `this run executed in '${divergence.current_workspace}', so the ` +
          `difference may belong to the capturing workspace rather than to ` +
          `this change. Reproduce it in the capturing workspace before you ` +
          `treat it as introduced.`
        : `Repository check '${current.profile}' introduced ${failure}.`,
      delta,
    }
  }

  if (current.status === 'passed') {
    return {
      passed: true,
      explanation:
        delta.fixed.length > 0
          ? `Repository check '${current.profile}' passes and repaired ` +
            `${delta.fixed.length} inherited failure identities.`
          : `Repository check '${current.profile}' passes.`,
      delta,
    }
  }

  return {
    passed: true,
    explanation:
      `Repository check '${current.profile}' still reports only failures ` +
      `captured before implementation (${counts}).`,
    delta,
  }
}

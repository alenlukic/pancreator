/**
 * State criteria, ship currency, workspace scope attribution, and the
 * entry-gate criterion.
 */

import path from 'node:path'

import { isRecord, readJson, resolveInside } from '../io.js'
import { repositoryCheckProfileName } from '../repository-checks.js'
import {
  gitHead,
  gitIsAncestor,
  gitWorkspaceSnapshot,
  workspaceChangedPathsFromSnapshots,
} from '../git.js'
import { liveRunsBoundToWorktree } from '../state.js'
import { activeOperatorGateWaivers } from '../waivers.js'
import { isReleaseMetadataPath } from '../versioning.js'
import { judgeShipRepair, shipRepairPaths } from '../ship-repair.js'
import type {
  RunState,
  Criterion,
  DeterministicResult,
  StageHistoryItem,
  StageDefinition,
  WorkspaceSnapshot,
} from '../types.js'
import { runShellCheck } from './shell-check.js'

/**
 * State criteria this module evaluates against the workspace fingerprint a
 * prior stage's evidence was taken at. Any change to the workspace invalidates
 * them, so a route that orders a repair before one of these runs cannot lead
 * straight back to the stage that declares it.
 */
export const FINGERPRINT_BOUND_STATE_CRITERIA: ReadonlySet<string> = new Set([
  'ship.prior_gates_current',
])

/**
 * Evaluate a state criterion against run history. Only
 * `ship.prior_gates_current` has an evaluator: it passes when review and QA (or
 * a joint verify stage) succeeded or are operator-waived, and the QA evidence
 * matches the current or operator-accepted workspace fingerprint. Any other
 * criterion passes.
 */
export function evaluateStateCriterion(
  state: RunState,
  criterion: Criterion,
  workspaceFingerprint: string,
): DeterministicResult {
  let passed = true
  let explanation = 'No specialized state evaluator was required.'

  if (criterion.id === 'ship.prior_gates_current') {
    // The delivery workflow verifies review and QA jointly in one verify
    // stage, so its latest attempt supplies both evidence roles.
    const verify = [...state.stage_history]
      .reverse()
      .find((item) => item.stage === 'verify')
    const review =
      [...state.stage_history]
        .reverse()
        .find((item) => item.stage === 'review') ?? verify
    const test =
      [...state.stage_history]
        .reverse()
        .find((item) => item.stage === 'test') ?? verify

    const activeWaivers = activeOperatorGateWaivers(state, workspaceFingerprint)
    const waiverFor = (stage: string) =>
      [...activeWaivers].reverse().find((waiver) => waiver.stage === stage)

    const reviewWaiver = waiverFor('review') ?? waiverFor('verify')
    const testWaiver = waiverFor('test') ?? waiverFor('verify')
    const reviewSatisfied =
      review?.outcome === 'success' || Boolean(reviewWaiver)
    const testSatisfied = test?.outcome === 'success' || Boolean(testWaiver)

    const testFingerprint = test?.workspace_fingerprint
    const fingerprintCurrent = testFingerprint === workspaceFingerprint
    const operatorAccepted =
      state.accepted_workspace_fingerprint === workspaceFingerprint
    const acceptedEvidenceFingerprint =
      Boolean(testFingerprint) &&
      state.accepted_workspace_fingerprint === testFingerprint

    const gatesCurrent =
      Boolean(testWaiver) ||
      fingerprintCurrent ||
      operatorAccepted ||
      acceptedEvidenceFingerprint
    passed = Boolean(gatesCurrent && reviewSatisfied && testSatisfied)
    const waiverEvidenceBasis = testWaiver
      ? 'The QA waiver is not fingerprint-bound.'
      : fingerprintCurrent
        ? 'Unwaived QA evidence matches the current workspace fingerprint.'
        : 'Unwaived QA evidence matches the operator-accepted workspace fingerprint.'

    explanation = !passed
      ? 'Passing review/QA evidence is missing or stale.'
      : reviewWaiver || testWaiver
        ? `Operator-waived ${[
            reviewWaiver ? 'review' : null,
            testWaiver ? 'QA' : null,
          ]
            .filter(Boolean)
            .join(' and ')} evidence satisfies the gate. ${waiverEvidenceBasis}`
        : review?.outcome === 'success' && fingerprintCurrent
          ? 'Review and QA passed against the current workspace fingerprint.'
          : review?.outcome === 'success' && operatorAccepted
            ? 'Review and QA are stale, but the operator accepted the current workspace as intentional.'
            : acceptedEvidenceFingerprint
              ? 'Review and QA evidence matches the operator-accepted workspace fingerprint.'
              : 'Review and QA passed against the current workspace fingerprint.'
  }

  return {
    id: criterion.id,
    type: 'state',
    hard: Boolean(criterion.hard),
    passed,
    explanation,
    workspace_fingerprint: workspaceFingerprint,
  }
}

/** One accountable window between two workspace fingerprints. */
interface AccountableWindow {
  /** Epoch milliseconds the window closed, used only for ordering. */
  closed_at: number
  before: string | undefined
  after: string
  /** Whether the window's own adjudication permits it to carry the chain. */
  accountable: boolean
  source: 'ship_attempt' | 'attribution'
}

/**
 * Windows recorded after the QA evidence that can account for a workspace
 * delta, newest last.
 *
 * A ship attempt is accountable for the window between its own before and
 * after snapshots, and `scope.no_unapproved_changes` adjudicates that window
 * against the real snapshot delta. An out-of-stage attribution record spans
 * the same kind of window for work the operator directed between stages, but
 * nothing recomputes its delta here: it carries the chain only when the
 * record declares at least one changed path and every path it declares is a
 * release-metadata path.
 */
function accountableWindowsSinceQa(
  state: RunState,
  qaEvidence: StageHistoryItem,
): AccountableWindow[] {
  const qaClosedAt = Date.parse(qaEvidence.submitted_at)
  const shipAttempts = state.stage_history
    .slice(state.stage_history.indexOf(qaEvidence) + 1)
    .filter((item) => item.stage === 'ship')
    .map((attempt): AccountableWindow => {
      const scope = attempt.deterministic.find(
        (result) => result.id === 'scope.no_unapproved_changes',
      )

      return {
        closed_at: Date.parse(attempt.submitted_at),
        before: attempt.workspace_before_fingerprint,
        after: attempt.workspace_fingerprint,
        accountable: !scope || scope.passed,
        source: 'ship_attempt',
      }
    })
  const attributions = (state.workspace_directives ?? [])
    .filter((record) => Date.parse(record.timestamp) > qaClosedAt)
    .map(
      (record): AccountableWindow => ({
        closed_at: Date.parse(record.timestamp),
        before: record.workspace_before_fingerprint,
        after: record.workspace_fingerprint,
        accountable:
          record.changed_paths.length > 0 &&
          record.changed_paths.every(isReleaseMetadataPath),
        source: 'attribution',
      }),
    )

  return [...shipAttempts, ...attributions].sort(
    (left, right) => left.closed_at - right.closed_at,
  )
}

/**
 * Whether the recorded windows since the passing QA evidence form an unbroken
 * accountability chain from the QA fingerprint to the current entry.
 *
 * The chain needs only two things: the first window started at the QA
 * fingerprint, and no window's before-snapshot disagrees with the previous
 * window's after-snapshot. A gap between two windows is an edit nothing is
 * accountable for, which breaks the chain.
 *
 * This deliberately avoids reconstructing the QA fingerprint by subtracting a
 * predicted set of "release metadata" paths from the live tree. That covering
 * set cannot be known a priori — feature work routinely leaves the same durable
 * docs and README surfaces dirty that the release procedure later version-syncs
 * — and subtracting them removed feature bytes the QA fingerprint included.
 */
function shipCurrencyChain(
  state: RunState,
  qaEvidence: StageHistoryItem,
  currentBeforeFingerprint: string,
): { proved: boolean; attribution_links: number } {
  const windows = accountableWindowsSinceQa(state, qaEvidence)
  const broken = { proved: false, attribution_links: 0 }

  if (windows.length === 0) {
    return broken
  }

  let expectedBefore = qaEvidence.workspace_fingerprint
  let attributionLinks = 0

  for (const window of windows) {
    // A record written before before-fingerprints were tracked cannot be
    // bounded, so it cannot carry the chain.
    if (window.before !== expectedBefore || !window.accountable) {
      return broken
    }

    if (window.source === 'attribution') {
      attributionLinks += 1
    }

    expectedBefore = window.after
  }

  return expectedBefore === currentBeforeFingerprint
    ? { proved: true, attribution_links: attributionLinks }
    : broken
}

/**
 * The ship worktree's head is the release's index commit, or a bounded ship
 * repair the output declares above it: a test-only commit the land reuses the
 * finalized release pair under.
 */
export function shipHeadMatchesRelease(
  workspaceDir: string,
  indexCommit: string,
  shipRepair: unknown,
): boolean {
  const head = gitHead(workspaceDir)

  if (head === indexCommit) {
    return true
  }

  return (
    head !== null &&
    isRecord(shipRepair) &&
    shipRepair.commit === head &&
    gitIsAncestor(workspaceDir, indexCommit, head) &&
    judgeShipRepair(shipRepairPaths(workspaceDir, indexCommit, head)).within
  )
}

/**
 * Return the workspace fingerprint `ship.prior_gates_current` is judged against
 * for a ship attempt. For a release-metadata-only stage, this is the passing QA
 * fingerprint when the workspace still matches it or when every recorded window
 * since QA chains back to it; otherwise the before snapshot's fingerprint.
 * Other stages use the after snapshot.
 */
export function resolveShipPriorGatesEvidenceFingerprint(options: {
  state: RunState
  stage: StageDefinition
  beforeSnapshot: WorkspaceSnapshot
  afterSnapshot: WorkspaceSnapshot
  scopePassed: boolean
}): { fingerprint: string; attribution_links: number } {
  if (options.stage.workspace_policy !== 'release_metadata_only') {
    return {
      fingerprint: options.afterSnapshot.fingerprint,
      attribution_links: 0,
    }
  }

  const test = [...options.state.stage_history]
    .reverse()
    .find(
      (item) =>
        (item.stage === 'test' || item.stage === 'verify') &&
        item.outcome === 'success',
    )
  const testFingerprint = test?.workspace_fingerprint

  if (!testFingerprint) {
    return {
      fingerprint: options.beforeSnapshot.fingerprint,
      attribution_links: 0,
    }
  }

  if (options.afterSnapshot.fingerprint === testFingerprint) {
    return { fingerprint: testFingerprint, attribution_links: 0 }
  }

  // First ship attempt: before snapshot still matches QA.
  if (options.beforeSnapshot.fingerprint === testFingerprint) {
    return { fingerprint: testFingerprint, attribution_links: 0 }
  }

  // Later entries: the before snapshot already includes earlier ship edits and
  // any release-metadata work the operator directed between stages. Currency
  // holds when this attempt's own window is clean and every earlier recorded
  // window chains back to the QA fingerprint.
  const chain = shipCurrencyChain(
    options.state,
    test,
    options.beforeSnapshot.fingerprint,
  )

  if (options.scopePassed && chain.proved) {
    return {
      fingerprint: testFingerprint,
      attribution_links: chain.attribution_links,
    }
  }

  return {
    fingerprint: options.beforeSnapshot.fingerprint,
    attribution_links: 0,
  }
}

/**
 * Return the snapshot entries added and removed between two workspace
 * snapshots.
 */
export function workspaceDelta(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before.entries)
  const afterSet = new Set(after.entries)

  return {
    added: [...afterSet].filter((entry) => !beforeSet.has(entry)),
    removed: [...beforeSet].filter((entry) => !afterSet.has(entry)),
  }
}

/**
 * Workspace paths a run's own submitted stage outputs claim, from the
 * attribution block and from the implementation record. This is what "a run
 * authored this path" means in the record, so it is also what lets a later
 * stage attribute a path it finds already dirty in a shared worktree.
 */
function runClaimedWorkspacePaths(root: string, state: RunState): Set<string> {
  const claimed = new Set<string>()
  const add = (value: unknown): void => {
    if (typeof value === 'string' && value.trim().length > 0) {
      claimed.add(normalizeWorkspacePath(value))
    }
  }

  for (const item of state.stage_history) {
    if (item.outcome !== 'success') {
      continue
    }

    let output: unknown

    try {
      output = readJson(resolveInside(root, item.output_path))
    } catch {
      continue
    }

    if (!isRecord(output)) {
      continue
    }

    const attribution = isRecord(output.workspace_changes)
      ? output.workspace_changes
      : undefined

    if (Array.isArray(attribution?.paths)) {
      attribution.paths.forEach(add)
    }

    const data = isRecord(output.data) ? output.data : undefined
    const implementation = isRecord(data?.implementation)
      ? data.implementation
      : undefined

    if (Array.isArray(implementation?.changed_files)) {
      implementation.changed_files.forEach(add)
    }
  }

  return claimed
}

function normalizeWorkspacePath(relativePath: string): string {
  return path.posix
    .normalize(relativePath.replaceAll('\\', '/'))
    .replace(/^\.\//u, '')
}

/**
 * Run that authored each path a commit absorbed, by consulting the durable
 * record rather than the commit itself.
 *
 * Two sequential runs in one worktree is an operator-approved shape, so a ship
 * checkpoint legitimately commits an earlier run's uncommitted verified files.
 * A path no live run in that worktree claims stays unowned, which keeps the
 * shared-worktree rule from becoming a blanket exemption.
 */
export function absorbedPathOwners(
  root: string,
  state: RunState,
  paths: string[],
): Map<string, string> {
  const owners = new Map<string, string>()

  if (paths.length === 0) {
    return owners
  }

  const claimingRuns: RunState[] = [state]
  const worktreeName = state.managed_worktree?.name

  if (worktreeName !== undefined) {
    claimingRuns.push(
      ...liveRunsBoundToWorktree(root, worktreeName).filter(
        (sibling) => sibling.run_id !== state.run_id,
      ),
    )
  }

  for (const run of claimingRuns) {
    const unowned = paths.filter((relativePath) => !owners.has(relativePath))

    if (unowned.length === 0) {
      break
    }

    const claimed = runClaimedWorkspacePaths(root, run)

    for (const relativePath of unowned) {
      if (claimed.has(normalizeWorkspacePath(relativePath))) {
        owners.set(relativePath, run.run_id)
      }
    }
  }

  return owners
}

/** Name the run that authored each commit-absorbed path, newest owner last. */
export function absorbedRunAttributionNote(
  owners: Map<string, string>,
  state: RunState,
): string {
  if (owners.size === 0) {
    return ''
  }

  const byRun = new Map<string, string[]>()

  for (const [relativePath, runId] of owners) {
    byRun.set(runId, [...(byRun.get(runId) ?? []), relativePath])
  }

  const clauses = [...byRun.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([runId, paths]) =>
        `${runId === state.run_id ? 'this run' : `run ${runId}`} (${boundedPathList(paths.sort())})`,
    )

  return ` A commit absorbed already-verified paths owned by ${clauses.join('; ')}.`
}

/**
 * Bound the paths a gate result embeds in durable state. A dependency install
 * or generated tree can touch tens of thousands of files; embedding them all
 * produces a state payload no compaction can externalize, and persist would
 * refuse the transition outright (STATE_SIZE_BUDGET_EXCEEDED).
 */
const SCOPE_DELTA_PREVIEW_LIMIT = 200

/**
 * Join paths with commas for a durable explanation, keeping the first 200 and
 * naming how many more were cut, so a large delta cannot exceed the state size
 * budget.
 */
export function boundedPathList(paths: string[]): string {
  if (paths.length <= SCOPE_DELTA_PREVIEW_LIMIT) {
    return paths.join(', ')
  }

  return (
    `${paths.slice(0, SCOPE_DELTA_PREVIEW_LIMIT).join(', ')} ` +
    `… and ${paths.length - SCOPE_DELTA_PREVIEW_LIMIT} more`
  )
}

/**
 * Cap each side of a workspace delta at 200 entries, replacing the rest with
 * one entry naming the elided count.
 */
export function boundedWorkspaceDelta(delta: {
  added: string[]
  removed: string[]
}): {
  added: string[]
  removed: string[]
} {
  const bound = (entries: string[]): string[] =>
    entries.length <= SCOPE_DELTA_PREVIEW_LIMIT
      ? entries
      : [
          ...entries.slice(0, SCOPE_DELTA_PREVIEW_LIMIT),
          `… ${entries.length - SCOPE_DELTA_PREVIEW_LIMIT} more entries elided`,
        ]

  return { added: bound(delta.added), removed: bound(delta.removed) }
}

/**
 * Run one shell criterion as a stage entry gate: before the stage worker is
 * delegated, on the workspace as the run enters the stage. The same disabling
 * rules apply as at submission, so a verification level or run override that
 * skips the gate records a disabled result instead of running the command.
 */
export function runEntryGateCriterion(
  root: string,
  runDirectory: string,
  state: RunState,
  stage: StageDefinition,
  criterion: Criterion,
  workspaceDir: string,
  artifactId: string,
  onProgress?: (message: string) => void,
): DeterministicResult {
  const workspace = gitWorkspaceSnapshot(workspaceDir)
  const override = Object.prototype.hasOwnProperty.call(
    state.gate_overrides ?? {},
    criterion.id,
  )
    ? state.gate_overrides?.[criterion.id]
    : undefined

  if (override === false) {
    return {
      id: criterion.id,
      type: 'shell',
      hard: Boolean(criterion.hard),
      passed: true,
      disabled: true,
      explanation: 'Gate disabled by run configuration.',
      command: criterion.command,
      workspace_fingerprint: workspace.fingerprint,
    }
  }

  if (
    override === undefined &&
    state.verification !== undefined &&
    state.verification.gates[criterion.id] === false &&
    repositoryCheckProfileName(criterion.command ?? '') !== null
  ) {
    return {
      id: criterion.id,
      type: 'shell',
      hard: Boolean(criterion.hard),
      passed: true,
      disabled: true,
      verification_level: state.verification.level,
      explanation: `Gate skipped by verification level '${state.verification.level}'.`,
      command: criterion.command,
      workspace_fingerprint: workspace.fingerprint,
    }
  }

  return runShellCheck(
    root,
    runDirectory,
    state,
    stage,
    criterion,
    workspace,
    workspaceDir,
    typeof override === 'string' ? override : undefined,
    artifactId,
    onProgress,
    { entryGate: true },
  )
}

/**
 * Tracked harness-root paths this stage changed, when the run works in a
 * different directory. Empty when the workspace is the harness root, or when
 * the invocation recorded no harness baseline, because a comparison needs
 * both sides and an absent baseline is not evidence of a write.
 */
export function harnessRootWrites(
  root: string,
  workspaceDir: string,
  harnessBefore: WorkspaceSnapshot | undefined,
): string[] {
  if (!harnessBefore || path.resolve(root) === path.resolve(workspaceDir)) {
    return []
  }

  // Compare the working tree to its current HEAD. An independent clean commit
  // advances the harness branch but is not a write by this stage; an
  // uncommitted tracked edit remains visible in the snapshot delta.
  const after = gitWorkspaceSnapshot(root)

  return workspaceChangedPathsFromSnapshots(harnessBefore, after)
    .filter((relativePath) => !relativePath.startsWith('runtime/'))
    .sort()
}

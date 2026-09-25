import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import type { Dirent, Stats } from 'node:fs'
import path from 'node:path'

import { errorMessage, isNodeError, PanError } from './errors.js'
import { gitDefaultBranch, gitIsAncestor } from './git.js'
import {
  migrateLegacyInboxLayout,
  planInboxReconciliation,
  reconcileInboxItems,
} from './inbox.js'
import type { InboxReconciliationMove } from './inbox.js'
import { isRecord, readJson } from './io.js'
import { isTargetInstallation, resolveRetentionDays } from './project-config.js'
import { liveRunsBoundToWorktree, TERMINAL_RUN_STATUSES } from './state.js'
import { DEFAULT_TEST_SCRATCH_PATH, testScratchRoot } from './test-scratch.js'
import type { RunStatus } from './types.js'
import {
  needsTemporalFileName,
  standardizeRuntimeFileNames,
  temporalFileDirectories,
  temporalNameDate,
} from './workflow-artifacts.js'
import {
  listWorktrees,
  removeWorktree,
  workspaceRepositoryRoot,
} from './worktrees.js'
import { workspaceCleanliness } from './workspace-attribution.js'

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000

/** `<dir>/.owner` for a directory and `<file>.owner` for a file. */
const OWNER_MARKER = '.owner'

/**
 * `archive_then_delete` names a class `pan archive` moves into an `archive/`
 * child first; the deletion tier reaches both the active root and that child.
 * `delete` names a class with no archive tier.
 */
export type CleanupDisposal =
  | 'archive_then_delete'
  | 'delete'
  | 'remove_worktree'
  | 'retain'

/**
 * `temporal_name` reads age from the sortable UTC name a run, session, or
 * standardized file carries, so both retention tiers agree on what is old; a
 * name without one falls back to `mtime`.
 */
export type CleanupAgeSource = 'mtime' | 'temporal_name' | 'created_at' | 'none'

export interface CleanupArtifactClass {
  name: string
  paths: string[]
  age_source: CleanupAgeSource
  disposal: CleanupDisposal
}

/**
 * One inventory of the harness-owned state cleanup may touch. Durable entries
 * stay visible as retained so adding a broad sweep cannot silently absorb them.
 */
export const CLEANUP_ARTIFACT_CLASSES: readonly CleanupArtifactClass[] = [
  {
    name: 'workflow-runs',
    paths: ['runtime/logs/workflows', 'runtime/workflows'],
    age_source: 'temporal_name',
    disposal: 'archive_then_delete',
  },
  {
    name: 'standalone-sessions',
    paths: ['runtime/logs/sessions'],
    age_source: 'temporal_name',
    disposal: 'archive_then_delete',
  },
  {
    name: 'best-of-n',
    paths: ['runtime/logs/best-of-n'],
    age_source: 'temporal_name',
    disposal: 'archive_then_delete',
  },
  {
    name: 'cohorts',
    paths: ['runtime/logs/cohorts'],
    age_source: 'mtime',
    disposal: 'archive_then_delete',
  },
  {
    name: 'traces',
    paths: ['runtime/logs/traces'],
    age_source: 'mtime',
    disposal: 'archive_then_delete',
  },
  {
    name: 'evals',
    paths: ['runtime/logs/evals'],
    age_source: 'mtime',
    disposal: 'archive_then_delete',
  },
  {
    name: 'horizon',
    paths: ['runtime/logs/horizon'],
    age_source: 'mtime',
    disposal: 'archive_then_delete',
  },
  {
    name: 'hypervisor',
    paths: ['runtime/logs/hypervisor'],
    age_source: 'mtime',
    disposal: 'archive_then_delete',
  },
  {
    name: 'away-mode',
    paths: ['runtime/logs/away-mode'],
    age_source: 'mtime',
    disposal: 'archive_then_delete',
  },
  {
    name: 'orchestrator-events',
    paths: ['runtime/logs/events'],
    age_source: 'mtime',
    disposal: 'archive_then_delete',
  },
  // Also owns inbox housekeeping across every lifecycle directory: status
  // reconciliation, legacy loose-file relocation, and temporal renames. The
  // open `queue/` and `active/` directories never appear in `paths`, so no
  // retention window reaches them.
  {
    name: 'inbox-history',
    paths: [
      'runtime/inbox/complete',
      'runtime/inbox/canceled',
      'runtime/inbox/archive',
    ],
    age_source: 'temporal_name',
    disposal: 'archive_then_delete',
  },
  {
    name: 'pr-descriptions',
    paths: ['runtime/pr-descriptions'],
    age_source: 'temporal_name',
    disposal: 'archive_then_delete',
  },
  {
    name: 'research',
    paths: ['runtime/research'],
    age_source: 'temporal_name',
    disposal: 'archive_then_delete',
  },
  {
    name: 'benchmarks',
    paths: ['runtime/benchmarks'],
    age_source: 'temporal_name',
    disposal: 'archive_then_delete',
  },
  // `tests.noindex` is listed on its own so each suite run directory inside it
  // is judged by its own owner marker rather than by the shared parent.
  {
    name: 'scratch',
    paths: [
      'runtime/tmp',
      'runtime/tmp/tests.noindex',
      'runtime/cache/output-validate',
    ],
    age_source: 'mtime',
    disposal: 'delete',
  },
  {
    name: 'worktrees',
    paths: ['worktrees/operator'],
    age_source: 'created_at',
    disposal: 'remove_worktree',
  },
  {
    name: 'durable-cache',
    paths: ['runtime/cache/conform.json', 'runtime/cache/style.json'],
    age_source: 'none',
    disposal: 'retain',
  },
  {
    name: 'release-allocations',
    paths: ['runtime/release/allocations.jsonl'],
    age_source: 'none',
    disposal: 'retain',
  },
  {
    name: 'repository-checks',
    paths: ['runtime/repository-checks.json'],
    age_source: 'none',
    disposal: 'retain',
  },
  {
    name: 'spend-ledger',
    paths: ['runtime/spend'],
    age_source: 'none',
    disposal: 'retain',
  },
]

/** Classes whose loose files the temporal rename pass standardizes. */
const TEMPORAL_NAME_DIRECTORY_KEYS: Readonly<Record<string, string>> = {
  'inbox-history': 'inbox',
  'pr-descriptions': 'runtime/pr-descriptions',
  research: 'runtime/research',
  benchmarks: 'runtime/benchmarks',
}

export interface CleanupAction {
  class: string
  path: string
  action: 'delete' | 'relocate' | 'rename' | 'remove_worktree'
  age_days: number
  reason: string
}

export interface CleanupSkip {
  class: string
  path: string
  reason: string
}

export interface CleanupBranch {
  worktree: string
  branch: string
  merged_into_default: boolean | null
  default_branch: string | null
}

export interface CleanupWorktree {
  name: string
  path: string
  branch: string
  age_days: number
  action: 'remove' | 'skip'
  reason: string
}

export interface CleanupPlan {
  status: 'planned'
  generated_at: string
  retention: Record<string, number>
  actions: CleanupAction[]
  worktrees: CleanupWorktree[]
  branches: CleanupBranch[]
  skipped: CleanupSkip[]
}

export interface CleanupOptions {
  days?: number
  classes?: string[]
  now?: Date
}

export interface CleanupResult extends Omit<CleanupPlan, 'status'> {
  status: 'applied'
  inbox_moves: InboxReconciliationMove[]
  relocated_files: number
  renames: Record<string, string>
  updated_references: number
}

interface PlanAccumulator {
  root: string
  now: Date
  options: CleanupOptions
  selected: Set<string>
  retention: Record<string, number>
  actions: CleanupAction[]
  worktrees: CleanupWorktree[]
  branches: CleanupBranch[]
  skipped: CleanupSkip[]
  /** Unreadable locations already reported, keyed by class and path. */
  unreadable: Set<string>
  /** Paths already planned for deletion, so no later pass plans a move of one. */
  deleting: Set<string>
  /** Paths already planned for relocation, which are renamed on arrival. */
  moving: Set<string>
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/')
}

function ageInDays(now: Date, at: number): number {
  return Math.floor((now.getTime() - at) / MILLISECONDS_PER_DAY)
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function ownerPid(target: string, isDirectory: boolean): number | null {
  const marker = isDirectory
    ? path.join(target, OWNER_MARKER)
    : `${target}${OWNER_MARKER}`

  if (existsSync(marker)) {
    const firstLine = readFileSync(marker, 'utf8').split('\n')[0]
    const pid = Number(firstLine)

    return Number.isInteger(pid) ? pid : null
  }

  if (isDirectory) {
    return null
  }

  try {
    const value: unknown = JSON.parse(readFileSync(target, 'utf8'))

    if (isRecord(value)) {
      const pid = value.owner_pid ?? value.pid

      return Number.isInteger(pid) ? (pid as number) : null
    }
  } catch {
    // Ordinary scratch files carry no structured owner.
  }

  return null
}

function runLivenessReason(target: string): string | null {
  for (const relative of ['agent/state.json', 'state.json']) {
    const candidate = path.join(target, relative)

    if (!existsSync(candidate)) {
      continue
    }

    try {
      const state = readJson(candidate)

      if (
        isRecord(state) &&
        typeof state.status === 'string' &&
        !TERMINAL_RUN_STATUSES.has(state.status as RunStatus)
      ) {
        return `run status '${state.status}' is not terminal`
      }
    } catch {
      return 'run state is unreadable'
    }
  }

  return null
}

/** The file an `<file>.owner` sidecar protects, when that file is present. */
function ownedFileOfMarker(target: string): string | null {
  const name = path.basename(target)

  if (name === OWNER_MARKER || !name.endsWith(OWNER_MARKER)) {
    return null
  }

  const owned = target.slice(0, -OWNER_MARKER.length)

  return existsSync(owned) ? owned : null
}

/**
 * The one liveness judgment both retention tiers apply: a live owner process
 * or a non-terminal run keeps an artifact whatever its age.
 */
function livenessReason(target: string, isDirectory: boolean): string | null {
  const pid = ownerPid(target, isDirectory)

  if (pid !== null && processIsAlive(pid)) {
    return `live owner process ${pid}`
  }

  if (isDirectory) {
    return runLivenessReason(target)
  }

  // A sidecar carries the proof that keeps the file beside it, so it is aged
  // by that file. Retiring it on its own age would leave the capture unowned
  // and delete it on the next pass with the owner still running.
  const owned = ownedFileOfMarker(target)
  const ownedPid = owned === null ? null : ownerPid(owned, false)

  if (owned !== null && ownedPid !== null && processIsAlive(ownedPid)) {
    return `owner marker for '${path.basename(owned)}', held by live process ${ownedPid}`
  }

  return null
}

/** The instant an artifact is dated from, which both tiers compare to the cutoff. */
function artifactTimestampMs(
  artifactClass: CleanupArtifactClass,
  target: string,
  mtimeMs: number,
): number {
  if (artifactClass.age_source === 'temporal_name') {
    const named = temporalNameDate(path.basename(target))

    if (named) {
      return named.getTime()
    }
  }

  return mtimeMs
}

function selectedClasses(options: CleanupOptions): Set<string> {
  const known = new Set(CLEANUP_ARTIFACT_CLASSES.map((entry) => entry.name))
  const selected = new Set(options.classes ?? [...known])

  for (const className of selected) {
    if (!known.has(className)) {
      throw new PanError(
        `Unknown cleanup class '${className}'. Known classes: ${[...known].join(', ')}.`,
        { code: 'UNKNOWN_CLEANUP_CLASS', details: { class: className } },
      )
    }
  }

  return selected
}

/** The error code when Node supplies one, so the reason stays host-neutral. */
function readFailureDetail(error: unknown): string {
  if (isNodeError(error) && typeof error.code === 'string') {
    return error.code
  }

  return errorMessage(error)
}

/**
 * Report a path the planner could not read. The operator approves a sweep from
 * the plan alone, so a path absent from it reads as one the planner weighed and
 * kept. The scans overlap on a directory, and one account of it is enough.
 */
function recordUnreadable(
  plan: PlanAccumulator,
  className: string,
  target: string,
  reason: string,
): void {
  const relative = toPosix(path.relative(plan.root, target))
  const key = `${className}\u0000${relative}`

  if (plan.unreadable.has(key)) {
    return
  }

  plan.unreadable.add(key)
  plan.skipped.push({ class: className, path: relative, reason })
}

function readDirectoryEntries(
  plan: PlanAccumulator,
  className: string,
  directory: string,
): Dirent[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    // An unreadable directory is skipped rather than aborting the plan.
    recordUnreadable(
      plan,
      className,
      directory,
      `directory cannot be read (${readFailureDetail(error)}); its entries are absent from this plan`,
    )
    return []
  }
}

function statOrNull(
  plan: PlanAccumulator,
  className: string,
  target: string,
): Stats | null {
  try {
    return statSync(target)
  } catch (error) {
    // A dangling link, or an entry another process removed between the
    // directory read and this call, is skipped rather than aborting the plan.
    recordUnreadable(
      plan,
      className,
      target,
      `entry cannot be read (${readFailureDetail(error)}); retention cannot judge its age`,
    )
    return null
  }
}

function planExpiredEntries(
  plan: PlanAccumulator,
  artifactClass: CleanupArtifactClass,
  parent: string,
  days: number,
  cutoff: number,
  skipNames: ReadonlySet<string>,
  reasonFor: (days: number) => string,
): void {
  for (const entry of readDirectoryEntries(plan, artifactClass.name, parent)) {
    if (skipNames.has(entry.name)) {
      continue
    }

    const target = path.join(parent, entry.name)
    const stat = statOrNull(plan, artifactClass.name, target)

    if (stat === null) {
      continue
    }

    const timestampMs = artifactTimestampMs(artifactClass, target, stat.mtimeMs)

    if (timestampMs >= cutoff) {
      continue
    }

    const relative = toPosix(path.relative(plan.root, target))
    const reason = livenessReason(target, stat.isDirectory())

    if (reason) {
      plan.skipped.push({ class: artifactClass.name, path: relative, reason })
      continue
    }

    plan.actions.push({
      class: artifactClass.name,
      path: relative,
      action: 'delete',
      age_days: ageInDays(plan.now, timestampMs),
      reason: reasonFor(days),
    })
    plan.deleting.add(relative)
  }
}

/**
 * A class's paths with the test scratch root resolved from configuration,
 * which can place it outside the root and so appear as a `..` path.
 */
function resolvedClassPaths(
  root: string,
  artifactClass: CleanupArtifactClass,
): string[] {
  const defaultScratch = toPosix(DEFAULT_TEST_SCRATCH_PATH)

  if (!artifactClass.paths.includes(defaultScratch)) {
    return artifactClass.paths
  }

  let scratch = defaultScratch

  try {
    scratch = toPosix(path.relative(root, testScratchRoot(root)))
  } catch {
    // A malformed declaration fails config loading on its own; retention
    // keeps judging the default location meanwhile.
  }

  return artifactClass.paths.map((candidate) =>
    candidate === defaultScratch ? scratch : candidate,
  )
}

function planFileClasses(plan: PlanAccumulator): void {
  const { root, now, options, selected, retention } = plan

  for (const artifactClass of CLEANUP_ARTIFACT_CLASSES) {
    if (
      !selected.has(artifactClass.name) ||
      artifactClass.disposal === 'retain' ||
      artifactClass.disposal === 'remove_worktree'
    ) {
      continue
    }

    const days = options.days ?? resolveRetentionDays(root, artifactClass.name)
    retention[artifactClass.name] = days
    const cutoff = now.getTime() - days * MILLISECONDS_PER_DAY

    const classPaths = resolvedClassPaths(root, artifactClass)

    for (const parentRelative of classPaths) {
      const parent = path.resolve(root, parentRelative)

      if (!existsSync(parent)) {
        continue
      }

      if (parentRelative === 'runtime/cache/output-validate') {
        const stat = statOrNull(plan, artifactClass.name, parent)

        if (stat !== null && stat.mtimeMs < cutoff) {
          plan.actions.push({
            class: artifactClass.name,
            path: toPosix(parentRelative),
            action: 'delete',
            age_days: ageInDays(now, stat.mtimeMs),
            reason: `older than ${days} days`,
          })
          plan.deleting.add(toPosix(parentRelative))
        }

        continue
      }

      // A nested class path is judged on its own entries, not as one item of
      // its parent; harness markers inside a scratch root are not artifacts.
      const skipNames = new Set(
        classPaths
          .filter((candidate) => candidate.startsWith(`${parentRelative}/`))
          .map((candidate) => path.basename(candidate)),
      )

      skipNames.add('archive')
      skipNames.add('.metadata_never_index')

      planExpiredEntries(
        plan,
        artifactClass,
        parent,
        days,
        cutoff,
        skipNames,
        (window) => `older than ${window} days`,
      )

      const archive = path.join(parent, 'archive')

      if (
        artifactClass.disposal === 'archive_then_delete' &&
        existsSync(archive)
      ) {
        planExpiredEntries(
          plan,
          artifactClass,
          archive,
          days,
          cutoff,
          new Set(),
          (window) => `archived artifact older than ${window} days`,
        )
      }
    }
  }
}

function planWorktrees(plan: PlanAccumulator): void {
  const { root, now, options, selected, retention } = plan

  if (!selected.has('worktrees') || isTargetInstallation(root)) {
    return
  }

  const days = options.days ?? resolveRetentionDays(root, 'worktrees')
  retention.worktrees = days
  const repositoryRoot = workspaceRepositoryRoot(root)
  const defaultBranch = gitDefaultBranch(repositoryRoot)

  for (const worktree of listWorktrees(root)) {
    const created = Date.parse(worktree.created_at)
    const ageDays = ageInDays(now, created)
    const relativePath = toPosix(worktree.path)
    let reason: string | null = null

    if (!Number.isFinite(created) || ageDays < days) {
      reason = `younger than ${days} days`
    } else if (liveRunsBoundToWorktree(root, worktree.name).length > 0) {
      reason = 'a non-terminal run names this worktree'
    } else if (worktree.registered) {
      const absolute = path.resolve(root, worktree.path)
      const cleanliness = workspaceCleanliness(root, absolute)

      if (!cleanliness.clean) {
        reason = `checkout has uncommitted work: ${cleanliness.blocking
          .map((entry) => entry.path)
          .join(', ')}`
      }
    } else if (
      !worktree.orphaned &&
      existsSync(path.resolve(root, worktree.path))
    ) {
      reason = 'checkout exists but Git does not register it'
    }

    if (reason) {
      plan.worktrees.push({
        name: worktree.name,
        path: relativePath,
        branch: worktree.branch,
        age_days: ageDays,
        action: 'skip',
        reason,
      })
      plan.skipped.push({ class: 'worktrees', path: relativePath, reason })
      continue
    }

    const merged =
      defaultBranch === null
        ? null
        : gitIsAncestor(repositoryRoot, worktree.branch, defaultBranch)

    plan.worktrees.push({
      name: worktree.name,
      path: relativePath,
      branch: worktree.branch,
      age_days: ageDays,
      action: 'remove',
      reason: `older than ${days} days, unbound, and clean`,
    })
    plan.branches.push({
      worktree: worktree.name,
      branch: worktree.branch,
      merged_into_default: merged,
      default_branch: defaultBranch,
    })
    plan.actions.push({
      class: 'worktrees',
      path: relativePath,
      action: 'remove_worktree',
      age_days: ageDays,
      reason: `older than ${days} days, unbound, and clean`,
    })
  }
}

interface TemporalNameDirectory {
  className: string
  directory: string
}

function temporalNameDirectories(
  selected: ReadonlySet<string>,
): TemporalNameDirectory[] {
  const directories = temporalFileDirectories()

  return Object.entries(TEMPORAL_NAME_DIRECTORY_KEYS)
    .filter(([className]) => selected.has(className))
    .flatMap(([className, key]) =>
      (directories[key] ?? []).map((directory) => ({ className, directory })),
    )
}

function renameOnArrival(name: string): string {
  return needsTemporalFileName(name)
    ? '; it is renamed to the temporal convention on arrival'
    : ''
}

function planInboxHousekeeping(plan: PlanAccumulator): void {
  const { root, selected } = plan

  if (!selected.has('inbox-history')) {
    return
  }

  const reconciliation = planInboxReconciliation(root)

  // Expired history is deleted rather than reconciled, so a move is planned
  // only for an item retention keeps.
  for (const move of reconciliation.moves) {
    if (plan.deleting.has(move.from)) {
      continue
    }

    const arrival = renameOnArrival(path.basename(move.from))

    plan.actions.push({
      class: 'inbox-history',
      path: move.from,
      action: 'relocate',
      age_days: 0,
      reason:
        move.run_id === null
          ? `no run claims this item; it belongs in ${move.to_status}/${arrival}`
          : `claiming run ${move.run_id} is ${move.run_status}; item belongs in ${move.to_status}/${arrival}`,
    })
    plan.moving.add(move.from)
  }

  for (const relative of reconciliation.unclaimed) {
    if (!plan.deleting.has(relative)) {
      plan.skipped.push({
        class: 'inbox-history',
        path: relative,
        reason:
          'no run record claims this item; its directory records its outcome',
      })
    }
  }

  const inboxRoot = path.join(root, 'runtime', 'inbox')

  for (const entry of readDirectoryEntries(plan, 'inbox-history', inboxRoot)) {
    if (entry.isFile() && !entry.name.startsWith('.')) {
      plan.actions.push({
        class: 'inbox-history',
        path: toPosix(path.join('runtime', 'inbox', entry.name)),
        action: 'relocate',
        age_days: 0,
        reason: `legacy loose inbox item belongs in a lifecycle directory${renameOnArrival(entry.name)}`,
      })
    }
  }
}

function planHostMetadata(plan: PlanAccumulator): void {
  const { root, selected } = plan

  if (!selected.has('scratch')) {
    return
  }

  const metadataRoots = isTargetInstallation(root)
    ? ['runtime']
    : ['runtime', 'worktrees']
  const excludedDirectories = new Set([
    '.git',
    '.venv',
    'build',
    'coverage',
    'dist',
    'node_modules',
    'site-packages',
    'venv',
    'vendor',
  ])

  const visit = (directory: string): void => {
    for (const entry of readDirectoryEntries(plan, 'scratch', directory)) {
      const absolute = path.join(directory, entry.name)

      if (entry.isDirectory() && !excludedDirectories.has(entry.name)) {
        visit(absolute)
      } else if (entry.name === '.DS_Store') {
        plan.actions.push({
          class: 'scratch',
          path: toPosix(path.relative(root, absolute)),
          action: 'delete',
          age_days: 0,
          reason: 'host metadata is not harness state',
        })
      }
    }
  }

  for (const relativeRoot of metadataRoots) {
    const absoluteRoot = path.join(root, relativeRoot)

    if (existsSync(absoluteRoot)) {
      visit(absoluteRoot)
    }
  }
}

function planTemporalRenames(plan: PlanAccumulator): void {
  const { root, selected } = plan

  for (const { className, directory } of temporalNameDirectories(selected)) {
    for (const entry of readDirectoryEntries(
      plan,
      className,
      path.join(root, directory),
    )) {
      if (!entry.isFile() || !needsTemporalFileName(entry.name)) {
        continue
      }

      const relative = toPosix(path.join(directory, entry.name))

      // A file the plan deletes is not renamed first, and a file the plan
      // relocates is renamed where it arrives.
      if (plan.deleting.has(relative) || plan.moving.has(relative)) {
        continue
      }

      plan.actions.push({
        class: className,
        path: relative,
        action: 'rename',
        age_days: 0,
        reason: 'file name does not use the temporal convention',
      })
    }
  }
}

export function planCleanup(
  root: string,
  options: CleanupOptions = {},
): CleanupPlan {
  if (
    options.days !== undefined &&
    (!Number.isInteger(options.days) || options.days < 1)
  ) {
    throw new PanError('--days MUST be a positive integer.', {
      code: 'INVALID_RETENTION_DAYS',
    })
  }

  const now = options.now ?? new Date()
  const plan: PlanAccumulator = {
    root,
    now,
    options,
    selected: selectedClasses(options),
    retention: {},
    actions: [],
    worktrees: [],
    branches: [],
    skipped: [],
    unreadable: new Set(),
    deleting: new Set(),
    moving: new Set(),
  }

  planFileClasses(plan)
  planWorktrees(plan)
  planInboxHousekeeping(plan)
  planHostMetadata(plan)
  planTemporalRenames(plan)

  return {
    status: 'planned',
    generated_at: now.toISOString(),
    retention: plan.retention,
    actions: plan.actions.sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    worktrees: plan.worktrees,
    branches: plan.branches,
    skipped: plan.skipped,
  }
}

/**
 * Perform the plan the operator saw. Deletion runs first and removes exactly
 * the planned paths, so expired history is never reconciled back into open
 * work; reconciliation, relocation, and renaming then reach only the
 * survivors, which is what the plan already described.
 */
export function applyCleanup(
  root: string,
  options: CleanupOptions = {},
): CleanupResult {
  const plan = planCleanup(root, options)
  const selected = selectedClasses(options)
  const inboxSelected = selected.has('inbox-history')

  for (const action of plan.actions) {
    if (action.action === 'delete') {
      rmSync(path.resolve(root, action.path), { recursive: true, force: true })
    } else if (action.action === 'remove_worktree') {
      const worktree = plan.worktrees.find(
        (entry) => entry.path === action.path && entry.action === 'remove',
      )

      if (worktree) {
        removeWorktree(root, worktree.name)
      }
    }
  }

  const inboxMoves = inboxSelected ? reconcileInboxItems(root) : []
  const relocated = inboxSelected
    ? migrateLegacyInboxLayout(root).migrated_files
    : 0
  const renameDirectories = temporalNameDirectories(selected).map(
    (entry) => entry.directory,
  )
  const renamed =
    renameDirectories.length > 0
      ? standardizeRuntimeFileNames(root, undefined, renameDirectories)
      : null

  return {
    ...plan,
    status: 'applied',
    inbox_moves: inboxMoves,
    relocated_files: relocated,
    renames: renamed?.renames ?? {},
    updated_references: renamed?.updated_files ?? 0,
  }
}

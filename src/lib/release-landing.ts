/**
 * `pan release land` — the single harness command that integrates a candidate
 * branch with the current pan-dev tip, allocates a version above that tip,
 * verifies, checks with `bin/check-landing`, and fast-forwards pan-dev.
 *
 * All operations run while the caller holds the landing mutex, so two
 * concurrent landings receive distinct versions and one serialized path to
 * pan-dev.
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { PanError, errorMessage, invariant } from './errors.js'
import {
  gitCommit,
  gitCommitSubject,
  gitConflictedPaths,
  gitHead,
  gitIsAncestor,
  gitMergeAbort,
  gitRevParse,
  gitShowFile,
  gitSourceContentFingerprint,
  gitStagePaths,
  gitWorktreeForBranch,
  gitWorktreeIsDirty,
  INTEGRATION_BRANCH,
} from './git.js'
import {
  appendJsonLine,
  fileExists,
  isRecord,
  readText,
  resolveInside,
} from './io.js'
import {
  acquireLandingMutex,
  type LandingMutexHolder,
} from './landing-mutex.js'
import {
  allocateLandingVersion,
  readReleaseAllocations,
} from './release-allocation.js'
import { finalizeLocalRelease } from './release-preparation.js'
import { BUILD_READY_ENV, runRepositoryCheck } from './repository-checks.js'
import { loadState } from './state.js'
import {
  isSemanticVersion,
  RELEASE_LANDING_METADATA_PATHS,
  type ReleaseBump,
} from './versioning.js'
import {
  resolveWorktreeWorkspace,
  workspaceRepositoryRoot,
} from './worktrees.js'

const LANDING_LOG_PATH = path.join('runtime', 'release', 'landing.jsonl')
const GIT_TIMEOUT_MS = 120_000
const GIT_MAX_BUFFER = 20 * 1024 * 1024
const BUILD_TIMEOUT_MS = 600_000

/** A full SHA-1 or SHA-256 object name, the first field merge-tree prints. */
const OBJECT_NAME_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u

/** Metadata file paths that are resolved to the tip's content on integration. */
const METADATA_PATHS = RELEASE_LANDING_METADATA_PATHS

const RELEASE_HEADING_PATTERN = /^## \[([^\]]+)\] - \d{4}-\d{2}-\d{2}/mu

export type LandingStatus =
  | 'landed'
  | 'conflict'
  | 'verification_failed'
  | 'landing_refused'

export type LandingStepName =
  | 'tip_read'
  | 'integrate'
  | 'allocate'
  | 'metadata_regenerated'
  | 'finalize'
  | 'build'
  | 'verify'
  | 'check'
  | 'fast_forward'

export interface LandingStep {
  step: LandingStepName
  at: string
}

export interface LandingResult {
  status: LandingStatus
  /** Every step the landing reached, in execution order, with its start time. */
  steps: LandingStep[]
  version?: string
  tip_before?: string
  tip_after?: string
  release_commit?: string
  index_commit?: string
  merge_commit?: string
  verified_profiles?: string[]
  /** Build stamp of the integrated tree the verify step tested. */
  build_stamp?: string
  /** Why the verify step ran the profiles it ran. */
  verification_basis?: LandingVerification['basis']
  lock_wait_seconds?: number
  lock_hold_seconds?: number
  /** Source conflict paths when status is 'conflict'. */
  source_conflicts?: string[]
  /** Verification failure output when status is 'verification_failed'. */
  verification_output?: string
  /** Refused reason when status is 'landing_refused'. */
  refused_reason?: string
}

export interface LandReleaseOptions {
  worktree: string
  bump?: ReleaseBump
  runId?: string | null
  verifyProfiles?: string[]
  waitSeconds?: number
}

/**
 * The profiles a land verifies with, and why.
 *
 * - `operator`: the caller named the profiles with `--verify-profile`.
 * - `entry_gate_fingerprint`: integration merged nothing, and the worktree's
 *   source content, outside the release metadata paths, equals the tree the
 *   run's ship entry gate verified on `full`. The release commit changed only
 *   metadata, so `static` and `configuration` check what it did change.
 * - `default`: anything else runs `full`, with the reason recorded.
 */
export interface LandingVerification {
  profiles: string[]
  basis: 'operator' | 'entry_gate_fingerprint' | 'default'
  reason: string
  source_fingerprint?: string
}

/** The profiles a land after a matching verified tree runs. */
export const VERIFIED_TREE_LAND_PROFILES = ['static', 'configuration']

export type TipIntegration =
  | { outcome: 'already_current' }
  | { outcome: 'merged'; merge_commit: string }
  | { outcome: 'conflict'; source_conflicts: string[] }

function appendLandingEvent(
  root: string,
  event: Record<string, unknown>,
): void {
  appendJsonLine(resolveInside(root, LANDING_LOG_PATH), {
    timestamp: new Date().toISOString(),
    ...event,
  })
}

function tipVersion(repositoryRoot: string, tipCommit: string): string {
  const content = gitShowFile(repositoryRoot, tipCommit, 'VERSION')

  invariant(content !== null, `pan-dev at ${tipCommit} has no VERSION file.`, {
    code: 'LANDING_TIP_VERSION_MISSING',
  })

  const version = content.trim()

  invariant(
    isSemanticVersion(version),
    `pan-dev VERSION '${version}' is not a semantic version.`,
    { code: 'LANDING_TIP_VERSION_INVALID' },
  )

  return version
}

/**
 * Predict the paths a merge of `tipCommit` into `candidateHead` would leave
 * conflicted, without touching any working tree.
 *
 * `git merge-tree --write-tree -z` prints the merged toplevel tree first and
 * then one conflicted path per field. Exit status 0 means a clean merge and 1
 * means conflicts, but Git also exits 1 on an unreadable revision, so the
 * tree field must be present before the status counts as a prediction.
 */
export function predictMergeConflicts(
  repositoryRoot: string,
  candidateHead: string,
  tipCommit: string,
): string[] {
  const result = spawnSync(
    'git',
    [
      'merge-tree',
      '--write-tree',
      '--name-only',
      '--no-messages',
      '-z',
      candidateHead,
      tipCommit,
    ],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: GIT_MAX_BUFFER,
      timeout: GIT_TIMEOUT_MS,
    },
  )
  const [treeName = '', ...conflicted] = (result.stdout ?? '').split('\0')

  if (
    (result.status === 0 || result.status === 1) &&
    OBJECT_NAME_PATTERN.test(treeName)
  ) {
    return result.status === 0
      ? []
      : [...new Set(conflicted.filter((entry) => entry.length > 0))].sort()
  }

  throw new PanError(
    `git merge-tree could not predict the merge of ${tipCommit} into ` +
      `${candidateHead}: ${result.stderr || result.error?.message || 'no output'}`,
    { code: 'LANDING_MERGE_PREDICTION_FAILED' },
  )
}

function mergeInProgress(worktreePath: string): boolean {
  return (
    spawnSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], {
      cwd: worktreePath,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
    }).status === 0
  )
}

function sourcePaths(paths: readonly string[]): string[] {
  return paths.filter((entry) => !METADATA_PATHS.has(entry))
}

/**
 * Merge the tip into the candidate worktree branch and resolve every release
 * metadata path to the tip's content, so metadata is regenerated rather than
 * hand-merged. A predicted or actual source conflict leaves the candidate
 * branch and working tree exactly as they were.
 */
function integrateCandidate(
  repositoryRoot: string,
  worktreePath: string,
  tipCommit: string,
): TipIntegration {
  if (gitIsAncestor(worktreePath, tipCommit)) {
    return { outcome: 'already_current' }
  }

  const candidateHead = gitHead(worktreePath)

  invariant(candidateHead !== null, 'Candidate worktree has no HEAD commit.', {
    code: 'LANDING_NO_HEAD',
  })

  const predicted = sourcePaths(
    predictMergeConflicts(repositoryRoot, candidateHead, tipCommit),
  )

  if (predicted.length > 0) {
    return { outcome: 'conflict', source_conflicts: predicted }
  }

  const merge = spawnSync(
    'git',
    ['merge', '--no-ff', '--no-commit', tipCommit],
    {
      cwd: worktreePath,
      encoding: 'utf8',
      maxBuffer: GIT_MAX_BUFFER,
      timeout: GIT_TIMEOUT_MS,
    },
  )

  if (merge.status !== 0) {
    const conflicted = gitConflictedPaths(worktreePath)
    const unresolvedSource = sourcePaths(conflicted)

    if (conflicted.length === 0 || unresolvedSource.length > 0) {
      if (mergeInProgress(worktreePath)) {
        gitMergeAbort(worktreePath)
      }

      if (unresolvedSource.length > 0) {
        return { outcome: 'conflict', source_conflicts: unresolvedSource }
      }

      throw new PanError(
        `git merge of pan-dev ${tipCommit} into the candidate failed: ` +
          `${merge.stderr || merge.stdout || merge.error?.message || 'no output'}`,
        { code: 'LANDING_MERGE_FAILED' },
      )
    }
  }

  const resolved: string[] = []

  for (const metadataPath of METADATA_PATHS) {
    const content = gitShowFile(repositoryRoot, tipCommit, metadataPath)

    if (content === null) {
      continue
    }

    writeFileSync(path.join(worktreePath, metadataPath), content)
    resolved.push(metadataPath)
  }

  gitStagePaths(worktreePath, resolved)

  return {
    outcome: 'merged',
    merge_commit: gitCommit(
      worktreePath,
      `merge: integrate pan-dev ${tipCommit.slice(0, 8)} for landing`,
    ),
  }
}

/**
 * Parse CHANGELOG.md content and return the set of versions present in it.
 */
function changelogVersions(changelogContent: string): Set<string> {
  const versions = new Set<string>()
  const pattern = /^## \[([^\]]+)\]/gmu

  for (const match of changelogContent.matchAll(pattern)) {
    if (match[1] && match[1] !== 'Unreleased') {
      versions.add(match[1])
    }
  }

  return versions
}

/**
 * Extract the body of a specific changelog entry (everything after the heading
 * up to the next `## [` heading).
 */
function changelogEntryBody(changelogContent: string, version: string): string {
  const headingPattern = new RegExp(
    `^## \\[${version.replace(/\./gu, '\\.')}\\][^\n]*\n`,
    'mu',
  )
  const startMatch = headingPattern.exec(changelogContent)

  if (!startMatch) {
    return ''
  }

  const afterHeading = startMatch.index + startMatch[0].length
  const nextHeading = changelogContent.indexOf('\n## [', afterHeading)
  const body =
    nextHeading === -1
      ? changelogContent.slice(afterHeading)
      : changelogContent.slice(afterHeading, nextHeading)

  return body.trim()
}

function mergeBase(worktreePath: string, left: string, right: string): string {
  const result = spawnSync('git', ['merge-base', left, right], {
    cwd: worktreePath,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
  })

  invariant(
    result.status === 0,
    `git merge-base could not relate ${left} to ${right}: ${result.stderr}`,
    { code: 'LANDING_HISTORY_UNREADABLE' },
  )

  return result.stdout.trim()
}

/**
 * The candidate's release notes: the body of the one changelog entry the
 * candidate added since its fork point from the tip, read from the newest
 * first-parent candidate commit that added such an entry. Entries are matched
 * by the fork point rather than by the tip's versions, because a candidate
 * finalized before landing can carry a version another landing already took.
 * Integration and the documented conflict repair both take the tip's
 * changelog, so the notes live on a commit below those merges rather than at
 * the candidate head.
 */
function candidateReleaseNotes(
  worktreePath: string,
  tipCommit: string,
): string {
  const history = spawnSync(
    'git',
    ['rev-list', '--first-parent', 'HEAD', '--not', tipCommit],
    {
      cwd: worktreePath,
      encoding: 'utf8',
      maxBuffer: GIT_MAX_BUFFER,
      timeout: GIT_TIMEOUT_MS,
    },
  )

  invariant(
    history.status === 0,
    `git rev-list could not read the candidate history: ${history.stderr}`,
    { code: 'LANDING_HISTORY_UNREADABLE' },
  )

  for (const commit of history.stdout.split('\n').filter(Boolean)) {
    const changelog = gitShowFile(worktreePath, commit, 'CHANGELOG.md')

    if (changelog === null) {
      continue
    }

    const forkVersions = changelogVersions(
      gitShowFile(
        worktreePath,
        mergeBase(worktreePath, commit, tipCommit),
        'CHANGELOG.md',
      ) ?? '',
    )
    const newEntryVersions = [...changelogVersions(changelog)].filter(
      (version) => !forkVersions.has(version),
    )

    if (newEntryVersions.length === 0) {
      continue
    }

    invariant(
      newEntryVersions.length === 1,
      `Landing found ${newEntryVersions.length} new changelog entries in the ` +
        `candidate (${newEntryVersions.join(', ')}); expected exactly one.`,
      { code: 'LANDING_CHANGELOG_AMBIGUOUS' },
    )

    return changelogEntryBody(changelog, newEntryVersions[0] as string)
  }

  throw new PanError(
    'Landing found no changelog entry the candidate added since its fork ' +
      'point from the pan-dev tip. Add a changelog entry before landing.',
    { code: 'LANDING_RELEASE_NOTES_MISSING' },
  )
}

/**
 * True when the candidate head is already the index commit of a release pair
 * for `version`, so a retry reuses that pair instead of rewriting metadata.
 */
function headIsReleasePair(worktreePath: string, version: string): boolean {
  const head = gitHead(worktreePath)

  return (
    head !== null &&
    gitShowFile(worktreePath, head, 'VERSION')?.trim() === version &&
    gitCommitSubject(worktreePath, head) === `chore: index release v${version}`
  )
}

/**
 * Commit the tip's `release/index.json` over the candidate's when they differ,
 * so an entry from a pair the candidate finalized before landing never reaches
 * pan-dev. Finalize refuses the index inside a release commit, so the restore
 * is its own commit below the release pair. After an integration merge the
 * index already is the tip's and nothing is committed.
 */
function restoreTipReleaseIndex(
  repositoryRoot: string,
  worktreePath: string,
  tipCommit: string,
): void {
  const tipIndex = gitShowFile(repositoryRoot, tipCommit, 'release/index.json')

  if (
    tipIndex === null ||
    gitShowFile(worktreePath, 'HEAD', 'release/index.json') === tipIndex
  ) {
    return
  }

  writeFileSync(path.join(worktreePath, 'release', 'index.json'), tipIndex)
  gitStagePaths(worktreePath, ['release/index.json'])
  gitCommit(
    worktreePath,
    `chore: restore pan-dev ${tipCommit.slice(0, 8)} release index for landing`,
  )
}

/**
 * Regenerate the metadata files in the candidate worktree to use the allocated
 * version, starting from the tip's copies plus the candidate's changelog notes.
 * The tip's release index is restored first on every path; finalize then
 * appends the landing version to it.
 */
function regenerateMetadata(
  repositoryRoot: string,
  worktreePath: string,
  tipCommit: string,
  newVersion: string,
  candidateEntryBody: string,
  tipChangelogContent: string,
): void {
  restoreTipReleaseIndex(repositoryRoot, worktreePath, tipCommit)
  writeFileSync(path.join(worktreePath, 'VERSION'), `${newVersion}\n`)

  const tipPackageJson = gitShowFile(repositoryRoot, tipCommit, 'package.json')

  if (tipPackageJson !== null) {
    const pkg = JSON.parse(tipPackageJson) as Record<string, unknown>
    pkg.version = newVersion
    writeFileSync(
      path.join(worktreePath, 'package.json'),
      `${JSON.stringify(pkg, null, 2)}\n`,
    )
  }

  const tipPackageLock = gitShowFile(
    repositoryRoot,
    tipCommit,
    'package-lock.json',
  )

  if (tipPackageLock !== null) {
    const lock = JSON.parse(tipPackageLock) as Record<string, unknown>
    lock.version = newVersion

    if (isRecord(lock.packages)) {
      const rootPkg = lock.packages[''] as Record<string, unknown> | undefined

      if (rootPkg !== undefined) {
        rootPkg.version = newVersion
      }
    }

    writeFileSync(
      path.join(worktreePath, 'package-lock.json'),
      `${JSON.stringify(lock, null, 2)}\n`,
    )
  }

  const tipEmbedded = gitShowFile(
    repositoryRoot,
    tipCommit,
    'docs/embedded-installation.md',
  )

  if (tipEmbedded !== null) {
    const tipVersionStr = tipVersion(repositoryRoot, tipCommit)
    const updatedEmbedded = tipEmbedded.replace(
      `currently agree on \`${tipVersionStr}\``,
      `currently agree on \`${newVersion}\``,
    )

    writeFileSync(
      path.join(worktreePath, 'docs/embedded-installation.md'),
      updatedEmbedded,
    )
  }

  const today = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD in local time
  const newHeading = `## [${newVersion}] - ${today}`

  const tipChangelogWithoutUnreleased = tipChangelogContent.replace(
    /^## \[Unreleased\][\s\S]*?(?=^## \[|$)/mu,
    '',
  )

  const firstHeadingMatch = RELEASE_HEADING_PATTERN.exec(
    tipChangelogWithoutUnreleased,
  )
  const newEntry = `${newHeading}\n\n${candidateEntryBody}\n`

  let newChangelog: string

  if (firstHeadingMatch) {
    const insertAt = firstHeadingMatch.index
    newChangelog =
      tipChangelogWithoutUnreleased.slice(0, insertAt) +
      newEntry +
      '\n' +
      tipChangelogWithoutUnreleased.slice(insertAt)
  } else {
    newChangelog = `${tipChangelogWithoutUnreleased.trimEnd()}\n\n${newEntry}`
  }

  writeFileSync(path.join(worktreePath, 'CHANGELOG.md'), newChangelog)
}

/**
 * Fast-forward pan-dev to the candidate head.
 *
 * - When a clean checkout holds pan-dev: `git merge --ff-only <head>` in it.
 * - When a dirty checkout holds pan-dev: fail with LANDING_TARGET_DIRTY.
 * - When no checkout holds pan-dev: `git update-ref refs/heads/pan-dev <head> <tip>`.
 */
function fastForwardPanDev(
  repositoryRoot: string,
  candidateHead: string,
  tipBefore: string,
): void {
  const checkout = gitWorktreeForBranch(repositoryRoot, INTEGRATION_BRANCH)

  if (checkout !== null) {
    if (gitWorktreeIsDirty(checkout)) {
      const statusResult = spawnSync('git', ['status', '--porcelain=v1'], {
        cwd: checkout,
        encoding: 'utf8',
        timeout: GIT_TIMEOUT_MS,
      })
      const blocking = statusResult.stdout
        .split('\n')
        .map((line) => line.slice(3).trim())
        .filter(Boolean)

      throw new PanError(
        `pan-dev is checked out at '${checkout}' with uncommitted changes. ` +
          `Resolve the blocking paths before landing: ${blocking.join(', ')}`,
        { code: 'LANDING_TARGET_DIRTY', details: { blocking_paths: blocking } },
      )
    }

    const ffResult = spawnSync('git', ['merge', '--ff-only', candidateHead], {
      cwd: checkout,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
    })

    invariant(
      ffResult.status === 0,
      `Fast-forward of pan-dev failed: ${ffResult.stderr || ffResult.stdout}`,
      { code: 'LANDING_FAST_FORWARD_FAILED' },
    )
  } else {
    const updateResult = spawnSync(
      'git',
      [
        'update-ref',
        `refs/heads/${INTEGRATION_BRANCH}`,
        candidateHead,
        tipBefore,
      ],
      { cwd: repositoryRoot, encoding: 'utf8', timeout: GIT_TIMEOUT_MS },
    )

    invariant(
      updateResult.status === 0,
      `git update-ref failed (pan-dev may have moved): ` +
        `${updateResult.stderr || updateResult.stdout}`,
      { code: 'LANDING_FAST_FORWARD_FAILED' },
    )
  }
}

/**
 * Resolve the bump from options, the worktree's latest allocation record, or
 * fail with LANDING_BUMP_REQUIRED.
 */
function resolveBump(
  root: string,
  worktreePath: string,
  bumpOption: ReleaseBump | undefined,
): ReleaseBump {
  if (bumpOption !== undefined) {
    return bumpOption
  }

  const latest = readReleaseAllocations(root)
    .filter(
      (record) => path.resolve(record.workspace) === path.resolve(worktreePath),
    )
    .at(-1)

  if (latest) {
    return latest.bump
  }

  throw new PanError(
    'No --bump option was given and no prior allocation record exists for ' +
      `this worktree. Run 'pan release land --worktree <name> --bump ` +
      "<major|minor|patch>'.",
    { code: 'LANDING_BUMP_REQUIRED' },
  )
}

/**
 * Integrate a candidate worktree branch with the current `pan-dev` tip,
 * allocate a version, verify, check, and fast-forward `pan-dev`.
 *
 * All steps run while holding the landing mutex.
 */
export function landRelease(
  root: string,
  options: LandReleaseOptions,
): LandingResult {
  const { worktree: worktreeName, runId = null, waitSeconds } = options

  const worktreeRelative = resolveWorktreeWorkspace(root, worktreeName)
  const worktreePath = path.resolve(root, worktreeRelative)
  const repositoryRoot = workspaceRepositoryRoot(root)

  const acquireStartAt = Date.now()

  const mutex: LandingMutexHolder = acquireLandingMutex(
    root,
    {
      worktree: worktreeName,
      command: `pan release land --worktree ${worktreeName}`,
      runId,
    },
    { waitSeconds },
  )

  const lockWaitSeconds = (Date.now() - acquireStartAt) / 1_000
  const holdStartAt = Date.now()
  const steps: LandingStep[] = []
  const recordStep = (
    step: LandingStepName,
    fields: Record<string, unknown> = {},
  ): void => {
    const at = new Date().toISOString()

    steps.push({ step, at })
    appendLandingEvent(root, { event: 'step', step, at, ...fields })
  }
  const finish = (
    result: Omit<
      LandingResult,
      'steps' | 'lock_wait_seconds' | 'lock_hold_seconds'
    >,
  ): LandingResult => {
    mutex.release()

    return {
      ...result,
      steps,
      lock_wait_seconds: lockWaitSeconds,
      lock_hold_seconds: (Date.now() - holdStartAt) / 1_000,
    }
  }

  try {
    // ── Step 1: Read the tip. ────────────────────────────────────────────────
    const tipCommit = gitRevParse(repositoryRoot, INTEGRATION_BRANCH)
    const tipVersionStr = tipVersion(repositoryRoot, tipCommit)

    recordStep('tip_read', {
      tip_commit: tipCommit,
      tip_version: tipVersionStr,
    })

    invariant(
      gitHead(worktreePath) !== null,
      `Candidate worktree '${worktreeName}' has no HEAD commit.`,
      { code: 'LANDING_NO_HEAD' },
    )

    // Resolved before integration, so a candidate without notes fails with
    // no merge commit on its branch and no landing allocation in the ledger.
    const releaseNotes = candidateReleaseNotes(worktreePath, tipCommit)

    // ── Step 2: Integrate. ───────────────────────────────────────────────────
    const integration = integrateCandidate(
      repositoryRoot,
      worktreePath,
      tipCommit,
    )

    if (integration.outcome === 'conflict') {
      recordStep('integrate', {
        outcome: 'conflict',
        source_conflicts: integration.source_conflicts,
      })

      return finish({
        status: 'conflict',
        tip_before: tipCommit,
        source_conflicts: integration.source_conflicts,
      })
    }

    const mergeCommit =
      integration.outcome === 'merged' ? integration.merge_commit : undefined

    recordStep('integrate', {
      outcome: integration.outcome,
      ...(mergeCommit ? { merge_commit: mergeCommit } : {}),
    })

    // ── Step 4: Allocate. ────────────────────────────────────────────────────
    const bump = resolveBump(root, worktreePath, options.bump)
    const allocation = allocateLandingVersion(
      root,
      worktreeName,
      tipVersionStr,
      bump,
      { runId, repositoryRoot },
    )

    recordStep('allocate', {
      version: allocation.version,
      bump,
      tip_version: tipVersionStr,
    })

    // ── Step 3: Regenerate metadata. ─────────────────────────────────────────
    // Logical step 3 runs after allocation because it needs the new version.
    // A head that already is this version's release pair is a retry after
    // finalize, and finalize reuses that pair unchanged.
    if (!headIsReleasePair(worktreePath, allocation.version)) {
      const tipChangelogContent =
        gitShowFile(repositoryRoot, tipCommit, 'CHANGELOG.md') ?? ''

      regenerateMetadata(
        repositoryRoot,
        worktreePath,
        tipCommit,
        allocation.version,
        releaseNotes,
        tipChangelogContent,
      )
      recordStep('metadata_regenerated', { version: allocation.version })
    }

    // ── Step 5: Finalize. ────────────────────────────────────────────────────
    // The tip is the ancestry anchor (`fetchedMain` in finalizeLocalRelease).
    const finalizeResult = finalizeLocalRelease(
      root,
      worktreeName,
      tipCommit,
      runId ?? undefined,
    )

    recordStep('finalize', {
      release_commit: finalizeResult.release_commit,
      index_commit: finalizeResult.index_commit,
    })

    const finalHead = gitHead(worktreePath)

    invariant(
      finalHead !== null,
      'Candidate worktree has no HEAD after finalize.',
      { code: 'LANDING_NO_HEAD' },
    )

    const released = {
      version: allocation.version,
      tip_before: tipCommit,
      release_commit: finalizeResult.release_commit,
      index_commit: finalizeResult.index_commit,
      ...(mergeCommit ? { merge_commit: mergeCommit } : {}),
    }

    // ── Step 6: Verify. ──────────────────────────────────────────────────────
    // Resolved after finalize, so the fingerprint reads the tree the release
    // commit left, which is the tree that lands.
    const verification = resolveLandingVerification(
      root,
      worktreePath,
      integration.outcome,
      runId,
      options.verifyProfiles,
    )
    const verifyProfiles = verification.profiles
    const basisFields = {
      basis: verification.basis,
      reason: verification.reason,
      ...(verification.source_fingerprint
        ? { source_fingerprint: verification.source_fingerprint }
        : {}),
    }

    // The candidate's own `dist/` predates the merge and the release commit,
    // so every profile would test an earlier tree. Compile the tree that
    // lands first, and refuse a tree that does not compile.
    const build = buildLandingTree(worktreePath)

    if (build.outcome !== 'not_applicable') {
      recordStep('build', {
        outcome: build.outcome,
        ...(build.build_stamp ? { build_stamp: build.build_stamp } : {}),
      })
    }

    if (build.outcome === 'failed') {
      return finish({
        status: 'verification_failed',
        ...released,
        verified_profiles: [],
        verification_basis: verification.basis,
        verification_output: build.output,
      })
    }

    const stampFields = build.build_stamp
      ? { build_stamp: build.build_stamp }
      : {}

    for (const profile of verifyProfiles) {
      const checkResult = runRepositoryCheck(root, profile, {
        workspace: worktreePath,
      })

      if (checkResult.status !== 'passed') {
        recordStep('verify', {
          profile,
          outcome: 'failed',
          ...basisFields,
          ...stampFields,
        })

        return finish({
          status: 'verification_failed',
          ...released,
          verified_profiles: [],
          verification_basis: verification.basis,
          ...stampFields,
          verification_output: JSON.stringify(checkResult, null, 2),
        })
      }

      recordStep('verify', {
        profile,
        outcome: 'passed',
        ...basisFields,
        ...stampFields,
      })
    }

    if (
      build.outcome === 'built' &&
      !landingBuildIsCurrent(worktreePath, build.build_stamp)
    ) {
      recordStep('build', { outcome: 'changed_during_verify', ...stampFields })

      return finish({
        status: 'verification_failed',
        ...released,
        verified_profiles: [],
        verification_basis: verification.basis,
        ...stampFields,
        verification_output:
          'The candidate sources changed while the verify profiles ran, so the profiles did not test the tree that lands. Run the land again.',
      })
    }

    // ── Step 7: Check. ───────────────────────────────────────────────────────
    const landingCheck = runLandingCheck(root, repositoryRoot, finalHead)

    if (!landingCheck.passed) {
      recordStep('check', { outcome: 'refused', reason: landingCheck.output })

      return finish({
        status: 'landing_refused',
        ...released,
        refused_reason: landingCheck.output,
      })
    }

    recordStep('check', { outcome: 'accepted' })

    // ── Step 8: Fast-forward pan-dev. ────────────────────────────────────────
    fastForwardPanDev(repositoryRoot, finalHead, tipCommit)

    const tipAfter = gitRevParse(repositoryRoot, INTEGRATION_BRANCH)

    recordStep('fast_forward', {
      tip_before: tipCommit,
      tip_after: tipAfter,
      version: allocation.version,
    })

    return finish({
      status: 'landed',
      ...released,
      tip_after: tipAfter,
      verified_profiles: verifyProfiles,
      verification_basis: verification.basis,
      ...stampFields,
    })
  } catch (error) {
    mutex.release()
    appendLandingEvent(root, {
      event: 'error',
      message: errorMessage(error),
    })
    throw error
  }
}

interface LandingBuild {
  outcome: 'built' | 'failed' | 'not_applicable'
  build_stamp?: string
  output?: string
}

function readBuildStamp(worktreePath: string): string | undefined {
  const stampPath = path.join(worktreePath, 'dist', '.build-stamp')

  return fileExists(stampPath)
    ? readText(stampPath).trim() || undefined
    : undefined
}

/**
 * Compile the candidate worktree's tree through its own `bin/run-built`.
 *
 * `bin/pan` exports `PANCREATOR_BUILD_READY` for the process tree, and this
 * command then merges and finalizes the release, so the inherited value
 * describes an earlier tree. The build runs without it, and `bin/build` swaps
 * `dist/` wholesale when the source fingerprint moved. A worktree without
 * the wrapper (a target installation) has no compiled tree to refresh.
 */
export function buildLandingTree(worktreePath: string): LandingBuild {
  const runBuilt = path.join(worktreePath, 'bin', 'run-built')

  if (!fileExists(runBuilt)) {
    return { outcome: 'not_applicable' }
  }

  const env = { ...process.env }

  delete env[BUILD_READY_ENV]

  const result = spawnSync(runBuilt, ['--build-only'], {
    cwd: worktreePath,
    env,
    encoding: 'utf8',
    maxBuffer: GIT_MAX_BUFFER,
    timeout: BUILD_TIMEOUT_MS,
  })

  if (result.status !== 0) {
    return {
      outcome: 'failed',
      output:
        result.stderr ||
        result.stdout ||
        result.error?.message ||
        'The build of the integrated tree failed.',
    }
  }

  const buildStamp = readBuildStamp(worktreePath)

  return {
    outcome: 'built',
    ...(buildStamp ? { build_stamp: buildStamp } : {}),
  }
}

/** Whether `dist/` still matches the sources and the stamp the land verified. */
export function landingBuildIsCurrent(
  worktreePath: string,
  buildStamp: string | undefined,
): boolean {
  const result = spawnSync(
    path.join(worktreePath, 'bin', 'build'),
    ['--stamp-fresh'],
    { cwd: worktreePath, timeout: GIT_TIMEOUT_MS },
  )

  return result.status === 0 && readBuildStamp(worktreePath) === buildStamp
}

/**
 * Decide the land's verify profiles.
 *
 * A land that merged commits, or names no run, or whose run has no executed
 * `full` entry-gate pass, keeps `full`. A no-op integrate on a tree whose
 * source content matches the one the entry gate verified runs `static` and
 * `configuration`. An operator-named profile list always wins.
 */
export function resolveLandingVerification(
  root: string,
  worktreePath: string,
  integration: TipIntegration['outcome'],
  runId: string | null,
  requested: string[] | undefined,
  readVerifiedSource: (
    runId: string,
  ) => { fingerprint: string; profile: string } | undefined = (id) =>
    Object.values(loadState(root, id).entry_gates ?? {}).find(
      (record) => record.verified_source?.profile === 'full',
    )?.verified_source,
): LandingVerification {
  if (requested && requested.length > 0) {
    return {
      profiles: requested,
      basis: 'operator',
      reason: 'the caller named the profiles with --verify-profile',
    }
  }

  const full = (reason: string): LandingVerification => ({
    profiles: ['full'],
    basis: 'default',
    reason,
  })

  if (integration !== 'already_current') {
    return full('integration merged commits, so the landing tree is new')
  }

  if (!runId) {
    return full('no --run names an entry gate that verified this tree')
  }

  let verified: { fingerprint: string; profile: string } | undefined

  try {
    verified = readVerifiedSource(runId)
  } catch {
    return full(`run ${runId} could not be read`)
  }

  if (verified?.profile !== 'full') {
    return full(`run ${runId} records no executed full entry-gate pass`)
  }

  const current = gitSourceContentFingerprint(
    worktreePath,
    RELEASE_LANDING_METADATA_PATHS,
  )

  if (current !== verified.fingerprint) {
    return full(
      'the worktree source differs from the tree the entry gate verified',
    )
  }

  return {
    profiles: VERIFIED_TREE_LAND_PROFILES,
    basis: 'entry_gate_fingerprint',
    reason:
      'integration merged nothing and the source matches the tree the ' +
      'entry gate verified on full; only release metadata changed',
    source_fingerprint: current,
  }
}

/** Export integration helpers for chunk-b-daily-quality. */
export { fastForwardPanDev as fastForwardIntegration, METADATA_PATHS }

/**
 * Integrate the current pan-dev tip into the candidate worktree.
 * Returns the merge commit hash, or null when already current, and throws
 * `LANDING_SOURCE_CONFLICT` naming the source paths otherwise.
 */
export function integrateTip(
  root: string,
  worktreeName: string,
  repositoryRoot: string,
  tipCommit: string,
): string | null {
  const worktreePath = path.resolve(
    root,
    resolveWorktreeWorkspace(root, worktreeName),
  )
  const integration = integrateCandidate(
    repositoryRoot,
    worktreePath,
    tipCommit,
  )

  if (integration.outcome === 'conflict') {
    throw new PanError(
      `Integration has source conflicts: ${integration.source_conflicts.join(', ')}`,
      {
        code: 'LANDING_SOURCE_CONFLICT',
        details: { source_conflicts: integration.source_conflicts },
      },
    )
  }

  return integration.outcome === 'merged' ? integration.merge_commit : null
}

/**
 * Run `bin/check-landing branch <head> <base>` and return whether it passed.
 */
export function runLandingCheck(
  root: string,
  repositoryRoot: string,
  candidateHead: string,
  baseRef: string = INTEGRATION_BRANCH,
): { passed: boolean; output: string } {
  const checkLandingPath = path.join(root, 'bin', 'check-landing')
  const result = spawnSync(
    checkLandingPath,
    ['branch', candidateHead, baseRef],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: GIT_MAX_BUFFER,
      timeout: GIT_TIMEOUT_MS,
    },
  )

  return {
    passed: result.status === 0,
    output: result.stderr || result.stdout || result.error?.message || '',
  }
}

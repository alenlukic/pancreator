/**
 * Landing result shapes and the individual landing steps: the landing log,
 * candidate integration, release-note and metadata regeneration, the
 * `pan-dev` fast-forward, and bump resolution.
 */

import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { invariant, PanError } from '../errors.js'
import {
  gitIsAncestor,
  gitConflictedPaths,
  gitStagePaths,
  gitCommit,
  gitCommitSubject,
  INTEGRATION_BRANCH,
} from '../git/branches.js'
import { gitShowFile, gitHead } from '../git/core.js'
import {
  gitMergeAbort,
  gitWorktreeForBranch,
  gitWorktreeIsDirty,
} from '../git/worktree-merge.js'
import { appendJsonLine, resolveInside, isRecord } from '../io.js'
import { readReleaseAllocations } from '../release-allocation.js'
import {
  RELEASE_LANDING_METADATA_PATHS,
  type ReleaseBump,
  isSemanticVersion,
} from '../versioning.js'

const LANDING_LOG_PATH = path.join('runtime', 'release', 'landing.jsonl')
export const GIT_TIMEOUT_MS = 120_000
export const GIT_MAX_BUFFER = 20 * 1024 * 1024
export const BUILD_TIMEOUT_MS = 600_000

/** A full SHA-1 or SHA-256 object name, the first field merge-tree prints. */
const OBJECT_NAME_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u

/** Metadata file paths that are resolved to the tip's content on integration. */
export const METADATA_PATHS = RELEASE_LANDING_METADATA_PATHS

const RELEASE_HEADING_PATTERN = /^## \[([^\]]+)\] - \d{4}-\d{2}-\d{2}/mu

export type LandingStatus =
  | 'landed'
  | 'conflict'
  | 'verification_failed'
  | 'landing_refused'

export type LandingStepName =
  | 'tip_read'
  | 'build_currency'
  | 'integrate'
  | 'repair'
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
  /** The bounded repair this land carried, when `--repair` named one. */
  repair?: LandingRepair
}

export interface LandingRepair {
  note: string
  paths: string[]
  /** The index commit of the release pair whose land failed and is reused. */
  repaired_from: string
}

export interface LandReleaseOptions {
  worktree: string
  bump?: ReleaseBump
  runId?: string | null
  verifyProfiles?: string[]
  waitSeconds?: number
  /** Why the failed land is relanded as a bounded repair. Requires `runId`. */
  repairNote?: string
}

/**
 * The profiles a land verifies with, and why.
 *
 * - `operator`: the caller named the profiles with `--verify-profile`.
 * - `entry_gate_fingerprint`: integration merged nothing, and the worktree's
 *   source content, outside the release metadata paths, equals the tree the
 *   run's ship entry gate verified on `full`. The release commit changed only
 *   metadata, so `static` and `configuration` check what it did change.
 * - `bounded_repair`: a ship repair of at most three lane test files on top of
 *   a finalized release. `static`, `configuration`, and the lane profile of
 *   each repaired path run.
 * - `default`: anything else runs `full`, with the reason recorded.
 */
export interface LandingVerification {
  profiles: string[]
  basis: 'operator' | 'entry_gate_fingerprint' | 'bounded_repair' | 'default'
  reason: string
  source_fingerprint?: string
}

/** The profiles a land after a matching verified tree runs. */
export const VERIFIED_TREE_LAND_PROFILES = ['static', 'configuration']

export type TipIntegration =
  | { outcome: 'already_current' }
  | { outcome: 'merged'; merge_commit: string }
  | { outcome: 'conflict'; source_conflicts: string[] }

/**
 * Append one timestamped event line to the release landing log at
 * `runtime/release/landing.jsonl`, creating its directory when needed.
 */
export function appendLandingEvent(
  root: string,
  event: Record<string, unknown>,
): void {
  appendJsonLine(resolveInside(root, LANDING_LOG_PATH), {
    timestamp: new Date().toISOString(),
    ...event,
  })
}

/**
 * The trimmed `VERSION` file content at the given `pan-dev` tip commit. Throws
 * `PanError` `LANDING_TIP_VERSION_MISSING` when the commit has no `VERSION`
 * file and `LANDING_TIP_VERSION_INVALID` when it is not a semantic version.
 */
export function tipVersion(repositoryRoot: string, tipCommit: string): string {
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
export function integrateCandidate(
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
export function candidateReleaseNotes(
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
export function headIsReleasePair(
  worktreePath: string,
  version: string,
): boolean {
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
export function regenerateMetadata(
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
export function fastForwardPanDev(
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
export function resolveBump(
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

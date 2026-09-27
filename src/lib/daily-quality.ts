/**
 * Daily quality pass: repairs conform and style issues on the pan-dev tip and
 * lands one marked, unversioned repair commit under the landing mutex.
 *
 * Only runs inside a self_development installation. Outside self-development
 * it records `skipped` and exits 0.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import { checkpointConformArtifacts, scanConformArtifacts } from './conform.js'
import { checkpointStyleArtifacts, scanStyleArtifacts } from './code-style.js'
import { PanError, errorMessage, invariant } from './errors.js'
import {
  gitHead,
  gitIsAncestor,
  gitStagePaths,
  gitStatusPaths,
  INTEGRATION_BRANCH,
} from './git.js'
import { readJson, resolveInside, writeJsonAtomic } from './io.js'
import { acquireLandingMutex } from './landing-mutex.js'
import { loadPipelineConfig, resolvePersonaModel } from './pipeline-config.js'
import { isSelfDevelopmentInstallation } from './project-config.js'
import { runRepositoryCheck } from './repository-checks.js'
import {
  resolveOrCreateWorktree,
  resolveWorktreeWorkspace,
  workspaceRepositoryRoot,
} from './worktrees.js'
import { runCursorAgentSession } from './executors/cursor-agent.js'

const DAILY_WORKTREE_NAME = 'daily-quality'
const QUALITY_BRANCH = 'pan-quality'
const DAILY_QUALITY_TRAILER_KEY = 'Pancreator-Daily-Quality'
const SURFACES_REGISTRY = 'governance/registries/daily_quality_surfaces.json'
const RESULT_ROOT = 'runtime/logs/quality'
const GIT_TIMEOUT_MS = 30_000

export interface DailyScanResult {
  conform_status: string
  style_status: string
}

export interface DailyQualityResult {
  status: 'clean' | 'repaired' | 'skipped' | 'failed'
  occurrence_id: string
  reason?: string
  scans?: DailyScanResult
  changed_files?: string[]
  commit?: string
  landed_tip?: string
  lock_wait_ms?: number
  error?: string
}

interface SurfacesRegistry {
  conform_paths: string[]
  style_extensions: string[]
}

function loadSurfaces(root: string): SurfacesRegistry {
  const p = resolveInside(root, SURFACES_REGISTRY)

  return readJson(p) as SurfacesRegistry
}

/** Convert a glob pattern to a RegExp. Supports * and **. */
function globToRegex(pattern: string): RegExp {
  let re = ''
  let i = 0

  while (i < pattern.length) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      re += '.*'
      i += 2
      if (pattern[i] === '/') {
        i++
      }
    } else if (pattern[i] === '*') {
      re += '[^/]*'
      i++
    } else {
      re += (pattern[i] ?? '').replace(/[.+^${}()|[\]\\]/g, '\\$&')
      i++
    }
  }

  return new RegExp(`^${re}$`)
}

function isPathOnSurface(
  filePath: string,
  surfaces: SurfacesRegistry,
): boolean {
  const lastDot = filePath.lastIndexOf('.')
  const ext = lastDot >= 0 ? filePath.slice(lastDot) : ''

  if (surfaces.style_extensions.includes(ext)) {
    return true
  }

  return surfaces.conform_paths.some((pattern) =>
    globToRegex(pattern).test(filePath),
  )
}

function resultPath(root: string, occurrenceId: string): string {
  return resolveInside(root, path.join(RESULT_ROOT, occurrenceId))
}

function writeResult(
  root: string,
  occurrenceId: string,
  record: DailyQualityResult,
): void {
  const dir = resultPath(root, occurrenceId)

  mkdirSync(dir, { recursive: true })
  writeJsonAtomic(path.join(dir, 'result.json'), record)
}

function gitRun(
  cwd: string,
  args: string[],
  options: { check?: boolean } = {},
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
  })

  if (options.check && result.status !== 0) {
    throw new PanError(
      `git ${args[0] ?? ''} failed: ${result.stderr || result.stdout}`,
      { code: 'GIT_COMMAND_FAILED' },
    )
  }

  return {
    status: result.status,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  }
}

/** Save a diff of uncommitted changes to failed.patch in the result dir. */
function saveFailedPatch(worktreeAbs: string, resultDir: string): void {
  mkdirSync(resultDir, { recursive: true })
  const diff = spawnSync('git', ['diff', 'HEAD'], {
    cwd: worktreeAbs,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
  })
  const diffOutput = diff.stdout ?? ''

  if (diffOutput.length > 0) {
    writeFileSync(path.join(resultDir, 'failed.patch'), diffOutput)
  }
}

/** Restore the worktree to a clean pan-quality HEAD. */
function restoreWorktree(worktreeAbs: string): void {
  spawnSync('git', ['checkout', '.'], {
    cwd: worktreeAbs,
    timeout: GIT_TIMEOUT_MS,
  })
  spawnSync('git', ['clean', '-fd'], {
    cwd: worktreeAbs,
    timeout: GIT_TIMEOUT_MS,
  })
}

/**
 * Run the daily quality pass.
 *
 * Outside a self_development installation, returns `skipped` immediately.
 */
export function runDailyQuality(
  root: string,
  _options: { json?: boolean } = {},
): DailyQualityResult {
  const occurrenceId = randomUUID()

  if (!isSelfDevelopmentInstallation(root)) {
    const result: DailyQualityResult = {
      status: 'skipped',
      occurrence_id: occurrenceId,
      reason: 'Not a self_development installation.',
    }

    writeResult(root, occurrenceId, result)
    return result
  }

  const repositoryRoot = workspaceRepositoryRoot(root)
  let worktreeAbs: string | null = null
  let mutex: ReturnType<typeof acquireLandingMutex> | null = null

  const fail = (reason: string, error?: string): DailyQualityResult => {
    const dir = resultPath(root, occurrenceId)

    if (worktreeAbs !== null) {
      saveFailedPatch(worktreeAbs, dir)
      restoreWorktree(worktreeAbs)
    }

    if (mutex !== null) {
      try {
        mutex.release()
      } catch {
        // Best-effort.
      }

      mutex = null
    }

    const result: DailyQualityResult = {
      status: 'failed',
      occurrence_id: occurrenceId,
      reason,
      error,
    }

    writeResult(root, occurrenceId, result)
    return result
  }

  try {
    // Step 1: Setup the daily-quality worktree.
    resolveOrCreateWorktree(root, DAILY_WORKTREE_NAME, `Daily quality worktree`)
    worktreeAbs = resolveInside(
      root,
      resolveWorktreeWorkspace(root, DAILY_WORKTREE_NAME),
    )

    // Check worktree is clean before switching branches.
    const statusPaths = gitStatusPaths(worktreeAbs)

    if (statusPaths.length > 0) {
      return fail(
        `DAILY_QUALITY_WORKTREE_DIRTY: the daily-quality worktree has uncommitted changes: ${statusPaths.join(', ')}`,
      )
    }

    // Resolve the current pan-dev tip.
    const panDevTip = gitRun(
      repositoryRoot,
      ['rev-parse', INTEGRATION_BRANCH],
      { check: true },
    ).stdout

    invariant(
      /^[0-9a-f]{40}$/u.test(panDevTip),
      `Could not resolve pan-dev tip: ${panDevTip}`,
      { code: 'DAILY_QUALITY_TIP_INVALID' },
    )

    // Switch pan-quality to the current pan-dev tip.
    // Allow the switch when either:
    // 1. pan-quality branch doesn't exist yet, or
    // 2. the old pan-quality head is an ancestor of pan-dev, or
    // 3. a failed.patch exists from a prior failed run (unlanded changes were saved).
    const branchExists =
      gitRun(worktreeAbs, ['rev-parse', '--verify', QUALITY_BRANCH], {
        check: false,
      }).status === 0

    if (branchExists) {
      const qualityHead = gitRun(worktreeAbs, ['rev-parse', QUALITY_BRANCH], {
        check: true,
      }).stdout
      const isAncestor = gitIsAncestor(repositoryRoot, qualityHead, panDevTip)

      // If the quality branch has commits not yet in pan-dev and no failed.patch
      // saved them, refuse the reset to avoid losing work.
      if (!isAncestor) {
        // Check the most recent result dirs for failed.patch.
        const hasSavedPatch =
          spawnSync(
            'find',
            [
              resolveInside(root, RESULT_ROOT),
              '-name',
              'failed.patch',
              '-maxdepth',
              '2',
            ],
            { encoding: 'utf8', timeout: GIT_TIMEOUT_MS },
          ).stdout.trim().length > 0

        if (!hasSavedPatch) {
          return fail(
            `${QUALITY_BRANCH} has commits not yet in ${INTEGRATION_BRANCH} and no saved patch from a failed run. Cannot reset safely.`,
          )
        }
      }
    }

    gitRun(worktreeAbs, ['switch', '-C', QUALITY_BRANCH, panDevTip], {
      check: true,
    })

    // Step 2: Run conform and style scans.
    const conformScan = scanConformArtifacts(root, {
      workspace_root: worktreeAbs,
      all: true,
    })
    const styleScan = scanStyleArtifacts(root, {
      workspace_root: worktreeAbs,
      all: true,
    })

    const conformPassed = conformScan.status === 'passed'
    const stylePassed = styleScan.status === 'passed'

    if (conformPassed && stylePassed) {
      // Both pass: write checkpoints, record clean, return.
      checkpointConformArtifacts(root, {
        workspace_root: worktreeAbs,
        all: true,
      })
      checkpointStyleArtifacts(root, { workspace_root: worktreeAbs, all: true })

      const result: DailyQualityResult = {
        status: 'clean',
        occurrence_id: occurrenceId,
        scans: {
          conform_status: conformScan.status,
          style_status: styleScan.status,
        },
      }

      writeResult(root, occurrenceId, result)
      return result
    }

    // Step 3: Launch repair agent.
    const loaded = loadPipelineConfig(root)
    const model = resolvePersonaModel(loaded.config, 'pan-librarian')

    const repairPrompt = [
      `Run \`./bin/pan governance card --mode conform --worktree ${DAILY_WORKTREE_NAME}\` and read the card.`,
      `Run \`./bin/pan governance card --mode style --worktree ${DAILY_WORKTREE_NAME}\` and read the card.`,
      `Repair only the files the scans list. Do not commit. Do not edit any other file.`,
      `Conform issues: ${
        conformPassed
          ? 'none'
          : conformScan.files
              .filter((f) => f.editable && f.issues.length > 0)
              .map((f) => f.relative_path)
              .join(', ')
      }`,
      `Style issues: ${
        stylePassed
          ? 'none'
          : styleScan.files
              .filter((f) => f.editable && f.issues.length > 0)
              .map((f) => f.relative_path)
              .join(', ')
      }`,
    ].join('\n')

    const agentResult = runCursorAgentSession({
      prompt: repairPrompt,
      cwd: worktreeAbs,
      workspaceRoot: worktreeAbs,
      installationRoot: root,
      requireTrust: true,
      model,
      writeRoots: [worktreeAbs],
    })

    if (!agentResult.ok) {
      return fail(
        `Repair agent failed with exit code ${agentResult.exit_code ?? 'null'}.`,
        agentResult.stderr || agentResult.stdout,
      )
    }

    // Step 4: Check scope — every changed path must be on a surface.
    const surfaces = loadSurfaces(root)
    const changedPaths = gitStatusPaths(worktreeAbs)

    if (changedPaths.length === 0) {
      // Agent made no changes; scans must pass now or fail gracefully.
      return fail(
        'Repair agent ran but made no changes. The scans are still unclean.',
      )
    }

    const offSurface = changedPaths.filter((p) => !isPathOnSurface(p, surfaces))

    if (offSurface.length > 0) {
      return fail(
        `Agent changed paths outside the daily quality surfaces: ${offSurface.join(', ')}`,
      )
    }

    // Step 5: Validate changed files and run profiles.
    // Run static and fast profiles in the worktree.
    const staticResult = runRepositoryCheck(root, 'static', {
      workspace: worktreeAbs,
    })
    const fastResult = runRepositoryCheck(root, 'fast', {
      workspace: worktreeAbs,
    })

    if (!staticResult.status || staticResult.status !== 'passed') {
      return fail(`Static check failed in the daily-quality worktree.`)
    }

    if (!fastResult.status || fastResult.status !== 'passed') {
      return fail(`Fast check failed in the daily-quality worktree.`)
    }

    // Write conform and style checkpoints.
    const conformCp = checkpointConformArtifacts(root, {
      workspace_root: worktreeAbs,
      all: true,
    })

    if (conformCp.status === 'blocked') {
      return fail('Conform checkpoint is still blocked after repair.')
    }

    const styleCp = checkpointStyleArtifacts(root, {
      workspace_root: worktreeAbs,
      all: true,
    })

    if (styleCp.status === 'blocked') {
      return fail('Style checkpoint is still blocked after repair.')
    }

    // Step 6: Commit with trailer.
    const today = new Date().toISOString().slice(0, 10)
    const commitSubject = `style: daily conform and style pass ${today}`
    const commitMessage = `${commitSubject}\n\n${DAILY_QUALITY_TRAILER_KEY}: ${occurrenceId}\n`

    gitStagePaths(worktreeAbs, changedPaths)
    const commitResult = spawnSync('git', ['commit', '-m', commitMessage], {
      cwd: worktreeAbs,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
    })

    if (commitResult.status !== 0) {
      return fail(
        `Commit failed: ${commitResult.stderr || commitResult.stdout}`,
      )
    }

    const commitHash = gitHead(worktreeAbs)

    if (!commitHash) {
      return fail('Could not read commit hash after commit.')
    }

    // Step 7: Land under mutex.
    const mutexStartMs = Date.now()

    mutex = acquireLandingMutex(root, {
      worktree: DAILY_WORKTREE_NAME,
      command: 'pan quality daily',
    })

    const lockWaitMs = Date.now() - mutexStartMs

    // Re-read the pan-dev tip; it may have moved while we were repairing.
    const currentTip = gitRun(
      repositoryRoot,
      ['rev-parse', INTEGRATION_BRANCH],
      { check: true },
    ).stdout

    if (currentTip !== panDevTip) {
      // Tip moved. Rebase the one commit onto the new tip.
      const rebaseResult = spawnSync('git', ['rebase', currentTip], {
        cwd: worktreeAbs,
        encoding: 'utf8',
        timeout: GIT_TIMEOUT_MS,
      })

      if (rebaseResult.status !== 0) {
        return fail(
          `Rebase onto moved pan-dev tip failed: ${rebaseResult.stderr || rebaseResult.stdout}`,
        )
      }

      // Re-run static and fast after rebase.
      const staticResult2 = runRepositoryCheck(root, 'static', {
        workspace: worktreeAbs,
      })
      const fastResult2 = runRepositoryCheck(root, 'fast', {
        workspace: worktreeAbs,
      })

      if (!staticResult2.status || staticResult2.status !== 'passed') {
        return fail('Static check failed after rebase onto moved pan-dev tip.')
      }

      if (!fastResult2.status || fastResult2.status !== 'passed') {
        return fail('Fast check failed after rebase onto moved pan-dev tip.')
      }
    }

    const finalHead = gitHead(worktreeAbs)

    if (!finalHead) {
      return fail('Could not read HEAD after landing preparation.')
    }

    // Run bin/check-landing to validate the daily commit.
    const checkLandingPath = path.join(root, 'bin', 'check-landing')
    const checkResult = spawnSync(
      checkLandingPath,
      ['daily-range', currentTip, finalHead],
      { cwd: repositoryRoot, encoding: 'utf8', timeout: GIT_TIMEOUT_MS },
    )

    if (checkResult.status !== 0) {
      return fail(
        `bin/check-landing daily-range refused the commit: ${checkResult.stderr || checkResult.stdout}`,
      )
    }

    // Fast-forward pan-dev.
    const ffResult = spawnSync(
      'git',
      ['update-ref', `refs/heads/${INTEGRATION_BRANCH}`, finalHead, currentTip],
      { cwd: repositoryRoot, encoding: 'utf8', timeout: GIT_TIMEOUT_MS },
    )

    if (ffResult.status !== 0) {
      // Try via checked-out worktree if present.
      const ffMerge = spawnSync('git', ['merge', '--ff-only', finalHead], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        timeout: GIT_TIMEOUT_MS,
      })

      if (ffMerge.status !== 0) {
        return fail(
          `Fast-forward of ${INTEGRATION_BRANCH} failed: ${ffMerge.stderr || ffMerge.stdout}`,
        )
      }
    }

    // Release mutex.
    mutex.release()
    mutex = null

    const landedTip = gitRun(
      repositoryRoot,
      ['rev-parse', INTEGRATION_BRANCH],
      { check: true },
    ).stdout

    // Step 8: Write result record.
    const result: DailyQualityResult = {
      status: 'repaired',
      occurrence_id: occurrenceId,
      scans: {
        conform_status: conformScan.status,
        style_status: styleScan.status,
      },
      changed_files: changedPaths,
      commit: finalHead,
      landed_tip: landedTip,
      lock_wait_ms: lockWaitMs,
    }

    writeResult(root, occurrenceId, result)
    return result
  } catch (error) {
    return fail(`Unexpected error: ${errorMessage(error)}`, errorMessage(error))
  } finally {
    // Ensure mutex is always released.
    if (mutex !== null) {
      try {
        mutex.release()
      } catch {
        // Ignore.
      }
    }
  }
}

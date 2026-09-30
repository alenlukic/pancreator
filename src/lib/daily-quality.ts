/**
 * Daily quality pass: repairs conform and style issues on the pan-dev tip and
 * lands one marked, unversioned repair commit under the landing mutex.
 *
 * Only runs inside a self_development installation. Outside self-development
 * it records `skipped` and exits 0.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
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
import { isRecord, readJson, resolveInside, writeJsonAtomic } from './io.js'
import { acquireLandingMutex } from './landing-mutex.js'
import { loadPipelineConfig, resolvePersonaModel } from './pipeline-config.js'
import { isSelfDevelopmentInstallation } from './project-config.js'
import { fastForwardIntegration, runLandingCheck } from './release-landing.js'
import { runRepositoryCheck } from './repository-checks/runner.js'
import { loadRegistry } from './requirements/registry.js'
import { isPassingResult, runRequirement } from './requirements/run.js'
import type { ResolvedRequirement } from './types.js'
import { codeStylePolicyId } from './validators/code-style.js'
import {
  readWorktreeIndex,
  resolveOrCreateWorktree,
  resolveWorktreeWorkspace,
  workspaceRepositoryRoot,
} from './worktrees.js'
import { runCursorAgentSession } from './executors/cursor-agent.js'

const DAILY_WORKTREE_NAME = 'daily-quality'
const QUALITY_BRANCH = 'pan-quality'
const REPAIR_PERSONA = 'librarian'
const DAILY_QUALITY_TRAILER_KEY = 'Pancreator-Daily-Quality'
const SURFACES_REGISTRY = 'governance/registries/daily_quality_surfaces.json'
const RESULT_ROOT = 'runtime/logs/quality'
const FAILED_PATCH = 'failed.patch'
const GIT_TIMEOUT_MS = 30_000
const GIT_MAX_BUFFER = 64 * 1024 * 1024

export interface DailyScanResult {
  conform_status: string
  style_status: string
}

export interface DailyValidatorResult {
  path: string
  registry_id: string
  policy_id: string
  status: string
  issue_count: number
}

export interface DailyProfileResult {
  profile: string
  phase: 'repair' | 'rebase'
  status: string
}

export interface DailyQualityResult {
  status: 'clean' | 'repaired' | 'skipped' | 'failed'
  occurrence_id: string
  reason?: string
  scans?: DailyScanResult
  changed_files?: string[]
  validator_results?: DailyValidatorResult[]
  profile_results?: DailyProfileResult[]
  commit?: string
  /** A pan-quality commit that a failed run left unlanded; failed.patch holds it. */
  unlanded_head?: string
  landed_tip?: string
  lock_wait_ms?: number
  error?: string
}

interface SurfacesRegistry {
  conform_paths: string[]
  style_extensions: string[]
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/**
 * The surfaces a daily commit may change, read from the pan-dev tip the
 * repair starts from, so the repair agent cannot widen them.
 */
function loadSurfaces(
  repositoryRoot: string,
  commit: string,
): SurfacesRegistry {
  const shown = gitRun(repositoryRoot, [
    'show',
    `${commit}:${SURFACES_REGISTRY}`,
  ])

  invariant(
    shown.status === 0,
    `The pan-dev tip ${commit} carries no ${SURFACES_REGISTRY}.`,
    { code: 'DAILY_QUALITY_SURFACES_MISSING' },
  )

  const value: unknown = JSON.parse(shown.stdout)

  invariant(
    isRecord(value) &&
      isStringArray(value.conform_paths) &&
      isStringArray(value.style_extensions),
    `${SURFACES_REGISTRY} MUST hold string arrays conform_paths and style_extensions.`,
    { code: 'DAILY_QUALITY_SURFACES_INVALID' },
  )

  return {
    conform_paths: value.conform_paths,
    style_extensions: value.style_extensions,
  }
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

function isStylePath(filePath: string, surfaces: SurfacesRegistry): boolean {
  const lastDot = filePath.lastIndexOf('.')
  const extension = lastDot >= 0 ? filePath.slice(lastDot) : ''

  return surfaces.style_extensions.includes(extension)
}

function isConformPath(filePath: string, surfaces: SurfacesRegistry): boolean {
  return surfaces.conform_paths.some((pattern) =>
    globToRegex(pattern).test(filePath),
  )
}

function resultPath(root: string, occurrenceId: string): string {
  return resolveInside(root, path.join(RESULT_ROOT, occurrenceId))
}

function writeResult(root: string, record: DailyQualityResult): void {
  const dir = resultPath(root, record.occurrence_id)

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
    maxBuffer: GIT_MAX_BUFFER,
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

/** The recorded daily-quality worktree path, or null before the first run. */
function existingWorktreePath(root: string): string | null {
  const record = readWorktreeIndex(root).worktrees.find(
    (entry) => entry.name === DAILY_WORKTREE_NAME,
  )

  if (!record) {
    return null
  }

  const absolute = resolveInside(root, record.path)

  return existsSync(absolute) ? absolute : null
}

/**
 * Whether a failed run recorded `head` as its unlanded commit and kept the
 * patch that preserves it, so switching pan-quality away loses nothing.
 */
function hasSavedPatchFor(root: string, head: string): boolean {
  const resultRoot = resolveInside(root, RESULT_ROOT)

  if (!existsSync(resultRoot)) {
    return false
  }

  return readdirSync(resultRoot).some((occurrence) => {
    const dir = path.join(resultRoot, occurrence)
    const resultFile = path.join(dir, 'result.json')

    if (!existsSync(resultFile) || !existsSync(path.join(dir, FAILED_PATCH))) {
      return false
    }

    try {
      const value = readJson(resultFile)

      return (
        isRecord(value) &&
        value.status === 'failed' &&
        value.unlanded_head === head
      )
    } catch {
      return false
    }
  })
}

function rebaseInProgress(worktreeAbs: string): boolean {
  const gitDir = gitRun(worktreeAbs, ['rev-parse', '--absolute-git-dir'])

  return (
    gitDir.status === 0 &&
    (existsSync(path.join(gitDir.stdout, 'rebase-merge')) ||
      existsSync(path.join(gitDir.stdout, 'rebase-apply')))
  )
}

/**
 * Save the unlanded work to failed.patch: the daily commit once it exists,
 * otherwise every uncommitted change, untracked files included.
 */
function saveFailedPatch(
  worktreeAbs: string,
  resultDir: string,
  commitBase: string | null,
): void {
  if (commitBase === null) {
    gitRun(worktreeAbs, ['add', '-A', '--', '.'])
  }

  const args =
    commitBase === null
      ? ['diff', '--cached', '--binary', 'HEAD']
      : ['format-patch', '--stdout', '--binary', `${commitBase}..HEAD`]
  // The patch is kept untrimmed so `git apply` and `git am` accept it.
  const patch = spawnSync('git', args, {
    cwd: worktreeAbs,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  })
  const text = patch.stdout ?? ''

  if (text.length > 0) {
    mkdirSync(resultDir, { recursive: true })
    writeFileSync(path.join(resultDir, FAILED_PATCH), text)
  }
}

/** Restore the worktree to a clean pan-quality head after the patch is saved. */
function restoreWorktree(worktreeAbs: string): void {
  gitRun(worktreeAbs, [
    'restore',
    '--source=HEAD',
    '--staged',
    '--worktree',
    '--',
    '.',
  ])
  gitRun(worktreeAbs, ['clean', '-fd'])
}

function repairPrompt(
  conformFiles: readonly string[],
  styleFiles: readonly string[],
): string {
  const listed = (files: readonly string[]): string =>
    files.length > 0 ? files.join(', ') : 'none'

  return [
    `Run \`./bin/pan governance card --mode conform --worktree ${DAILY_WORKTREE_NAME}\` and read the card.`,
    `Run \`./bin/pan governance card --mode style --worktree ${DAILY_WORKTREE_NAME}\` and read the card.`,
    `Repair only the files the scans list. Do not commit. Do not edit any other file.`,
    `Conform issues: ${listed(conformFiles)}`,
    `Style issues: ${listed(styleFiles)}`,
  ].join('\n')
}

function validatorRequirement(
  registryId: string,
  policyId: string,
  targetPath: string,
): ResolvedRequirement {
  return {
    policy_id: policyId,
    requirement_id: 'daily-quality-changed-file-validate',
    registry_id: registryId,
    registry_version: '1',
    kind: 'validator',
    phase: 'pre_submit',
    executor: 'harness',
    target: targetPath,
    arguments: {},
    enforcement: 'required',
    failure_route: 'stage_failure',
    evidence_class: 'validation',
    success_condition: `${registryId} passes against ${targetPath}`,
  }
}

/**
 * Validate each changed file with the validator its surface names:
 * CODE-STYLE-VALIDATE-001 for source and SIMPLIFIED-ENGLISH-VALIDATE-001
 * for conform files.
 */
function validateChangedFiles(
  root: string,
  worktreeAbs: string,
  changedPaths: readonly string[],
  surfaces: SurfacesRegistry,
): DailyValidatorResult[] {
  const catalog = loadRegistry(root)
  const results: DailyValidatorResult[] = []

  for (const changed of changedPaths) {
    const stylePolicy = isStylePath(changed, surfaces)
      ? codeStylePolicyId(changed)
      : null
    const selected = stylePolicy
      ? { registry: 'CODE-STYLE-VALIDATE-001', policy: stylePolicy }
      : isConformPath(changed, surfaces)
        ? { registry: 'SIMPLIFIED-ENGLISH-VALIDATE-001', policy: 'STE-001' }
        : null

    if (selected === null) {
      results.push({
        path: changed,
        registry_id: 'none',
        policy_id: 'none',
        status: 'not_applicable',
        issue_count: 0,
      })
      continue
    }

    const result = runRequirement({
      root: worktreeAbs,
      requirement: validatorRequirement(
        selected.registry,
        selected.policy,
        changed,
      ),
      targetPath: changed,
      executor: 'harness',
      catalog,
      persist: false,
    })

    results.push({
      path: changed,
      registry_id: selected.registry,
      policy_id: selected.policy,
      status: isPassingResult(result) ? result.status : 'failed',
      issue_count: result.issues.length,
    })
  }

  return results
}

function runProfile(
  root: string,
  worktreeAbs: string,
  profile: 'static' | 'fast',
  phase: DailyProfileResult['phase'],
): DailyProfileResult {
  const result = runRepositoryCheck(root, profile, { workspace: worktreeAbs })

  return { profile, phase, status: result.status }
}

/**
 * Run the daily quality pass.
 *
 * Outside a self_development installation, returns `skipped` immediately.
 */
export function runDailyQuality(root: string): DailyQualityResult {
  const occurrenceId = randomUUID()

  if (!isSelfDevelopmentInstallation(root)) {
    const result: DailyQualityResult = {
      status: 'skipped',
      occurrence_id: occurrenceId,
      reason: 'Not a self_development installation.',
    }

    writeResult(root, result)
    return result
  }

  const repositoryRoot = workspaceRepositoryRoot(root)
  const record: DailyQualityResult = {
    status: 'failed',
    occurrence_id: occurrenceId,
  }

  // Set once the run owns the worktree state, so a refusal never touches it.
  let ownedWorktree: string | null = null
  // The commit the daily commit sits on, once the commit exists.
  let commitBase: string | null = null
  let mutex: ReturnType<typeof acquireLandingMutex> | null = null

  const releaseMutex = (): void => {
    if (mutex === null) {
      return
    }

    try {
      mutex.release()
    } catch {
      // The mutex recovers a lock whose holder is gone.
    }

    mutex = null
  }

  const fail = (reason: string, error?: string): DailyQualityResult => {
    if (ownedWorktree !== null) {
      if (rebaseInProgress(ownedWorktree)) {
        gitRun(ownedWorktree, ['rebase', '--abort'])
      }

      saveFailedPatch(ownedWorktree, resultPath(root, occurrenceId), commitBase)
      restoreWorktree(ownedWorktree)

      if (commitBase !== null) {
        record.unlanded_head = gitHead(ownedWorktree) ?? undefined
      }
    }

    releaseMutex()

    const result: DailyQualityResult = {
      ...record,
      status: 'failed',
      reason,
      ...(error === undefined ? {} : { error }),
    }

    writeResult(root, result)
    return result
  }

  try {
    // Step 1: the worktree. A dirty worktree is refused before anything
    // switches its branch, and the refusal leaves every path in place.
    const knownWorktree = existingWorktreePath(root)
    const dirtyPaths = knownWorktree ? gitStatusPaths(knownWorktree) : []

    if (dirtyPaths.length > 0) {
      return fail(
        `DAILY_QUALITY_WORKTREE_DIRTY: the daily-quality worktree has uncommitted changes: ${dirtyPaths.join(', ')}`,
      )
    }

    resolveOrCreateWorktree(root, DAILY_WORKTREE_NAME, 'Daily quality worktree')
    const worktreeAbs = resolveInside(
      root,
      resolveWorktreeWorkspace(root, DAILY_WORKTREE_NAME),
    )
    const panDevTip = gitRun(
      repositoryRoot,
      ['rev-parse', INTEGRATION_BRANCH],
      {
        check: true,
      },
    ).stdout

    invariant(
      /^[0-9a-f]{40}$/u.test(panDevTip),
      `Could not resolve pan-dev tip: ${panDevTip}`,
      { code: 'DAILY_QUALITY_TIP_INVALID' },
    )

    const qualityHead = gitRun(worktreeAbs, [
      'rev-parse',
      '--verify',
      `refs/heads/${QUALITY_BRANCH}`,
    ])

    if (
      qualityHead.status === 0 &&
      !gitIsAncestor(repositoryRoot, qualityHead.stdout, panDevTip) &&
      !hasSavedPatchFor(root, qualityHead.stdout)
    ) {
      return fail(
        `${QUALITY_BRANCH} holds ${qualityHead.stdout}, which is not on ${INTEGRATION_BRANCH} and no failed run saved as a patch. Cannot reset safely.`,
      )
    }

    gitRun(worktreeAbs, ['switch', '-C', QUALITY_BRANCH, panDevTip], {
      check: true,
    })
    ownedWorktree = worktreeAbs

    // Step 2: scans. Conform judges only the worktree, because harness-root
    // runtime artifacts are outside the repair agent's write roots.
    const conformScan = scanConformArtifacts(root, {
      workspace_root: worktreeAbs,
      all: true,
      workspace_only: true,
    })
    const styleScan = scanStyleArtifacts(root, {
      workspace_root: worktreeAbs,
      all: true,
    })

    record.scans = {
      conform_status: conformScan.status,
      style_status: styleScan.status,
    }

    if (conformScan.status === 'passed' && styleScan.status === 'passed') {
      checkpointConformArtifacts(root, {
        workspace_root: worktreeAbs,
        all: true,
        workspace_only: true,
      })
      checkpointStyleArtifacts(root, { workspace_root: worktreeAbs, all: true })

      const result: DailyQualityResult = { ...record, status: 'clean' }

      writeResult(root, result)
      return result
    }

    // Step 3: repair agent.
    const model = resolvePersonaModel(
      loadPipelineConfig(root).config,
      REPAIR_PERSONA,
    )
    const conformFiles = conformScan.files
      .filter((file) => file.editable && file.issues.length > 0)
      .map((file) => file.relative_path)
    const styleFiles = styleScan.files
      .filter((file) => file.editable && file.issues.length > 0)
      .map((file) => file.relative_path)
    const agentResult = runCursorAgentSession({
      prompt: repairPrompt(conformFiles, styleFiles),
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

    // Step 4: scope.
    const surfaces = loadSurfaces(repositoryRoot, panDevTip)
    const changedPaths = gitStatusPaths(worktreeAbs)

    record.changed_files = changedPaths

    if (changedPaths.length === 0) {
      return fail(
        'Repair agent ran but made no changes. The scans are still unclean.',
      )
    }

    const offSurface = changedPaths.filter(
      (changed) =>
        !isStylePath(changed, surfaces) && !isConformPath(changed, surfaces),
    )

    if (offSurface.length > 0) {
      return fail(
        `Agent changed paths outside the daily quality surfaces: ${offSurface.join(', ')}`,
      )
    }

    // Step 5: validators, profiles, then checkpoints.
    record.validator_results = validateChangedFiles(
      root,
      worktreeAbs,
      changedPaths,
      surfaces,
    )

    const failedValidation = record.validator_results.filter(
      (entry) => entry.status !== 'passed' && entry.status !== 'not_applicable',
    )

    if (failedValidation.length > 0) {
      return fail(
        `Validation failed for: ${failedValidation.map((entry) => `${entry.path} (${entry.registry_id})`).join(', ')}`,
      )
    }

    record.profile_results = []

    for (const profile of ['static', 'fast'] as const) {
      const profileResult = runProfile(root, worktreeAbs, profile, 'repair')

      record.profile_results.push(profileResult)

      if (profileResult.status !== 'passed') {
        return fail(
          `The ${profile} profile failed in the daily-quality worktree.`,
        )
      }
    }

    const conformCheckpoint = checkpointConformArtifacts(root, {
      workspace_root: worktreeAbs,
      all: true,
      workspace_only: true,
    })

    if (conformCheckpoint.status === 'blocked') {
      return fail('Conform checkpoint is still blocked after repair.')
    }

    const styleCheckpoint = checkpointStyleArtifacts(root, {
      workspace_root: worktreeAbs,
      all: true,
    })

    if (styleCheckpoint.status === 'blocked') {
      return fail('Style checkpoint is still blocked after repair.')
    }

    // Step 6: commit.
    const today = new Date().toISOString().slice(0, 10)
    const commitMessage = `style: daily conform and style pass ${today}\n\n${DAILY_QUALITY_TRAILER_KEY}: ${occurrenceId}\n`

    gitStagePaths(worktreeAbs, changedPaths)
    const commitResult = gitRun(worktreeAbs, ['commit', '-m', commitMessage])

    if (commitResult.status !== 0) {
      return fail(
        `Commit failed: ${commitResult.stderr || commitResult.stdout}`,
      )
    }

    commitBase = panDevTip
    record.commit = gitHead(worktreeAbs) ?? undefined

    // Step 7: land under the mutex.
    const mutexStartMs = Date.now()

    mutex = acquireLandingMutex(root, {
      worktree: DAILY_WORKTREE_NAME,
      command: 'pan quality daily',
    })
    record.lock_wait_ms = Date.now() - mutexStartMs

    const currentTip = gitRun(
      repositoryRoot,
      ['rev-parse', INTEGRATION_BRANCH],
      {
        check: true,
      },
    ).stdout

    if (currentTip !== panDevTip) {
      const rebase = gitRun(worktreeAbs, [
        'rebase',
        '--onto',
        currentTip,
        panDevTip,
      ])

      if (rebase.status !== 0) {
        return fail(
          `Rebase onto moved pan-dev tip failed: ${rebase.stderr || rebase.stdout}`,
        )
      }

      commitBase = currentTip

      for (const profile of ['static', 'fast'] as const) {
        const profileResult = runProfile(root, worktreeAbs, profile, 'rebase')

        record.profile_results.push(profileResult)

        if (profileResult.status !== 'passed') {
          return fail(
            `The ${profile} profile failed after rebase onto the moved pan-dev tip.`,
          )
        }
      }
    }

    const finalHead = gitHead(worktreeAbs)

    if (!finalHead) {
      return fail('Could not read HEAD after landing preparation.')
    }

    record.commit = finalHead

    const landingCheck = runLandingCheck(
      root,
      repositoryRoot,
      QUALITY_BRANCH,
      INTEGRATION_BRANCH,
    )

    if (!landingCheck.passed) {
      return fail(
        `bin/check-landing branch ${QUALITY_BRANCH} ${INTEGRATION_BRANCH} refused the commit: ${landingCheck.output}`,
      )
    }

    try {
      fastForwardIntegration(repositoryRoot, finalHead, currentTip)
    } catch (error) {
      return fail(
        `Fast-forward of ${INTEGRATION_BRANCH} failed.`,
        errorMessage(error),
      )
    }

    releaseMutex()

    // Step 8: record.
    const result: DailyQualityResult = {
      ...record,
      status: 'repaired',
      landed_tip: gitRun(repositoryRoot, ['rev-parse', INTEGRATION_BRANCH], {
        check: true,
      }).stdout,
    }

    writeResult(root, result)
    return result
  } catch (error) {
    return fail(`Unexpected error: ${errorMessage(error)}`, errorMessage(error))
  } finally {
    releaseMutex()
  }
}

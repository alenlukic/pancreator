/** Test inventories and the prepared tune session. */

import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import { PanError } from '../errors.js'
import { isGitRepository } from '../git.js'
import { fileExists, readJson, writeJsonAtomic } from '../io.js'
import { isTargetInstallation } from '../project-config.js'
import {
  identityKey,
  loadLatestRecord,
  type TestIdentity,
  TUNE_WORK_DIR,
  type TuneRecord,
  tuneSessionWorkDir,
} from './record.js'

/** Throws `TUNE_SELF_DEVELOPMENT_ONLY` in a target installation, whose payload carries no harness tests. */
export function assertSelfDevelopment(root: string): void {
  if (isTargetInstallation(root)) {
    throw new PanError(
      'pan tune is available only in self-development because installed payloads contain no harness tests.',
      { code: 'TUNE_SELF_DEVELOPMENT_ONLY' },
    )
  }
}

/** Trimmed contents of the `VERSION` file, or `unknown` when it cannot be read. */
export function harnessVersion(root: string): string {
  try {
    return readFileSync(path.join(root, 'VERSION'), 'utf8').trim()
  } catch {
    return 'unknown'
  }
}

function readInventoryFile(absolute: string): TestIdentity[] {
  const value = readJson(absolute) as { identities?: TestIdentity[] }

  if (!Array.isArray(value.identities)) {
    throw new PanError(`invalid inventory file: ${absolute}`, {
      code: 'TUNE_INVENTORY_INVALID',
    })
  }

  return value.identities
}

function runInventoryCollection(options: {
  cwd: string
  reporterRoot: string
  out: string
  errorPrefix: string
  errorCode: 'TUNE_INVENTORY_FAILED' | 'TUNE_BASELINE_BUILD_FAILED'
}): TestIdentity[] {
  const cwd = path.resolve(options.cwd)
  const reporterRoot = path.resolve(options.reporterRoot)
  const out = path.resolve(options.out)

  const reporterDir = path.join(reporterRoot, 'dist/tests/reporters')
  const reporterSource = path.join(reporterDir, 'inventory.js')
  const reporterInCwd = path.join(cwd, 'dist/tests/reporters/inventory.js')

  if (!existsSync(reporterSource)) {
    throw new PanError(`inventory reporter missing: ${reporterSource}`, {
      code: options.errorCode,
    })
  }

  if (!existsSync(reporterInCwd)) {
    mkdirSync(path.dirname(reporterInCwd), { recursive: true })
    copyFileSync(reporterSource, reporterInCwd)
  }

  const lanes = ['unit', 'integration', 'regression', 'secondary']
  const merged = new Map<string, TestIdentity>()
  let ranAny = false

  for (const lane of lanes) {
    const dir = path.join(cwd, 'dist/tests', lane)

    if (!existsSync(dir)) {
      continue
    }

    const files = readdirSync(dir)
      .filter((entry) => entry.endsWith('.test.js'))
      .map((entry) => path.join(dir, entry))
      .sort()

    if (files.length === 0) {
      continue
    }

    ranAny = true
    const laneOut = `${out}.${lane}`
    const result = spawnSync(
      process.execPath,
      [
        '--test',
        `--test-reporter=${reporterInCwd}`,
        '--test-reporter-destination=stdout',
        '--test-name-pattern=^$',
        ...files,
      ],
      {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          PAN_TEST_INVENTORY: laneOut,
        },
      },
    )

    if (!existsSync(laneOut)) {
      throw new PanError(
        `${options.errorPrefix}: ${result.stderr || result.stdout || `inventory output missing for ${lane}`}`,
        { code: options.errorCode },
      )
    }

    let laneIdentities: TestIdentity[]

    try {
      laneIdentities = readInventoryFile(laneOut)
    } catch (error) {
      throw new PanError(
        `${options.errorPrefix}: ${error instanceof Error ? error.message : String(error)}`,
        { code: options.errorCode },
      )
    }

    if (result.status !== 0 && laneIdentities.length === 0) {
      throw new PanError(
        `${options.errorPrefix}: ${result.stderr || result.stdout || `inventory collection failed for ${lane}`}`,
        { code: options.errorCode },
      )
    }

    rmSync(laneOut, { force: true })

    for (const identity of laneIdentities) {
      merged.set(identityKey(identity), identity)
    }
  }

  if (!ranAny) {
    throw new PanError(
      'no compiled test files found for inventory collection',
      {
        code: options.errorCode,
      },
    )
  }

  const identities = [...merged.values()].sort((left, right) =>
    identityKey(left).localeCompare(identityKey(right)),
  )
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        schema_version: 1,
        recorded_at: new Date().toISOString(),
        identities,
      },
      null,
      2,
    )}\n`,
  )

  return identities
}

/**
 * Lists every test identity in the compiled test lanes of this checkout by
 * running each lane with the inventory reporter and no matching tests.
 * Writes the merged inventory file under the tune work directory. Throws
 * `TUNE_INVENTORY_FAILED` when collection fails or no compiled tests exist.
 */
export function collectCurrentInventory(root: string): TestIdentity[] {
  const out = path.join(root, TUNE_WORK_DIR, '.inventory-current.json')
  mkdirSync(path.dirname(out), { recursive: true })

  return runInventoryCollection({
    cwd: root,
    reporterRoot: root,
    out,
    errorPrefix: 'inventory collection failed',
    errorCode: 'TUNE_INVENTORY_FAILED',
  })
}

/**
 * Lists the test identities at a Git ref by checking it out in a temporary
 * detached worktree under the session's work directory, running `npm ci` and
 * a build there, and collecting its inventory. The worktree is always
 * removed. Throws `TUNE_BASELINE_BUILD_FAILED` when collection fails; a
 * failing checkout, install, or build throws its process error.
 */
export function collectBaselineInventory(
  root: string,
  baselineRef: string,
  sessionId: string,
): TestIdentity[] {
  const worktree = path.join(
    root,
    TUNE_WORK_DIR,
    sessionId,
    'baseline-worktree',
  )

  if (existsSync(worktree)) {
    rmSync(worktree, { recursive: true, force: true })
  }

  mkdirSync(path.dirname(worktree), { recursive: true })

  execFileSync('git', ['worktree', 'add', '--detach', worktree, baselineRef], {
    cwd: root,
    encoding: 'utf8',
  })

  try {
    execFileSync('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], {
      cwd: worktree,
      encoding: 'utf8',
      stdio: 'pipe',
    })
    execFileSync('npm', ['run', 'build'], {
      cwd: worktree,
      encoding: 'utf8',
      stdio: 'pipe',
    })

    const out = path.join(worktree, '.tune-inventory.json')
    const identities = runInventoryCollection({
      cwd: worktree,
      reporterRoot: root,
      out,
      errorPrefix: `baseline inventory failed at ${baselineRef}`,
      errorCode: 'TUNE_BASELINE_BUILD_FAILED',
    })

    return identities
  } finally {
    execFileSync('git', ['worktree', 'remove', '--force', worktree], {
      cwd: root,
      encoding: 'utf8',
    })
  }
}

export interface PrepareTuneSessionOptions {
  baselineRef?: string
}

export interface PreparedTuneSession {
  session_id: string
  work_dir: string
  current_inventory: TestIdentity[]
  retained_set: TestIdentity[]
  baseline_source: TuneRecord['baseline_source']
  prior_record: TuneRecord | null
}

/**
 * Starts a tune session: collects the current test inventory, picks the
 * retained set (from `baselineRef`, else the latest tune record, else the
 * current inventory), and writes the inventories and baseline source into a
 * new session work directory. Throws `TUNE_SELF_DEVELOPMENT_ONLY` or
 * `TUNE_GIT_REQUIRED`.
 */
export function prepareTuneSession(
  root: string,
  options: PrepareTuneSessionOptions = {},
): PreparedTuneSession {
  assertSelfDevelopment(root)

  if (!isGitRepository(root)) {
    throw new PanError('pan tune requires a Git repository.', {
      code: 'TUNE_GIT_REQUIRED',
    })
  }

  const sessionId = `tune-${Date.now()}`
  const workDir = tuneSessionWorkDir(root, sessionId)
  mkdirSync(workDir, { recursive: true })

  const current = collectCurrentInventory(root)
  const prior = loadLatestRecord(root)
  let retained: TestIdentity[]
  let baselineSource: TuneRecord['baseline_source']

  if (options.baselineRef) {
    retained = collectBaselineInventory(root, options.baselineRef, sessionId)
    baselineSource = { kind: 'baseline_ref', ref: options.baselineRef }
  } else if (prior) {
    retained = prior.retained_set
    baselineSource = {
      kind: 'prior_record',
      prior_session_id: prior.session_id,
    }
  } else {
    retained = current
    baselineSource = { kind: 'none' }
  }

  writeJsonAtomic(path.join(workDir, 'current-inventory.json'), {
    identities: current,
  })
  writeJsonAtomic(path.join(workDir, 'retained-set.json'), {
    identities: retained,
  })
  writeJsonAtomic(path.join(workDir, 'session-meta.json'), {
    baseline_source: baselineSource,
  })

  return {
    session_id: sessionId,
    work_dir: workDir,
    current_inventory: current,
    retained_set: retained,
    baseline_source: baselineSource,
    prior_record: prior,
  }
}

/**
 * Reloads a prepared tune session from its work directory, with the latest
 * tune record as the prior. Throws `TUNE_SESSION_NOT_FOUND` when its
 * inventory files are missing and `TUNE_INVENTORY_INVALID` when one is
 * malformed.
 */
export function loadPreparedSession(
  root: string,
  sessionId: string,
): PreparedTuneSession {
  const workDir = tuneSessionWorkDir(root, sessionId)
  const currentPath = path.join(workDir, 'current-inventory.json')
  const retainedPath = path.join(workDir, 'retained-set.json')

  if (!fileExists(currentPath) || !fileExists(retainedPath)) {
    throw new PanError(`missing prepared session ${sessionId}`, {
      code: 'TUNE_SESSION_NOT_FOUND',
    })
  }

  const current = readInventoryFile(currentPath)
  const retained = readInventoryFile(retainedPath)
  const metaPath = path.join(workDir, 'session-meta.json')
  const meta = fileExists(metaPath)
    ? (readJson(metaPath) as {
        baseline_source?: TuneRecord['baseline_source']
      })
    : null

  return {
    session_id: sessionId,
    work_dir: workDir,
    current_inventory: current,
    retained_set: retained,
    baseline_source: meta?.baseline_source ?? { kind: 'none' },
    prior_record: loadLatestRecord(root),
  }
}

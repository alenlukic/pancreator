import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import path from 'node:path'
import { errorMessage, invariant } from '../errors.js'
import { findProjectRoot, isRecord } from '../io.js'
import type { RunStatus } from '../types.js'
import { agentDirectory, isClosedRunStatus, listFiles } from './identity.js'
import {
  isContentAddressedArtifact,
  rewriteWorkflowArtifacts,
} from './layout.js'
import {
  migrationTargetRunId,
  updateFileCount,
  type RunMigration,
} from './run-ids.js'

export interface WorkflowNameMigrationSummary {
  run_directories: number
  state_directories: number
  artifact_files: number
  artifact_layout_files: number
  updated_files: number
  removed_invalid_directories: number
}

/** Durable runtime directories whose records can cite temporal names. */
const MUTABLE_RUNTIME_DIRECTORIES = [
  'inbox',
  'logs',
  'pr-descriptions',
  'release',
  'research',
  'tune-harness',
  'workflows',
] as const

/** Traversals of the mutable population since this module was loaded. */
let mutableRuntimeTraversals = 0

/**
 * How many times the mutable population has been walked.
 *
 * A maintenance invocation owes exactly one walk, and the count lives beside
 * the walk rather than beside the memo that shares it: a caller that recomputes
 * the population directly must be as visible as one that misses the memo.
 * Read it as a delta across the call under test.
 */
export function mutableRuntimeTraversalCount(): number {
  return mutableRuntimeTraversals
}

/** Runtime files that sit directly under `runtime/`, which no directory names. */
function runtimeRootFiles(runtimeRoot: string): string[] {
  if (!existsSync(runtimeRoot)) {
    return []
  }

  return readdirSync(runtimeRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(runtimeRoot, entry.name))
}

/**
 * Every runtime file that may be rewritten when a temporal name changes.
 *
 * The allowlist keeps scratch, cache, worktree, and future unknown directories
 * out by default. `release` and the files directly under `runtime/` are in it
 * because they carry durable run ids: an append-only audit row that kept a
 * retired id would outlive the run it names. Content-addressed evidence
 * remains immutable inside an otherwise mutable directory.
 */
export function mutableRuntimeFiles(runtimeRoot: string): string[] {
  mutableRuntimeTraversals += 1

  return [
    ...runtimeRootFiles(runtimeRoot),
    ...MUTABLE_RUNTIME_DIRECTORIES.flatMap((directory) =>
      listFiles(path.join(runtimeRoot, directory)),
    ),
  ].filter((filePath) => !isContentAddressedArtifact(filePath))
}

export interface RuntimeMutableFileSet {
  runtime_root: string
  paths: string[] | null
}

/**
 * Create a lazy index of the mutable runtime files under `runtimeRoot`. The
 * file list is built on first use and kept current as maintenance passes move
 * directories, so passes share one traversal.
 */
export function createRuntimeMutableFileSet(
  runtimeRoot: string,
): RuntimeMutableFileSet {
  return { runtime_root: runtimeRoot, paths: null }
}

/**
 * Return the index's mutable runtime file paths, building the list on first
 * call.
 */
export function runtimeMutablePaths(index: RuntimeMutableFileSet): string[] {
  index.paths ??= mutableRuntimeFiles(index.runtime_root)

  return index.paths
}

/**
 * Update an already-built index after a move: paths equal to `source` or under
 * it are rewritten to `target`. Does nothing when the index is absent or not
 * yet built.
 */
export function relocateRuntimeMutablePaths(
  index: RuntimeMutableFileSet | undefined,
  source: string,
  target: string,
): void {
  if (index?.paths === null || index === undefined) {
    return
  }

  const prefix = `${source}${path.sep}`

  index.paths = index.paths.map((filePath) =>
    filePath === source
      ? target
      : filePath.startsWith(prefix)
        ? path.join(target, path.relative(source, filePath))
        : filePath,
  )
}

function migratableDirectoryNames(root: string, directory: string): string[] {
  if (!existsSync(directory)) {
    return []
  }

  return readdirSync(directory)
    .filter((name) => {
      const absolute = path.join(directory, name)

      return (
        statSync(absolute).isDirectory() &&
        migrationTargetRunId(root, name) !== null
      )
    })
    .sort()
}

/**
 * Rename `parent/oldName` to `parent/newName` and update the mutable file
 * index. Does nothing when the names are equal; throws `PanError`
 * `MIGRATION_COLLISION` when the target exists.
 */
export function moveDirectory(
  parent: string,
  oldName: string,
  newName: string,
  mutableFileSet?: RuntimeMutableFileSet,
): void {
  if (oldName === newName) {
    return
  }

  const source = path.join(parent, oldName)
  const target = path.join(parent, newName)

  invariant(!existsSync(target), `Migration target already exists: ${target}`, {
    code: 'MIGRATION_COLLISION',
  })

  renameSync(source, target)
  relocateRuntimeMutablePaths(mutableFileSet, source, target)
}

/**
 * The run status, or the reason the state file could not supply one.
 *
 * A pass over many run directories meets state files a live run never has:
 * missing, truncated, or unparseable. Returning the reason lets that pass
 * skip the one bad record and finish the rest, while a caller that is
 * operating on one known-good run still raises.
 */
export function tryReadRunStatus(runDirectory: string): {
  status: RunStatus | null
  reason: string | null
} {
  const statePath = path.join(agentDirectory(runDirectory), 'state.json')
  let value: unknown

  try {
    value = JSON.parse(readFileSync(statePath, 'utf8'))
  } catch (error) {
    return { status: null, reason: errorMessage(error) }
  }

  if (!isRecord(value) || typeof value.status !== 'string') {
    return { status: null, reason: `${statePath} carries no run status.` }
  }

  return { status: value.status as RunStatus, reason: null }
}

function readRunStatus(runDirectory: string): RunStatus {
  const statePath = path.join(agentDirectory(runDirectory), 'state.json')
  const read = tryReadRunStatus(runDirectory)

  invariant(
    read.status !== null,
    `${statePath} MUST contain a run status: ${read.reason}`,
    { code: 'INVALID_WORKFLOW_MIGRATION' },
  )

  return read.status
}

function removeEmptyHelpDirectory(logRoot: string): number {
  const helpDirectory = path.join(logRoot, '--help')

  if (!existsSync(helpDirectory)) {
    return 0
  }

  invariant(
    readdirSync(helpDirectory).length === 0,
    `${helpDirectory} is not empty and MUST be reviewed manually.`,
    { code: 'INVALID_RUNTIME_DIRECTORY' },
  )

  rmSync(helpDirectory, { recursive: true })

  return 1
}

/**
 * Migrate legacy run directory names under `runtime/logs/workflows` and
 * `runtime/workflows` to current temporal run ids: rewrite references in
 * mutable runtime files, rename the directories, and renumber each run's
 * artifacts for its status. Also removes an empty stray `--help` log directory.
 * Throws `PanError` `MIGRATION_COLLISION`, `INVALID_WORKFLOW_MIGRATION`, or
 * `INVALID_RUNTIME_DIRECTORY` when a non-empty `--help` directory needs manual
 * review.
 */
export function migrateWorkflowNames(
  root = findProjectRoot(),
  mutableFileSet = createRuntimeMutableFileSet(path.join(root, 'runtime')),
): WorkflowNameMigrationSummary {
  const runtimeRoot = path.join(root, 'runtime')
  const logRoot = path.join(runtimeRoot, 'logs', 'workflows')
  const stateRoot = path.join(runtimeRoot, 'workflows')
  const migrations = new Map<string, RunMigration>()

  for (const sourceRunId of new Set([
    ...migratableDirectoryNames(root, logRoot),
    ...migratableDirectoryNames(root, stateRoot),
  ])) {
    const targetRunId = migrationTargetRunId(root, sourceRunId)

    invariant(targetRunId, `Invalid workflow directory: ${sourceRunId}`, {
      code: 'INVALID_WORKFLOW_MIGRATION',
    })
    migrations.set(sourceRunId, { sourceRunId, targetRunId })
  }

  const runIdMappings = new Map<string, string>()

  for (const migration of migrations.values()) {
    if (migration.sourceRunId !== migration.targetRunId) {
      runIdMappings.set(migration.sourceRunId, migration.targetRunId)
    }
  }

  // Content-addressed artifacts are excluded for the same digest-integrity
  // reason documented in rewriteWorkflowArtifacts.
  let updatedFiles = updateFileCount(
    runtimeMutablePaths(mutableFileSet),
    runIdMappings,
  )
  let runDirectories = 0
  let stateDirectories = 0

  for (const migration of migrations.values()) {
    if (
      migration.sourceRunId !== migration.targetRunId &&
      existsSync(path.join(logRoot, migration.sourceRunId))
    ) {
      moveDirectory(
        logRoot,
        migration.sourceRunId,
        migration.targetRunId,
        mutableFileSet,
      )
      runDirectories += 1
    }

    if (
      migration.sourceRunId !== migration.targetRunId &&
      existsSync(path.join(stateRoot, migration.sourceRunId))
    ) {
      moveDirectory(
        stateRoot,
        migration.sourceRunId,
        migration.targetRunId,
        mutableFileSet,
      )
      stateDirectories += 1
    }
  }

  let artifactFiles = 0
  let artifactLayoutFiles = 0

  for (const targetRunId of new Set(
    [...migrations.values()].map((migration) => migration.targetRunId),
  )) {
    const runDirectory = path.join(logRoot, targetRunId)

    if (!existsSync(runDirectory)) {
      continue
    }

    const status = readRunStatus(runDirectory)
    const summary = rewriteWorkflowArtifacts(
      root,
      targetRunId,
      isClosedRunStatus(status) ? 'completed' : 'in-flight',
    )

    artifactFiles += summary.artifact_files
    artifactLayoutFiles += summary.layout_files
    updatedFiles += summary.updated_files
  }

  return {
    run_directories: runDirectories,
    state_directories: stateDirectories,
    artifact_files: artifactFiles,
    artifact_layout_files: artifactLayoutFiles,
    updated_files: updatedFiles,
    removed_invalid_directories: removeEmptyHelpDirectory(logRoot),
  }
}

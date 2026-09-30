import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { invariant } from '../errors.js'
import { findProjectRoot, isRecord } from '../io.js'
import { unresolvedObservationHold } from '../observations.js'
import { resolveRetentionDays } from '../project-config.js'
import { isClosedRunStatus, listFiles, parseJsonFile } from './identity.js'
import { activeWorkflowDirectoryNames } from './inbox-references.js'
import {
  createRuntimeMutableFileSet,
  relocateRuntimeMutablePaths,
  runtimeMutablePaths,
  tryReadRunStatus,
  type RuntimeMutableFileSet,
} from './mutable-files.js'
import {
  currentRunDate,
  MILLISECONDS_PER_DAY,
  policyMandatedFileDate,
  runCreatedAt,
  temporalFileDate,
  updateFileCount,
  validDate,
} from './run-ids.js'
import { TEMPORAL_FILE_DIRECTORIES } from './temporal-names.js'

export interface WorkflowArchiveSummary {
  retention_days: number
  cutoff: string
  run_directories: number
  state_directories: number
  /** Standalone-mode session directories archived under the same retention. */
  session_directories: number
  /** Best-of-N session directories archived under the same retention. */
  best_of_n_directories: number
  updated_files: number
  run_ids: string[]
  session_ids: string[]
  bon_ids: string[]
  /** Archived temporal inbox file names. */
  inbox_files: string[]
  /** Archived PR-description file names. */
  pr_description_files: string[]
  /** Runs whose worker-authored helper scripts this pass removed. */
  swept_script_run_ids: string[]
  /**
   * Aged closed runs this pass kept live because they still owe an
   * unresolved post-ship observation.
   */
  observation_held_run_ids: string[]
}

export interface InboxArchiveSelection {
  complete: boolean
  canceled: boolean
}

function bestOfNCreatedAt(directory: string): Date | null {
  const statePath = path.join(directory, 'state.json')

  if (!existsSync(statePath)) {
    return null
  }

  const state = parseJsonFile(statePath)

  return isRecord(state) ? validDate(state.created_at) : null
}

function archiveDirectory(
  parent: string,
  runId: string,
  mutableFileSet?: RuntimeMutableFileSet,
): void {
  const source = path.join(parent, runId)

  if (!existsSync(source)) {
    return
  }

  const archiveRoot = path.join(parent, 'archive')
  const target = path.join(archiveRoot, runId)

  invariant(!existsSync(target), `Archive target already exists: ${target}`, {
    code: 'ARCHIVE_COLLISION',
  })
  mkdirSync(archiveRoot, { recursive: true })
  renameSync(source, target)
  relocateRuntimeMutablePaths(mutableFileSet, source, target)
}

/**
 * Remove the worker-authored helper scripts of one run (`RUNTIME-001`).
 *
 * `AUTO-001` lets a worker write a task-specific script under the run's own
 * `scripts/` directory for that run alone. Those scripts are run evidence
 * while the run is still being read, so finalization keeps them: it fires the
 * moment a run closes, which is exactly when an operator is reading the
 * record. Retention is the later boundary that can take them, and it is the
 * one boundary that already decides a run has aged out.
 *
 * Returns true when a tree was removed, so the pass can report which runs it
 * swept rather than leave the deletion silent.
 */
function sweepRunLocalScripts(runDirectory: string): boolean {
  const scripts = path.join(runDirectory, 'scripts')

  if (!existsSync(scripts)) {
    return false
  }

  rmSync(scripts, { recursive: true, force: true })

  return true
}

export function archiveWorkflowDirectories(
  root = findProjectRoot(),
  options: {
    retentionDays?: number
    now?: Date
    inboxArchive?: InboxArchiveSelection
    mutableFileSet?: RuntimeMutableFileSet
  } = {},
): WorkflowArchiveSummary {
  const retentionDays =
    options.retentionDays ?? resolveRetentionDays(root, 'workflow-runs')
  const now = options.now ?? new Date()
  const mutableFileSet =
    options.mutableFileSet ??
    createRuntimeMutableFileSet(path.join(root, 'runtime'))
  const inboxArchive = options.inboxArchive ?? {
    complete: true,
    canceled: false,
  }

  invariant(
    Number.isInteger(retentionDays) && retentionDays >= 1,
    'Workflow retention days MUST be a positive integer.',
    { code: 'INVALID_RETENTION_DAYS' },
  )
  invariant(Number.isFinite(now.getTime()), 'Archive time MUST be valid.', {
    code: 'INVALID_ARCHIVE_TIME',
  })

  const cutoff = new Date(now.getTime() - retentionDays * MILLISECONDS_PER_DAY)
  const logRoot = path.join(root, 'runtime', 'logs', 'workflows')
  const stateRoot = path.join(root, 'runtime', 'workflows')
  const holdsObservation = unresolvedObservationHold(root)
  const observationHeldRunIds: string[] = []
  const runIds = [
    ...new Set([
      ...activeWorkflowDirectoryNames(logRoot),
      ...activeWorkflowDirectoryNames(stateRoot),
    ]),
  ].filter((runId) => {
    const runDirectory = path.join(logRoot, runId)

    if (existsSync(runDirectory)) {
      const runStatus = tryReadRunStatus(runDirectory)

      if (runStatus.status && !isClosedRunStatus(runStatus.status)) {
        return false
      }
    }

    const createdAt = runCreatedAt(root, runId) ?? currentRunDate(runId)

    invariant(
      createdAt,
      `Could not determine workflow creation time: ${runId}`,
      {
        code: 'INVALID_WORKFLOW_ARCHIVE',
      },
    )

    if (createdAt.getTime() >= cutoff.getTime()) {
      return false
    }

    // `pan observations` reads only live runs, so archiving a run that still
    // owes an observation would drop the item before an audit resolves it.
    if (holdsObservation(runId)) {
      observationHeldRunIds.push(runId)
      return false
    }

    return true
  })

  let updatedFiles = 0
  let runDirectories = 0
  let stateDirectories = 0
  const sweptScriptRunIds: string[] = []

  for (const runId of runIds) {
    const logDirectory = path.join(logRoot, runId)
    const stateDirectory = path.join(stateRoot, runId)

    if (sweepRunLocalScripts(logDirectory)) {
      sweptScriptRunIds.push(runId)
    }

    const mappings = new Map<string, string>([
      [
        `runtime/logs/workflows/${runId}`,
        `runtime/logs/workflows/archive/${runId}`,
      ],
      [`runtime/workflows/${runId}`, `runtime/workflows/archive/${runId}`],
    ])

    updatedFiles += updateFileCount(
      [...listFiles(logDirectory), ...listFiles(stateDirectory)],
      mappings,
    )

    if (existsSync(logDirectory)) {
      archiveDirectory(logRoot, runId, mutableFileSet)
      runDirectories += 1
    }

    if (existsSync(stateDirectory)) {
      archiveDirectory(stateRoot, runId, mutableFileSet)
      stateDirectories += 1
    }
  }

  // Standalone-mode governance cards live outside the workflow tree but are
  // just as disposable, so RUNTIME-001 retention has to reach them too or they
  // accumulate for the life of the installation.
  const sessionRoot = path.join(root, 'runtime', 'logs', 'sessions')
  const sessionIds = activeWorkflowDirectoryNames(sessionRoot).filter(
    (sessionId) => {
      const createdAt = currentRunDate(sessionId)

      return createdAt !== null && createdAt.getTime() < cutoff.getTime()
    },
  )
  let sessionDirectories = 0

  for (const sessionId of sessionIds) {
    const sessionDirectory = path.join(sessionRoot, sessionId)

    updatedFiles += updateFileCount(
      listFiles(sessionDirectory),
      new Map([
        [
          `runtime/logs/sessions/${sessionId}`,
          `runtime/logs/sessions/archive/${sessionId}`,
        ],
      ]),
    )
    archiveDirectory(sessionRoot, sessionId, mutableFileSet)
    sessionDirectories += 1
  }

  // Best-of-N sessions age out like workflow runs; their creation time comes
  // from session state, falling back to the temporal prefix.
  const bonRoot = path.join(root, 'runtime', 'logs', 'best-of-n')
  const bonIds = activeWorkflowDirectoryNames(bonRoot).filter((bonId) => {
    const createdAt =
      bestOfNCreatedAt(path.join(bonRoot, bonId)) ?? currentRunDate(bonId)

    invariant(
      createdAt,
      `Could not determine best-of-N creation time: ${bonId}`,
      { code: 'INVALID_WORKFLOW_ARCHIVE' },
    )

    return createdAt.getTime() < cutoff.getTime()
  })
  let bonDirectories = 0

  for (const bonId of bonIds) {
    updatedFiles += updateFileCount(
      listFiles(path.join(bonRoot, bonId)),
      new Map([
        [
          `runtime/logs/best-of-n/${bonId}`,
          `runtime/logs/best-of-n/archive/${bonId}`,
        ],
      ]),
    )
    archiveDirectory(bonRoot, bonId, mutableFileSet)
    bonDirectories += 1
  }

  // Inbox requests and PR descriptions are copied into run directories when
  // consumed, so the originals age out on the same retention window. Their
  // standardized temporal prefix is the age authority, except for the
  // policy-mandated names standardization leaves alone.
  const archivedFiles = new Map<string, string[]>()
  const fileMappings = new Map<string, string>()
  const inboxArchivedNames: string[] = []

  const inboxStatuses: Array<'complete' | 'canceled'> = []

  if (inboxArchive.complete) {
    inboxStatuses.push('complete')
  }

  if (inboxArchive.canceled) {
    inboxStatuses.push('canceled')
  }

  for (const status of inboxStatuses) {
    const parentRelative = path.join('runtime', 'inbox', status)
    const parent = path.join(root, parentRelative)

    if (!existsSync(parent)) {
      continue
    }

    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue
      }

      // A policy-mandated name keeps itself, so the UTC timestamp inside it is
      // the only age authority it has.
      const createdAt =
        temporalFileDate(entry.name) ?? policyMandatedFileDate(entry.name)

      if (!createdAt || createdAt.getTime() >= cutoff.getTime()) {
        continue
      }

      const archiveRoot = path.join(root, 'runtime', 'inbox', 'archive')
      const target = path.join(archiveRoot, entry.name)

      invariant(
        !existsSync(target),
        `Archive target already exists: ${target}`,
        { code: 'ARCHIVE_COLLISION' },
      )
      mkdirSync(archiveRoot, { recursive: true })
      const source = path.join(parent, entry.name)

      renameSync(source, target)
      relocateRuntimeMutablePaths(mutableFileSet, source, target)
      fileMappings.set(
        `${parentRelative}/${entry.name}`,
        `runtime/inbox/archive/${entry.name}`,
      )
      inboxArchivedNames.push(entry.name)
    }
  }

  archivedFiles.set('runtime/inbox', inboxArchivedNames)

  for (const parentRelative of TEMPORAL_FILE_DIRECTORIES) {
    const parent = path.join(root, parentRelative)
    const names: string[] = []

    archivedFiles.set(parentRelative, names)

    if (!existsSync(parent)) {
      continue
    }

    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue
      }

      const createdAt = temporalFileDate(entry.name)

      if (!createdAt || createdAt.getTime() >= cutoff.getTime()) {
        continue
      }

      const archiveRoot = path.join(parent, 'archive')
      const target = path.join(archiveRoot, entry.name)

      invariant(
        !existsSync(target),
        `Archive target already exists: ${target}`,
        { code: 'ARCHIVE_COLLISION' },
      )
      mkdirSync(archiveRoot, { recursive: true })
      const source = path.join(parent, entry.name)

      renameSync(source, target)
      relocateRuntimeMutablePaths(mutableFileSet, source, target)
      fileMappings.set(
        `${parentRelative}/${entry.name}`,
        `${parentRelative}/archive/${entry.name}`,
      )
      names.push(entry.name)
    }
  }

  if (fileMappings.size > 0) {
    updatedFiles += updateFileCount(
      runtimeMutablePaths(mutableFileSet),
      fileMappings,
    )
  }

  return {
    retention_days: retentionDays,
    cutoff: cutoff.toISOString(),
    run_directories: runDirectories,
    state_directories: stateDirectories,
    session_directories: sessionDirectories,
    best_of_n_directories: bonDirectories,
    updated_files: updatedFiles,
    run_ids: runIds,
    session_ids: sessionIds,
    bon_ids: bonIds,
    inbox_files: archivedFiles.get('runtime/inbox') ?? [],
    pr_description_files: archivedFiles.get('runtime/pr-descriptions') ?? [],
    swept_script_run_ids: sweptScriptRunIds,
    observation_held_run_ids: observationHeldRunIds,
  }
}

import path from 'node:path'
import {
  migrateLegacyInboxLayout,
  type InboxLegacyMigrationSummary,
} from '../inbox.js'
import { findProjectRoot } from '../io.js'
import {
  archiveWorkflowDirectories,
  type InboxArchiveSelection,
  type WorkflowArchiveSummary,
} from './archive.js'
import {
  repairWorkflowInboxReferences,
  type WorkflowReferenceRepairSummary,
} from './inbox-references.js'
import {
  createRuntimeMutableFileSet,
  migrateWorkflowNames,
  relocateRuntimeMutablePaths,
  runtimeMutablePaths,
  type RuntimeMutableFileSet,
  type WorkflowNameMigrationSummary,
} from './mutable-files.js'
import { migrateRunSuffixes } from './run-suffixes.js'
import {
  standardizeRuntimeFileNames,
  type RunSuffixMigrationSummary,
  type RuntimeNameStandardizationSummary,
} from './temporal-names.js'

export interface WorkflowRuntimeMaintenanceSummary {
  names: RuntimeNameStandardizationSummary
  migration: WorkflowNameMigrationSummary
  suffixes: RunSuffixMigrationSummary
  inbox_layout: InboxLegacyMigrationSummary
  references: WorkflowReferenceRepairSummary
  archive: WorkflowArchiveSummary
}

export type WorkflowRuntimeMaintenancePass =
  | 'inbox_layout'
  | 'names'
  | 'migration'
  | 'suffixes'
  | 'references'
  | 'archive'

export interface WorkflowRuntimeMaintenanceProgress {
  pass: WorkflowRuntimeMaintenancePass
  phase: 'started' | 'finished'
  file_count: number
}

/**
 * Run every runtime maintenance pass in order and return their summaries:
 * migrate the legacy inbox layout, standardize temporal file names, migrate
 * workflow run names and suffixes, repair inbox references, then archive
 * records past retention. Moves and rewrites runtime files; `onProgress`
 * receives the start and finish of each pass.
 */
export function maintainWorkflowRuntime(
  root = findProjectRoot(),
  options: {
    retentionDays?: number
    now?: Date
    inboxArchive?: InboxArchiveSelection
    mutableFileSet?: RuntimeMutableFileSet
    onProgress?: (progress: WorkflowRuntimeMaintenanceProgress) => void
  } = {},
): WorkflowRuntimeMaintenanceSummary {
  const mutableFileSet =
    options.mutableFileSet ??
    createRuntimeMutableFileSet(path.join(root, 'runtime'))
  const fileCount = runtimeMutablePaths(mutableFileSet).length
  const progress = (
    pass: WorkflowRuntimeMaintenancePass,
    phase: WorkflowRuntimeMaintenanceProgress['phase'],
  ): void =>
    options.onProgress?.({
      pass,
      phase,
      file_count: fileCount,
    })

  progress('inbox_layout', 'started')
  const inboxLayout = migrateLegacyInboxLayout(root, (source, target) =>
    relocateRuntimeMutablePaths(mutableFileSet, source, target),
  )
  progress('inbox_layout', 'finished')

  progress('names', 'started')
  const names = standardizeRuntimeFileNames(root, mutableFileSet)
  progress('names', 'finished')

  progress('migration', 'started')
  const migration = migrateWorkflowNames(root, mutableFileSet)
  progress('migration', 'finished')

  progress('suffixes', 'started')
  const suffixes = migrateRunSuffixes(root, mutableFileSet)
  progress('suffixes', 'finished')

  progress('references', 'started')
  const references = repairWorkflowInboxReferences(root)
  progress('references', 'finished')

  progress('archive', 'started')
  const archive = archiveWorkflowDirectories(root, {
    ...(options.retentionDays !== undefined
      ? { retentionDays: options.retentionDays }
      : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.inboxArchive !== undefined
      ? { inboxArchive: options.inboxArchive }
      : {}),
    mutableFileSet,
  })
  progress('archive', 'finished')

  return {
    names,
    migration,
    suffixes,
    inbox_layout: inboxLayout,
    references,
    archive,
  }
}

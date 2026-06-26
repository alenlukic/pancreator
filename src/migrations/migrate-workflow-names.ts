import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { invariant } from '../lib/errors.js'
import { findProjectRoot, isRecord } from '../lib/io.js'
import { makeWorkflowRunId } from '../lib/naming.js'
import {
  isClosedRunStatus,
  rewriteWorkflowArtifacts,
} from '../lib/workflow-artifacts.js'
import type { RunStatus } from '../lib/types.js'

const LEGACY_RUN_ID_PATTERN =
  /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z-([0-9a-f]{8})$/u
const CURRENT_RUN_ID_PATTERN = /^\d+_[A-Z][a-z]{2}-\d{2}_[0-9a-f]{8}$/u

export interface WorkflowNameMigrationSummary {
  run_directories: number
  state_directories: number
  artifact_files: number
  artifact_layout_files: number
  updated_files: number
  removed_invalid_directories: number
}

interface RunMigration {
  sourceRunId: string
  targetRunId: string
}

function legacyRunDate(
  runId: string,
): { date: Date; uuidSuffix: string } | null {
  const match = LEGACY_RUN_ID_PATTERN.exec(runId)

  if (!match) {
    return null
  }

  const date = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
      Number(match[7]),
    ),
  )

  return { date, uuidSuffix: match[8] }
}

export function migratedRunId(runId: string): string | null {
  const legacy = legacyRunDate(runId)

  return legacy ? makeWorkflowRunId(legacy.date, legacy.uuidSuffix) : null
}

function migrationTargetRunId(runId: string): string | null {
  const migrated = migratedRunId(runId)

  if (migrated) {
    return migrated
  }

  return CURRENT_RUN_ID_PATTERN.test(runId) ? runId : null
}

function listFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return []
  }

  const files: string[] = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...listFiles(absolute))
    } else if (entry.isFile()) {
      files.push(absolute)
    }
  }

  return files
}

function textFileContent(filePath: string): string | null {
  const content = readFileSync(filePath)

  return content.includes(0) ? null : content.toString('utf8')
}

function replaceMappings(
  content: string,
  mappings: ReadonlyMap<string, string>,
): string {
  let updated = content
  const replacements = [...mappings.entries()]
    .filter(([oldValue, newValue]) => oldValue !== newValue)
    .sort(([left], [right]) => right.length - left.length)
  const placeholders = replacements.map(
    (_, index) => `\u0000PANCREATOR_MAPPING_${index}\u0000`,
  )

  replacements.forEach(([oldValue], index) => {
    updated = updated.replaceAll(oldValue, placeholders[index])
  })
  replacements.forEach(([, newValue], index) => {
    updated = updated.replaceAll(placeholders[index], newValue)
  })

  return updated
}

function updateFiles(
  files: string[],
  mappings: ReadonlyMap<string, string>,
): number {
  let updatedFiles = 0

  for (const filePath of files) {
    const content = textFileContent(filePath)

    if (content === null) {
      continue
    }

    const updated = replaceMappings(content, mappings)

    if (updated !== content) {
      writeFileSync(filePath, updated, 'utf8')
      updatedFiles += 1
    }
  }

  return updatedFiles
}

function migratableDirectoryNames(directory: string): string[] {
  if (!existsSync(directory)) {
    return []
  }

  return readdirSync(directory)
    .filter((name) => {
      const absolute = path.join(directory, name)

      return (
        statSync(absolute).isDirectory() && migrationTargetRunId(name) !== null
      )
    })
    .sort()
}

function moveDirectory(parent: string, oldName: string, newName: string): void {
  if (oldName === newName) {
    return
  }

  const source = path.join(parent, oldName)
  const target = path.join(parent, newName)

  invariant(!existsSync(target), `Migration target already exists: ${target}`, {
    code: 'MIGRATION_COLLISION',
  })

  renameSync(source, target)
}

function readRunStatus(runDirectory: string): RunStatus {
  const statePath = path.join(runDirectory, 'state.json')
  const value: unknown = JSON.parse(readFileSync(statePath, 'utf8'))

  invariant(
    isRecord(value) && typeof value.status === 'string',
    `${statePath} MUST contain a run status.`,
    { code: 'INVALID_WORKFLOW_MIGRATION' },
  )

  return value.status as RunStatus
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

export function migrateWorkflowNames(
  root = findProjectRoot(),
): WorkflowNameMigrationSummary {
  const runtimeRoot = path.join(root, 'runtime')
  const logRoot = path.join(runtimeRoot, 'logs', 'workflows')
  const stateRoot = path.join(runtimeRoot, 'workflows')
  const migrations = new Map<string, RunMigration>()

  for (const sourceRunId of new Set([
    ...migratableDirectoryNames(logRoot),
    ...migratableDirectoryNames(stateRoot),
  ])) {
    const targetRunId = migrationTargetRunId(sourceRunId)

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

  let updatedFiles = updateFiles(listFiles(runtimeRoot), runIdMappings)
  let runDirectories = 0
  let stateDirectories = 0

  for (const migration of migrations.values()) {
    if (
      migration.sourceRunId !== migration.targetRunId &&
      existsSync(path.join(logRoot, migration.sourceRunId))
    ) {
      moveDirectory(logRoot, migration.sourceRunId, migration.targetRunId)
      runDirectories += 1
    }

    if (
      migration.sourceRunId !== migration.targetRunId &&
      existsSync(path.join(stateRoot, migration.sourceRunId))
    ) {
      moveDirectory(stateRoot, migration.sourceRunId, migration.targetRunId)
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

const directEntry = process.argv[1]

if (directEntry && import.meta.url === pathToFileURL(directEntry).href) {
  const root = process.argv[2]
    ? path.resolve(process.argv[2])
    : findProjectRoot()
  const summary = migrateWorkflowNames(root)

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

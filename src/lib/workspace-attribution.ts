/**
 * The attribution store and the one definition of uncommitted work.
 *
 * Every clean-tree gate used to reduce "uncommitted work" to a non-empty
 * `git status`, which ignored the harness's own records: a path the operator
 * directed the supervisor to place, and that `pan attribute` recorded as a
 * read-only input, blocked integration exactly as unfinished work did. A gate
 * now reads the records, so an untracked path the operator declared a
 * read-only input is clean state by construction.
 */
import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { invariant } from './errors.js'
import { gitCommonDir, gitDirtyEntries, gitWorktreeIsDirty } from './git.js'
import {
  fileExists,
  readJson,
  isRecord,
  toRepoRelative,
  withOperationMutex,
  writeJsonAtomic,
} from './io.js'
import { now } from './state.js'
import type {
  DirtyWorkspacePath,
  WorkspaceAttributionDisposition,
  WorkspaceAttributionRecord,
  WorkspaceAttributionStore,
  WorkspaceCleanliness,
} from './types.js'

/** Every value `pan attribute --disposition` accepts, in declaration order. */
export const WORKSPACE_ATTRIBUTION_DISPOSITIONS: readonly WorkspaceAttributionDisposition[] =
  ['read-only-input', 'commit-with-unit', 'operator-owned']

/**
 * The disposition a record resolves to when it states none. Records written
 * before the field existed, and every `pan attribute` without
 * `--disposition`, land here, so no refusal that fires today stops firing.
 */
export const DEFAULT_WORKSPACE_ATTRIBUTION_DISPOSITION: WorkspaceAttributionDisposition =
  'operator-owned'

const STORE_RELATIVE_PATH = 'runtime/logs/workspace-attributions.json'

export function isWorkspaceAttributionDisposition(
  value: unknown,
): value is WorkspaceAttributionDisposition {
  return WORKSPACE_ATTRIBUTION_DISPOSITIONS.includes(
    value as WorkspaceAttributionDisposition,
  )
}

function storePath(root: string): string {
  return path.join(root, STORE_RELATIVE_PATH)
}

function storeMutexPath(root: string): string {
  return path.join(
    root,
    'runtime',
    'logs',
    '.workspace-attributions-operation-mutex',
  )
}

/**
 * The store as it stands, or an empty store when nothing recorded yet.
 *
 * A malformed store reads as empty rather than failing every gate that reads
 * it: the file is generated runtime state, and an unreadable record can only
 * withhold an exemption, never grant one.
 */
function readStore(root: string): WorkspaceAttributionStore {
  const absolute = storePath(root)

  if (!fileExists(absolute)) {
    return { schema_version: 1, records: [] }
  }

  let value: unknown

  try {
    value = readJson(absolute)
  } catch {
    return { schema_version: 1, records: [] }
  }

  if (!isRecord(value) || !Array.isArray(value.records)) {
    return { schema_version: 1, records: [] }
  }

  return {
    schema_version: 1,
    records: value.records.filter(
      (entry): entry is WorkspaceAttributionRecord =>
        isAttributionRecord(entry),
    ),
  }
}

function isAttributionRecord(
  value: unknown,
): value is WorkspaceAttributionRecord {
  return (
    isRecord(value) &&
    typeof value.attribution_id === 'string' &&
    typeof value.repository_key === 'string' &&
    Array.isArray(value.paths) &&
    value.paths.every((entry) => typeof entry === 'string')
  )
}

/**
 * The disposition one record carries. A record written before the field
 * existed, or one whose value the store no longer recognizes, resolves to the
 * default, which exempts nothing.
 */
export function workspaceAttributionDisposition(
  record: WorkspaceAttributionRecord,
): WorkspaceAttributionDisposition {
  return isWorkspaceAttributionDisposition(record.disposition)
    ? record.disposition
    : DEFAULT_WORKSPACE_ATTRIBUTION_DISPOSITION
}

export interface RecordWorkspaceAttributionInput {
  workspacePath: string
  runId: string
  actingRole: WorkspaceAttributionRecord['acting_role']
  directive: string
  disposition: WorkspaceAttributionDisposition
  paths: string[]
  artifactPath: string
}

/** Append one attribution record for the repository that holds `workspacePath`. */
export function recordWorkspaceAttribution(
  root: string,
  input: RecordWorkspaceAttributionInput,
): WorkspaceAttributionRecord {
  const record: WorkspaceAttributionRecord = {
    attribution_id: `attribution-${randomUUID()}`,
    repository_key: gitCommonDir(input.workspacePath),
    recorded_in: path.resolve(input.workspacePath),
    run_id: input.runId,
    acting_role: input.actingRole,
    directive: input.directive,
    disposition: input.disposition,
    paths: [...new Set(input.paths)].sort(),
    artifact_path: input.artifactPath,
    recorded_at: now(),
  }

  return withOperationMutex(storeMutexPath(root), () => {
    const store = readStore(root)

    writeJsonAtomic(storePath(root), {
      schema_version: 1,
      records: [...store.records, record],
    })

    return record
  })
}

/**
 * Every record recorded against the repository that holds `workspacePath`.
 *
 * The repository key rather than the workspace path is the match, so one
 * record reaches the main checkout, every linked worktree, and a worktree the
 * harness creates afterwards, and reaches no other repository.
 */
export function workspaceAttributions(
  root: string,
  workspacePath: string,
): WorkspaceAttributionRecord[] {
  let repositoryKey: string

  try {
    repositoryKey = gitCommonDir(workspacePath)
  } catch {
    return []
  }

  return readStore(root).records.filter(
    (record) => record.repository_key === repositoryKey,
  )
}

/**
 * The newest record naming each path. Two records may cover one path when the
 * operator re-attributes it, and the later directive is the current one.
 */
function attributionByPath(
  records: WorkspaceAttributionRecord[],
): Map<string, WorkspaceAttributionRecord> {
  const newest = new Map<string, WorkspaceAttributionRecord>()

  for (const record of records) {
    for (const relativePath of record.paths) {
      const held = newest.get(relativePath)

      if (!held || held.recorded_at <= record.recorded_at) {
        newest.set(relativePath, record)
      }
    }
  }

  return newest
}

/** Repository-relative display path, or the absolute path when it sits outside. */
function displayWorkspace(root: string, workspacePath: string): string {
  try {
    return toRepoRelative(root, workspacePath)
  } catch {
    return path.resolve(workspacePath)
  }
}

/**
 * Whether a workspace holds work that blocks, reading the attribution records.
 *
 * A dirty entry is exempt only when it is untracked and a `read-only-input`
 * record names it. A tracked modification is never exempt, whatever a record
 * says, because the operator declared the path an input rather than a file
 * the repository does not track.
 *
 * `gitWorktreeIsDirty` decides dirtiness rather than the entry list, because
 * a status read that fails yields no entries and must not read as clean. That
 * case reports the workspace itself as the blocking path.
 */
export function workspaceCleanliness(
  root: string,
  workspacePath: string,
): WorkspaceCleanliness {
  const workspace = displayWorkspace(root, workspacePath)

  if (!gitWorktreeIsDirty(workspacePath)) {
    return { workspace, clean: true, blocking: [], exempt: [] }
  }

  const attributions = attributionByPath(
    workspaceAttributions(root, workspacePath),
  )
  const entries = gitDirtyEntries(workspacePath)
  const blocking: DirtyWorkspacePath[] = []
  const exempt: DirtyWorkspacePath[] = []

  for (const entry of entries) {
    const attribution = attributions.get(entry.path) ?? null
    const dirtyPath: DirtyWorkspacePath = {
      path: entry.path,
      tracked: entry.tracked,
      attribution,
    }

    if (
      !entry.tracked &&
      attribution &&
      workspaceAttributionDisposition(attribution) === 'read-only-input'
    ) {
      exempt.push(dirtyPath)
      continue
    }

    blocking.push(dirtyPath)
  }

  if (entries.length === 0) {
    blocking.push({ path: workspace, tracked: true, attribution: null })
  }

  return { workspace, clean: blocking.length === 0, blocking, exempt }
}

export interface CommittablePaths {
  committable: string[]
  /** Paths a `read-only-input` record keeps out of every harness commit. */
  withheld: string[]
}

/**
 * Split candidate paths into the ones a harness commit may stage and the ones
 * an operator declared a read-only input, which no harness commit carries.
 */
export function committablePaths(
  root: string,
  workspacePath: string,
  paths: string[],
): CommittablePaths {
  const attributions = attributionByPath(
    workspaceAttributions(root, workspacePath),
  )
  const committable: string[] = []
  const withheld: string[] = []

  for (const relativePath of paths) {
    const attribution = attributions.get(relativePath)

    if (
      attribution &&
      workspaceAttributionDisposition(attribution) === 'read-only-input'
    ) {
      withheld.push(relativePath)
      continue
    }

    committable.push(relativePath)
  }

  return { committable, withheld }
}

/** How one blocking path reads in a refusal. */
function blockingPathLine(entry: DirtyWorkspacePath): string {
  if (!entry.attribution) {
    return `- \`${entry.path}\` — no attribution record`
  }

  const disposition = workspaceAttributionDisposition(entry.attribution)

  if (disposition === 'commit-with-unit') {
    return `- \`${entry.path}\` — attributed, commit it with the unit`
  }

  if (disposition === 'read-only-input') {
    // Only a tracked modification reaches here, because an untracked
    // read-only input is exempt. The operator declared the path an input, so
    // the tracked edit is the surprise worth naming.
    return (
      `- \`${entry.path}\` — recorded as a read-only input but tracked and ` +
      `modified, so the edit is not exempt (evidence: ` +
      `\`${entry.attribution.artifact_path}\`)`
    )
  }

  return (
    `- \`${entry.path}\` — operator-owned: "${entry.attribution.directive}" ` +
    `(evidence: \`${entry.attribution.artifact_path}\`); the operator owns ` +
    'its disposition'
  )
}

export interface CleanTreeRefusalOptions {
  /** What cannot happen, such as "Chunk 'api' cannot be integrated". */
  action: string
  /** What resolves it, such as the command to run once the paths are gone. */
  remedy: string
}

/**
 * The shared clean-tree refusal.
 *
 * Every gate names each blocking path with its attribution status, so the
 * operator can tell an operator task from a harness defect without reading
 * run state. A path the harness attributed never reads as a bare "commit it".
 */
export function cleanTreeRefusal(
  report: WorkspaceCleanliness,
  options: CleanTreeRefusalOptions,
): string {
  invariant(
    report.blocking.length > 0,
    'A clean-tree refusal requires at least one blocking path.',
    { code: 'INVALID_CLEANLINESS_REPORT' },
  )

  return [
    `${options.action}: ${report.workspace} holds uncommitted work.`,
    ...report.blocking.map((entry) => blockingPathLine(entry)),
    options.remedy,
  ].join('\n')
}

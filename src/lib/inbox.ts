import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
} from 'node:fs'
import path from 'node:path'

import { invariant, PanError } from './errors.js'
import { ensureDir, fileExists, resolveInside } from './io.js'
import { parseMarkdown } from './markdown.js'
import { loadState, persist } from './state.js'
import { resolveRunLayout } from './run-layout.js'
import type { RunState } from './types.js'

export const INBOX_WORK_STATUSES = [
  'queue',
  'active',
  'canceled',
  'complete',
] as const

export type InboxWorkStatus = (typeof INBOX_WORK_STATUSES)[number]

export interface InboxItem {
  file_name: string
  title: string
  modified_at: string
  run_id: string | null
}

interface InboxEntry {
  item: InboxItem
  mtimeMs: number
}

export interface InboxLegacyMigrationSummary {
  migrated_files: number
  updated_runs: number
}

const INBOX_ROOT_SEGMENTS = ['runtime', 'inbox'] as const

function inboxRootRelative(): string {
  return path.join(...INBOX_ROOT_SEGMENTS)
}

function statusDirectoryRelative(status: InboxWorkStatus | 'archive'): string {
  return path.join(inboxRootRelative(), status)
}

function normalizeRepoPath(relativePath: string): string {
  return relativePath.split(path.sep).join('/')
}

/** True when `relativePath` names a file under `runtime/inbox/`. */
export function isInboxRequestPath(relativePath: string): boolean {
  return inboxStatusOf(relativePath) !== null
}

/** Resolve the inbox status for a harness-relative inbox path, if any. */
export function inboxStatusOf(
  relativePath: string,
): InboxWorkStatus | 'archive' | 'legacy' | null {
  const normalized = normalizeRepoPath(relativePath)
  const prefix = `${inboxRootRelative()}/`

  if (!normalized.startsWith(prefix)) {
    return null
  }

  const remainder = normalized.slice(prefix.length)
  const segments = remainder.split('/')
  const [firstSegment] = segments

  if (segments.length === 1 && firstSegment.length > 0) {
    if (
      firstSegment === 'queue' ||
      firstSegment === 'active' ||
      firstSegment === 'canceled' ||
      firstSegment === 'complete' ||
      firstSegment === 'archive'
    ) {
      return null
    }

    return 'legacy'
  }

  if (segments.length !== 2 || !segments[1]) {
    return null
  }

  if (
    firstSegment === 'queue' ||
    firstSegment === 'active' ||
    firstSegment === 'canceled' ||
    firstSegment === 'complete'
  ) {
    return firstSegment
  }

  if (firstSegment === 'archive') {
    return 'archive'
  }

  return null
}

export function ensureInboxStatusDirectories(root: string): void {
  for (const status of [...INBOX_WORK_STATUSES, 'archive'] as const) {
    ensureDir(resolveInside(root, statusDirectoryRelative(status)))
  }
}

export function queueInboxRelativePath(fileName: string): string {
  return path.join(statusDirectoryRelative('queue'), fileName)
}

function assertInboxMoveTargetFree(
  root: string,
  sourceRelative: string,
  targetRelative: string,
): void {
  const target = resolveInside(root, targetRelative)

  invariant(
    !fileExists(target),
    `Inbox move collision: ${sourceRelative} -> ${targetRelative}`,
    { code: 'INBOX_MOVE_COLLISION' },
  )
}

const TERMINAL_INBOX_STATUSES: ReadonlySet<InboxWorkStatus | 'archive'> =
  new Set(['complete', 'canceled', 'archive'])

const INBOX_NAME_SUFFIX_LIMIT = 1_000

/**
 * A terminal directory is history, and one intake file can legitimately be
 * run more than once (a drill, a retry from `canceled`), so a name already
 * present there gets a numeric suffix instead of failing the move. `queue`
 * and `active` keep the collision: two live runs on one intake is a real
 * conflict.
 */
function uniqueTerminalInboxName(
  root: string,
  targetStatus: InboxWorkStatus | 'archive',
  fileName: string,
): string {
  const directory = statusDirectoryRelative(targetStatus)

  if (!fileExists(resolveInside(root, path.join(directory, fileName)))) {
    return fileName
  }

  const extension = path.extname(fileName)
  const stem = fileName.slice(0, fileName.length - extension.length)

  for (let index = 2; index <= INBOX_NAME_SUFFIX_LIMIT; index += 1) {
    const candidate = `${stem}-${index}${extension}`

    if (!fileExists(resolveInside(root, path.join(directory, candidate)))) {
      return candidate
    }
  }

  throw new PanError(
    `Inbox move collision: no free name for ${fileName} under ${directory}`,
    { code: 'INBOX_MOVE_COLLISION' },
  )
}

function moveInboxFile(
  root: string,
  sourceRelative: string,
  targetStatus: InboxWorkStatus | 'archive',
): string {
  const fileName = TERMINAL_INBOX_STATUSES.has(targetStatus)
    ? uniqueTerminalInboxName(root, targetStatus, path.basename(sourceRelative))
    : path.basename(sourceRelative)
  const targetRelative = path.join(
    statusDirectoryRelative(targetStatus),
    fileName,
  )

  return moveInboxFileToPath(root, sourceRelative, targetRelative)
}

function moveInboxFileToPath(
  root: string,
  sourceRelative: string,
  targetRelative: string,
): string {
  const normalizedSource = normalizeRepoPath(sourceRelative)
  const normalizedTarget = normalizeRepoPath(targetRelative)
  const source = resolveInside(root, normalizedSource)

  invariant(
    fileExists(source),
    `Inbox item does not exist: ${normalizedSource}`,
    {
      code: 'INBOX_ITEM_NOT_FOUND',
    },
  )
  assertInboxMoveTargetFree(root, normalizedSource, normalizedTarget)

  const target = resolveInside(root, normalizedTarget)

  ensureDir(path.dirname(target))
  renameSync(source, target)

  return normalizedTarget
}

/** Reject inbox requests that are not in queue or canceled. */
export function assertClaimableInboxRequest(relativePath: string): void {
  const status = inboxStatusOf(relativePath)

  invariant(status !== null, `Not an inbox request path: ${relativePath}`, {
    code: 'INVALID_INBOX_REQUEST',
  })

  if (status === 'queue' || status === 'canceled' || status === 'legacy') {
    return
  }

  throw new PanError(
    `Inbox request '${relativePath}' is in status '${status}' and cannot start a run.`,
    { code: 'INVALID_INBOX_REQUEST', details: { status } },
  )
}

/** Move a queue, canceled, or legacy inbox item to active. */
export function claimInboxRequest(root: string, relativePath: string): string {
  const normalized = normalizeRepoPath(relativePath)
  const status = inboxStatusOf(normalized)

  invariant(status !== null, `Not an inbox request path: ${normalized}`, {
    code: 'INVALID_INBOX_REQUEST',
  })

  if (status === 'legacy') {
    return moveInboxFile(root, normalized, 'active')
  }

  invariant(
    status === 'queue' || status === 'canceled',
    `Inbox request '${normalized}' is in status '${status}' and cannot be claimed.`,
    { code: 'INVALID_INBOX_REQUEST', details: { status } },
  )

  return moveInboxFile(root, normalized, 'active')
}

export function rollbackInboxClaim(
  root: string,
  activePath: string,
  originalPath: string,
): string {
  const status = inboxStatusOf(originalPath)

  invariant(
    status === 'queue' || status === 'canceled' || status === 'legacy',
    `Inbox claim cannot return to '${originalPath}'.`,
    { code: 'INVALID_INBOX_TRANSITION', details: { status } },
  )

  return moveInboxFileToPath(root, activePath, originalPath)
}

/** Move an active inbox item to complete or canceled. */
export function finishInboxRequest(
  root: string,
  sourcePath: string,
  destination: 'complete' | 'canceled',
  recoverySourcePath?: string,
): string | null {
  const normalized = normalizeRepoPath(sourcePath)
  const status = inboxStatusOf(normalized)

  if (status === null) {
    return null
  }

  if (status === destination && fileExists(resolveInside(root, normalized))) {
    return normalized
  }

  invariant(
    status === 'active' || status === 'legacy',
    `Inbox request '${normalized}' is in status '${status}' and cannot move to '${destination}'.`,
    { code: 'INVALID_INBOX_TRANSITION', details: { status, destination } },
  )

  if (fileExists(resolveInside(root, normalized))) {
    return moveInboxFile(root, normalized, destination)
  }

  invariant(recoverySourcePath, `Inbox item does not exist: ${normalized}`, {
    code: 'INBOX_ITEM_NOT_FOUND',
  })

  const targetRelative = path.join(
    statusDirectoryRelative(destination),
    uniqueTerminalInboxName(root, destination, path.basename(normalized)),
  )

  assertInboxMoveTargetFree(root, normalized, targetRelative)

  const target = resolveInside(root, targetRelative)

  ensureDir(path.dirname(target))
  copyFileSync(resolveInside(root, recoverySourcePath), target)

  return targetRelative
}

function loadKnownRunIds(root: string): string[] {
  const workflowsDirectory = resolveInside(
    root,
    path.join('runtime', 'logs', 'workflows'),
  )

  if (!fileExists(workflowsDirectory)) {
    return []
  }

  return readdirSync(workflowsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'archive')
    .map((entry) => entry.name)
}

/**
 * The workspace-and-sequence base of a run id, e.g. `63319_Aug-21-0127` from
 * `63319_Aug-21-0127_operator-upd`. Run ids truncate their title slug, so
 * inbox files named after the same run often differ beyond this base.
 */
function runIdBase(value: string): string | null {
  const match = /^(\d+_[A-Za-z]+-\d+-\d+)_/u.exec(value)

  return match ? match[1] : null
}

function resolveRunId(fileName: string, knownRunIds: string[]): string | null {
  const stem = fileName.endsWith('.md') ? fileName.slice(0, -3) : fileName
  let best: string | null = null

  for (const runId of knownRunIds) {
    if (stem !== runId && !stem.startsWith(`${runId}-`)) {
      continue
    }

    if (!best || runId.length > best.length) {
      best = runId
    }
  }

  if (best) {
    return best
  }

  const stemBase = runIdBase(`${stem}_`)

  if (!stemBase) {
    return null
  }

  const baseMatches = knownRunIds.filter(
    (runId) => runIdBase(runId) === stemBase,
  )

  return baseMatches.length === 1 ? baseMatches[0] : null
}

function extractTitle(content: string, fileName: string): string {
  const parsed = parseMarkdown(content)
  const levelOne = parsed.headings.find((heading) => heading.level === 1)

  return levelOne?.text ?? fileName
}

function listRunsWithInboxSource(root: string): RunState[] {
  const base = path.join(root, 'runtime', 'logs', 'workflows')

  if (!existsSync(base)) {
    return []
  }

  const runs: RunState[] = []

  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'archive') {
      continue
    }

    const statePath = resolveRunLayout(root, entry.name).state.absolute

    if (!fileExists(statePath)) {
      continue
    }

    try {
      const run = loadState(root, entry.name)

      if (typeof run.request?.source_path !== 'string') {
        continue
      }

      runs.push(run)
    } catch {
      // Skip unreadable runs during migration.
    }
  }

  return runs
}

function targetStatusForRun(status: RunState['status']): InboxWorkStatus {
  if (status === 'succeeded') {
    return 'complete'
  }

  if (status === 'canceled') {
    return 'canceled'
  }

  return 'active'
}

function findLatestMatchingRun(
  runs: RunState[],
  inboxRelativePath: string,
): RunState | null {
  const normalized = normalizeRepoPath(inboxRelativePath)
  const matches = runs.filter(
    (run) => normalizeRepoPath(run.request.source_path) === normalized,
  )

  if (matches.length === 0) {
    return null
  }

  matches.sort((left, right) => right.updated_at.localeCompare(left.updated_at))

  return matches[0] ?? null
}

/** Move direct legacy inbox Markdown files into status directories. */
export function migrateLegacyInboxLayout(
  root: string,
): InboxLegacyMigrationSummary {
  ensureInboxStatusDirectories(root)

  const inboxDir = resolveInside(root, inboxRootRelative())

  if (!fileExists(inboxDir)) {
    return { migrated_files: 0, updated_runs: 0 }
  }

  const runs = listRunsWithInboxSource(root)
  let migratedFiles = 0
  let updatedRuns = 0

  for (const entry of readdirSync(inboxDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue
    }

    const legacyRelative = path.join(inboxRootRelative(), entry.name)
    const matchedRun = findLatestMatchingRun(runs, legacyRelative)
    const targetStatus = matchedRun
      ? targetStatusForRun(matchedRun.status)
      : 'queue'
    const targetRelative = moveInboxFile(root, legacyRelative, targetStatus)

    migratedFiles += 1

    if (matchedRun) {
      matchedRun.request.source_path = targetRelative
      persist(root, matchedRun, 'inbox_layout_migrated', {
        from: legacyRelative,
        to: targetRelative,
      })
      updatedRuns += 1
    }
  }

  return { migrated_files: migratedFiles, updated_runs: updatedRuns }
}

/** List queued Markdown inbox items in newest-first modification-time order. */
export function listInbox(root: string): InboxItem[] {
  const queueDir = resolveInside(root, statusDirectoryRelative('queue'))

  if (!fileExists(queueDir)) {
    return []
  }

  const knownRunIds = loadKnownRunIds(root)
  const entries = readdirSync(queueDir, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && entry.name.endsWith('.md'),
  )
  const items: InboxEntry[] = entries.map((entry) => {
    const filePath = path.join(queueDir, entry.name)
    const stat = statSync(filePath)
    const content = readFileSync(filePath, 'utf8')

    return {
      mtimeMs: stat.mtimeMs,
      item: {
        file_name: entry.name,
        title: extractTitle(content, entry.name),
        modified_at: new Date(stat.mtimeMs).toISOString(),
        run_id: resolveRunId(entry.name, knownRunIds),
      },
    }
  })

  items.sort((left, right) => {
    const timeDifference = right.mtimeMs - left.mtimeMs

    if (timeDifference !== 0) {
      return timeDifference
    }

    return left.item.file_name.localeCompare(right.item.file_name)
  })

  return items.map((entry) => entry.item)
}

/** Render a tab-separated inbox listing or the empty-list message. */
export function renderInbox(items: InboxItem[]): string {
  if (items.length === 0) {
    return 'Inbox is empty.\n'
  }

  const lines = ['FILE\tTITLE\tMODIFIED\tRUN']

  for (const item of items) {
    lines.push(
      `${item.file_name}\t${item.title}\t${item.modified_at}\t${item.run_id ?? '-'}`,
    )
  }

  return `${lines.join('\n')}\n`
}

export function inboxTemporalScanDirectories(): string[] {
  return [
    statusDirectoryRelative('queue'),
    statusDirectoryRelative('active'),
    statusDirectoryRelative('canceled'),
    statusDirectoryRelative('complete'),
    statusDirectoryRelative('archive'),
  ]
}

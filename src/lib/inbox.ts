import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { fileExists, resolveInside } from './io.js'
import { parseMarkdown } from './markdown.js'

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

function inboxDirectory(root: string): string {
  return resolveInside(root, path.join('runtime', 'inbox'))
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

/** List direct Markdown inbox items in newest-first modification-time order. */
export function listInbox(root: string): InboxItem[] {
  const inboxDir = inboxDirectory(root)

  if (!fileExists(inboxDir)) {
    return []
  }

  const knownRunIds = loadKnownRunIds(root)
  const entries = readdirSync(inboxDir, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && entry.name.endsWith('.md'),
  )
  const items: InboxEntry[] = entries.map((entry) => {
    const filePath = path.join(inboxDir, entry.name)
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

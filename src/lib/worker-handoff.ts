import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { getAgentByRunInvocation } from './agent-index/activity.js'
import { isRecord, readJson, resolveInside, writeTextAtomic } from './io.js'
import { resolveRunLayout } from './run-layout.js'
import type { RunState, StageHistoryItem } from './types.js'
import {
  assistantTurns,
  findInvocationTranscripts,
  invocationTranscriptsRoot,
  toolPath,
} from './worker-profile.js'

/**
 * The handoff a source-editing worker receives from the one before it: the
 * previous worker's own notes and a reading map the harness extracts from
 * its transcript. A retry or a remediation then starts at the lines the last
 * worker already found, instead of re-exploring the codebase.
 */

/** Stages whose worker edits source, and whose successor inherits its map. */
export const SOURCE_EDITING_STAGES = ['implement', 'remediate', 'consolidate']

/** Paths listed in the reading map, most-used first. */
const MAX_MAP_PATHS = 40

/** Grep patterns kept per path. */
const MAX_PATTERNS = 5

/** A transcript above this size is not parsed. */
const MAX_TRANSCRIPT_BYTES = 32 * 1024 * 1024

const EDIT_TOOLS = new Set(['Write', 'StrReplace', 'Edit', 'MultiEdit'])

export interface ReadingMapEntry {
  /** Workspace-relative path. */
  path: string
  /** The file was read without a range at least once. */
  whole: boolean
  /** Merged one-based inclusive line ranges read with an offset or limit. */
  ranges: Array<[number, number]>
  reads: number
  edited: boolean
  patterns: string[]
}

export interface WorkerHandoffNotes {
  symbols_changed: Array<{
    path: string
    symbol: string
    lines?: string
    note?: string
  }>
  decisions: string[]
  untested: string[]
  start_here: Array<{ path: string; symbol_or_lines?: string; why?: string }>
}

function relativeTo(roots: string[], target: string): string | null {
  const absolute = path.resolve(target)

  for (const root of roots) {
    const relative = path.relative(root, absolute)

    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      return relative.split(path.sep).join('/')
    }
  }

  return null
}

function ignoredPath(relative: string): boolean {
  const segments = relative.split('/')

  return (
    segments[0] === 'runtime' ||
    segments.includes('node_modules') ||
    segments[0] === 'dist' ||
    segments[0] === '.git'
  )
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((left, right) => left[0] - right[0])
  const merged: Array<[number, number]> = []

  for (const range of sorted) {
    const last = merged.at(-1)

    if (last && range[0] <= last[1] + 1) {
      last[1] = Math.max(last[1], range[1])
    } else {
      merged.push([range[0], range[1]])
    }
  }

  return merged
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null
}

/**
 * The files one worker read and edited, from its transcript. A read with an
 * offset or a limit records a line range; one without records the whole
 * file. Harness runtime paths, dependencies, and build output are dropped.
 */
export function readingMapFromTranscript(
  content: string,
  roots: string[],
): ReadingMapEntry[] {
  const entries = new Map<string, ReadingMapEntry>()
  const entry = (relative: string): ReadingMapEntry => {
    const existing = entries.get(relative)

    if (existing) {
      return existing
    }

    const created: ReadingMapEntry = {
      path: relative,
      whole: false,
      ranges: [],
      reads: 0,
      edited: false,
      patterns: [],
    }

    entries.set(relative, created)

    return created
  }

  for (const tools of assistantTurns(content)) {
    for (const tool of tools) {
      const target = toolPath(tool)
      const relative = target ? relativeTo(roots, target) : null

      if (!relative || ignoredPath(relative)) {
        continue
      }

      if (tool.name === 'Read') {
        const record = entry(relative)
        const offset = positiveInteger(tool.input.offset)
        const limit = positiveInteger(tool.input.limit)

        record.reads += 1

        if (offset === null && limit === null) {
          record.whole = true
        } else {
          const start = offset ?? 1

          record.ranges.push([start, start + (limit ?? 1) - 1])
        }
      } else if (EDIT_TOOLS.has(tool.name)) {
        entry(relative).edited = true
      } else if (tool.name === 'Grep') {
        const pattern = tool.input.pattern
        const record = entry(relative)

        if (
          typeof pattern === 'string' &&
          record.patterns.length < MAX_PATTERNS &&
          !record.patterns.includes(pattern)
        ) {
          record.patterns.push(pattern)
        }
      }
    }
  }

  return [...entries.values()]
    .map((item) => ({ ...item, ranges: mergeRanges(item.ranges) }))
    .sort(
      (left, right) =>
        Number(right.edited) - Number(left.edited) ||
        right.reads - left.reads ||
        left.path.localeCompare(right.path),
    )
    .slice(0, MAX_MAP_PATHS)
}

/** The structured notes a source stage output carries, when it has them. */
export function handoffNotesFromOutput(
  value: unknown,
): WorkerHandoffNotes | null {
  const data = isRecord(value) && isRecord(value.data) ? value.data : null
  const implementation =
    data && isRecord(data.implementation) ? data.implementation : null
  const handoff =
    implementation && isRecord(implementation.handoff)
      ? implementation.handoff
      : null

  if (!handoff) {
    return null
  }

  const records = (key: string): Array<Record<string, unknown>> =>
    Array.isArray(handoff[key])
      ? (handoff[key] as unknown[]).filter(isRecord)
      : []
  const strings = (key: string): string[] =>
    Array.isArray(handoff[key])
      ? (handoff[key] as unknown[]).filter(
          (item): item is string => typeof item === 'string',
        )
      : []
  const text = (record: Record<string, unknown>, key: string): string =>
    typeof record[key] === 'string' ? record[key] : ''

  return {
    symbols_changed: records('symbols_changed').map((item) => ({
      path: text(item, 'path'),
      symbol: text(item, 'symbol'),
      lines: text(item, 'lines'),
      note: text(item, 'note'),
    })),
    decisions: strings('decisions'),
    untested: strings('untested'),
    start_here: records('start_here').map((item) => ({
      path: text(item, 'path'),
      symbol_or_lines: text(item, 'symbol_or_lines'),
      why: text(item, 'why'),
    })),
  }
}

/** The latest earlier source-editing attempt this stage inherits from. */
export function priorSourceAttempt(
  state: RunState,
  stageSlug: string,
): StageHistoryItem | null {
  if (!SOURCE_EDITING_STAGES.includes(stageSlug)) {
    return null
  }

  return (
    [...state.stage_history]
      .reverse()
      .find((item) => SOURCE_EDITING_STAGES.includes(item.stage)) ?? null
  )
}

function transcriptFor(
  root: string,
  runId: string,
  item: StageHistoryItem,
): string | null {
  const indexed = getAgentByRunInvocation(
    root,
    runId,
    item.invocation_id,
  )?.transcript_path

  if (indexed && existsSync(indexed)) {
    return indexed
  }

  const invocation = readJson(
    resolveRunLayout(root, runId).invocation(item.invocation_id, '.json')
      .absolute,
  )
  const createdMs =
    isRecord(invocation) && typeof invocation.created_at === 'string'
      ? Date.parse(invocation.created_at)
      : Number.NaN

  return (
    findInvocationTranscripts(
      invocationTranscriptsRoot(root),
      item.invocation_id,
      Number.isFinite(createdMs) ? createdMs : 0,
    )[0] ?? null
  )
}

function rangeText(entry: ReadingMapEntry): string {
  if (entry.whole) {
    return 'whole file'
  }

  return entry.ranges.map(([start, end]) => `${start}-${end}`).join(', ')
}

function cell(text: string): string {
  return text.replace(/\|/gu, '\\|').replace(/\s+/gu, ' ').trim()
}

function renderHandoff(
  item: StageHistoryItem,
  notes: WorkerHandoffNotes | null,
  changedFiles: string[],
  map: ReadingMapEntry[] | null,
): string {
  const lines = [
    '# Handoff from the previous worker',
    '',
    `The previous \`${item.stage}\` worker (invocation \`${item.invocation_id}\`, attempt ${item.attempt}) ended in \`${item.outcome}\`. Start from its notes and reading map. Open a listed file at the listed lines rather than re-reading it from the top.`,
    '',
    '## Notes',
    '',
  ]

  if (!notes) {
    lines.push('The previous output recorded no `implementation.handoff`.', '')
  } else {
    lines.push(
      '### Start here',
      '',
      ...(notes.start_here.length > 0
        ? notes.start_here.map(
            (entry) =>
              `- \`${entry.path}\`${entry.symbol_or_lines ? ` · ${entry.symbol_or_lines}` : ''}${entry.why ? ` — ${entry.why}` : ''}`,
          )
        : ['- None recorded.']),
      '',
      '### Symbols changed',
      '',
      ...(notes.symbols_changed.length > 0
        ? notes.symbols_changed.map(
            (entry) =>
              `- \`${entry.path}\` · \`${entry.symbol}\`${entry.lines ? ` (lines ${entry.lines})` : ''}${entry.note ? ` — ${entry.note}` : ''}`,
          )
        : ['- None recorded.']),
      '',
      '### Decisions',
      '',
      ...(notes.decisions.length > 0
        ? notes.decisions.map((entry) => `- ${entry}`)
        : ['- None recorded.']),
      '',
      '### Not yet proven',
      '',
      ...(notes.untested.length > 0
        ? notes.untested.map((entry) => `- ${entry}`)
        : ['- None recorded.']),
      '',
    )
  }

  lines.push(
    '## Files the previous attempt changed',
    '',
    ...(changedFiles.length > 0
      ? changedFiles.map((file) => `- \`${file}\``)
      : ['- None recorded.']),
    '',
    '## Reading map',
    '',
  )

  if (map === null) {
    lines.push(
      'The previous worker transcript is not available, so the harness has no reading map for this handoff.',
    )
  } else if (map.length === 0) {
    lines.push('The previous worker transcript names no workspace file.')
  } else {
    lines.push(
      '| Path | Read | Lines | Edited | Searches |',
      '| --- | --- | --- | --- | --- |',
      ...map.map(
        (entry) =>
          `| \`${cell(entry.path)}\` | ${entry.reads} | ${cell(rangeText(entry)) || '—'} | ${entry.edited ? 'yes' : 'no'} | ${entry.patterns.length > 0 ? entry.patterns.map((pattern) => `\`${cell(pattern)}\``).join(', ') : '—'} |`,
      ),
    )
  }

  return `${lines.join('\n').trimEnd()}\n`
}

/**
 * Write the handoff artifact for a source-editing invocation, or return null
 * when no earlier source attempt exists. A missing or unreadable transcript
 * only drops the reading map; the notes and changed files still reach the
 * worker. Never throws on the transcript path, because a failed extraction
 * must not fail a prepare.
 */
export function writeWorkerHandoff(
  root: string,
  state: RunState,
  stageSlug: string,
  invocationId: string,
): string | null {
  const item = priorSourceAttempt(state, stageSlug)

  if (!item) {
    return null
  }

  let output: unknown = null

  try {
    output = readJson(resolveInside(root, item.output_path))
  } catch {
    output = null
  }

  const data = isRecord(output) && isRecord(output.data) ? output.data : null
  const implementation =
    data && isRecord(data.implementation) ? data.implementation : null
  const changedFiles =
    implementation && Array.isArray(implementation.changed_files)
      ? implementation.changed_files.filter(
          (entry): entry is string => typeof entry === 'string',
        )
      : []
  let map: ReadingMapEntry[] | null = null

  try {
    const transcript = transcriptFor(root, state.run_id, item)

    if (transcript && statSync(transcript).size <= MAX_TRANSCRIPT_BYTES) {
      const roots = [
        path.resolve(root, state.workspace_root || '.'),
        path.resolve(root),
      ]

      map = readingMapFromTranscript(readFileSync(transcript, 'utf8'), roots)
    }
  } catch {
    map = null
  }

  const artifact = resolveRunLayout(root, state.run_id).invocation(
    invocationId,
    '.handoff.md',
  )

  writeTextAtomic(
    artifact.absolute,
    renderHandoff(item, handoffNotesFromOutput(output), changedFiles, map),
  )

  return artifact.relative
}

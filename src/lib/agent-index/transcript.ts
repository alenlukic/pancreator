/**
 * Read-only subagent transcript inspection: path derivation, bounded tail
 * reads that expose only metadata and the last record's type and status, and
 * a digest of the first task that never exposes its text.
 */

import { closeSync, openSync, readSync, statSync } from 'node:fs'
import path from 'node:path'

import {
  MAX_TRANSCRIPT_PATH_CHARS,
  promptDigest,
  type AgentEntry,
} from './store.js'

export const TRANSCRIPT_TAIL_BYTES = 4096

// Cost-backed bound on the first record read: a task longer than this
// cannot be matched to its launch by digest.
const TRANSCRIPT_HEAD_BYTES = 128 * 1024
const USER_QUERY_OPEN = '<user_query>\n'
const USER_QUERY_CLOSE = '\n</user_query>'
// The first record never changes once its line ends, so a watch that polls
// every few seconds reads each transcript head once. Cost-backed bound.
const TASK_DIGEST_CACHE_LIMIT = 1024
const taskDigestCache = new Map<string, string | null>()

export const CHILD_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u

/**
 * The directory Cursor writes a parent's subagent transcripts to, or null
 * when the entry carries no parent transcript path.
 */
export function subagentTranscriptDirectory(agent: AgentEntry): string | null {
  return agent.parent_transcript_path
    ? path.join(path.dirname(agent.parent_transcript_path), 'subagents')
    : null
}

/**
 * The `promptDigest` of the task a subagent transcript's first user record
 * carries inside its `<user_query>` block, or null when that record is
 * unreadable, longer than the head bound, or carries no query.
 */
export function transcriptTaskDigest(file: string): string | null {
  const cached = taskDigestCache.get(file)

  if (cached !== undefined) {
    return cached
  }

  const buffer = Buffer.alloc(TRANSCRIPT_HEAD_BYTES)
  let read: number

  try {
    const fd = openSync(file, 'r')

    try {
      read = readSync(fd, buffer, 0, TRANSCRIPT_HEAD_BYTES, 0)
    } finally {
      closeSync(fd)
    }
  } catch {
    return null
  }

  const newline = buffer.subarray(0, read).indexOf(0x0a)

  // A first record still being written gets no answer yet; one past the
  // head bound never will.
  if (newline === -1) {
    return read >= TRANSCRIPT_HEAD_BYTES ? cacheTaskDigest(file, null) : null
  }

  return cacheTaskDigest(
    file,
    firstRecordTaskDigest(buffer.subarray(0, newline).toString('utf8')),
  )
}

function cacheTaskDigest(file: string, digest: string | null): string | null {
  if (taskDigestCache.size >= TASK_DIGEST_CACHE_LIMIT) {
    taskDigestCache.clear()
  }

  taskDigestCache.set(file, digest)

  return digest
}

function firstRecordTaskDigest(line: string): string | null {
  let record: unknown

  try {
    record = JSON.parse(line) as unknown
  } catch {
    return null
  }

  const content =
    record !== null &&
    typeof record === 'object' &&
    (record as { role?: unknown }).role === 'user'
      ? (record as { message?: { content?: unknown } }).message?.content
      : undefined

  if (!Array.isArray(content)) {
    return null
  }

  const text = content
    .map((part: unknown) =>
      part !== null &&
      typeof part === 'object' &&
      (part as { type?: unknown }).type === 'text' &&
      typeof (part as { text?: unknown }).text === 'string'
        ? (part as { text: string }).text
        : '',
    )
    .join('')
  const open = text.lastIndexOf(USER_QUERY_OPEN)
  const close = text.lastIndexOf(USER_QUERY_CLOSE)

  return open !== -1 && close > open
    ? promptDigest(text.slice(open + USER_QUERY_OPEN.length, close))
    : null
}

export interface TranscriptState {
  path: string
  size: number
  mtime_ms: number
  age_seconds: number
  readable: boolean
  last_record_type: string | null
  turn_ended: boolean
  turn_status: string | null
}

function isAbsoluteJsonl(pathValue: string): boolean {
  return (
    path.isAbsolute(pathValue) &&
    pathValue.endsWith('.jsonl') &&
    pathValue.length <= MAX_TRANSCRIPT_PATH_CHARS
  )
}

/**
 * Candidate child transcript paths in probe order: the stop's stored path,
 * then `<parent>/subagents/<id>.jsonl` for the canonical id and each alias.
 */
export function subagentTranscriptCandidates(agent: AgentEntry): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  const push = (candidate: string | null | undefined): void => {
    if (!candidate || !isAbsoluteJsonl(candidate) || seen.has(candidate)) {
      return
    }

    seen.add(candidate)
    out.push(candidate)
  }

  push(agent.transcript_path)

  const directory = subagentTranscriptDirectory(agent)

  if (directory) {
    for (const id of [agent.agent_id, ...agent.aliases]) {
      if (CHILD_ID_PATTERN.test(id)) {
        push(path.join(directory, `${id}.jsonl`))
      }
    }
  }

  return out
}

function parseLastCompleteLine(tail: string): Record<string, unknown> | null {
  const lines = tail.split('\n').filter((line) => line.trim().length > 0)

  if (lines.length === 0) {
    return null
  }

  const last = lines[lines.length - 1]

  if (
    last === undefined ||
    Buffer.byteLength(last, 'utf8') > TRANSCRIPT_TAIL_BYTES
  ) {
    return null
  }

  try {
    const parsed = JSON.parse(last) as unknown

    return parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * Inspect the first readable candidate transcript for an agent entry.
 * Returns null when no candidate exists or none is a regular file.
 */
export function readTranscriptState(
  agent: AgentEntry,
  nowMs: number,
): TranscriptState | null {
  for (const candidate of subagentTranscriptCandidates(agent)) {
    let stats

    try {
      stats = statSync(candidate)

      if (!stats.isFile()) {
        continue
      }
    } catch {
      continue
    }

    let tail = ''

    try {
      const size = stats.size

      if (size === 0) {
        return {
          path: candidate,
          size: 0,
          mtime_ms: stats.mtimeMs,
          age_seconds: Math.max(0, (nowMs - stats.mtimeMs) / 1000),
          readable: false,
          last_record_type: null,
          turn_ended: false,
          turn_status: null,
        }
      }

      const start = Math.max(0, size - TRANSCRIPT_TAIL_BYTES)
      const length = size - start
      const buffer = Buffer.alloc(length)
      const fd = openSync(candidate, 'r')

      try {
        readSync(fd, buffer, 0, length, start)
      } finally {
        closeSync(fd)
      }

      tail = buffer.toString('utf8')
    } catch {
      return {
        path: candidate,
        size: stats.size,
        mtime_ms: stats.mtimeMs,
        age_seconds: Math.max(0, (nowMs - stats.mtimeMs) / 1000),
        readable: false,
        last_record_type: null,
        turn_ended: false,
        turn_status: null,
      }
    }

    const last = parseLastCompleteLine(tail)
    const recordType = last && typeof last.type === 'string' ? last.type : null
    const turnEnded = recordType === 'turn_ended'
    const turnStatus =
      turnEnded && typeof last?.status === 'string' ? last.status : null

    return {
      path: candidate,
      size: stats.size,
      mtime_ms: stats.mtimeMs,
      age_seconds: Math.max(0, (nowMs - stats.mtimeMs) / 1000),
      readable: last !== null,
      last_record_type: recordType,
      turn_ended: turnEnded,
      turn_status: turnStatus,
    }
  }

  return null
}

/** Validate and store a parent transcript path from a hook payload. */
export function validatedParentTranscriptPath(
  value: string | null,
): string | null {
  if (value === null || !isAbsoluteJsonl(value)) {
    return null
  }

  return value
}

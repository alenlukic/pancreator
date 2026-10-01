/**
 * Read-only subagent transcript inspection: path derivation and bounded tail
 * reads that expose only metadata and the last record's type and status.
 */

import { closeSync, openSync, readSync, statSync } from 'node:fs'
import path from 'node:path'

import { MAX_TRANSCRIPT_PATH_CHARS, type AgentEntry } from './store.js'

export const TRANSCRIPT_TAIL_BYTES = 4096

const CHILD_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u

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

  const parentDir =
    agent.parent_transcript_path !== null &&
    agent.parent_transcript_path !== undefined
      ? path.dirname(agent.parent_transcript_path)
      : null

  if (parentDir) {
    for (const id of [agent.agent_id, ...agent.aliases]) {
      if (CHILD_ID_PATTERN.test(id)) {
        push(path.join(parentDir, 'subagents', `${id}.jsonl`))
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

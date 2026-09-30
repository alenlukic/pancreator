/**
 * Bounded file reads, timestamps, and the files modified inside the evidence
 * window.
 */

import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { isDirectory, isRecord, readJson, readText } from '../../io.js'

const MAX_SCAN_FILE_BYTES = 32 * 1024 * 1024

const STREAM_CHUNK_BYTES = 1024 * 1024

/** File modification time in milliseconds, or null when the file cannot be stat'd. */
export function safeStatMs(absolute: string): number | null {
  try {
    return statSync(absolute).mtimeMs
  } catch {
    return null
  }
}

/** Epoch milliseconds of a date string, or null for a non-string or unparseable value. */
export function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null
  }

  const parsed = Date.parse(value)

  return Number.isNaN(parsed) ? null : parsed
}

/** Reads a JSON object file, returning null when it is missing, unparseable, or not an object. */
export function readJsonRecord(
  absolute: string,
): Record<string, unknown> | null {
  try {
    const value = readJson(absolute)

    return isRecord(value) ? value : null
  } catch {
    // A truncated record from an interrupted run is evidence of nothing.
    return null
  }
}

/** Sorted names of the immediate subdirectories, or an empty list when the path is not a directory. */
export function listDirectories(absolute: string): string[] {
  if (!isDirectory(absolute)) {
    return []
  }

  return readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

interface FileEnumeration {
  files: string[]
  unread: string[]
}

/**
 * Recursively lists files under the roots that carry one of the extensions
 * and were modified at or after the window start, both sorted. Directories or
 * files that cannot be read are returned in `unread` instead of throwing.
 */
export function listFilesInWindow(
  roots: readonly string[],
  windowStartMs: number,
  extensions: ReadonlySet<string>,
): FileEnumeration {
  const found: string[] = []
  const unread: string[] = []

  const walk = (absolute: string): void => {
    let entries

    try {
      entries = readdirSync(absolute, { withFileTypes: true })
    } catch {
      unread.push(absolute)
      return
    }

    for (const entry of entries) {
      const child = path.join(absolute, entry.name)

      if (entry.isDirectory()) {
        walk(child)
        continue
      }

      if (!entry.isFile() || !extensions.has(path.extname(entry.name))) {
        continue
      }

      let stats

      try {
        stats = statSync(child)
      } catch {
        unread.push(child)
        continue
      }

      if (stats.mtimeMs < windowStartMs) {
        continue
      }

      found.push(child)
    }
  }

  for (const root of roots) {
    if (isDirectory(root)) {
      walk(root)
    }
  }

  return {
    files: found.sort(),
    unread: [...new Set(unread)].sort(),
  }
}

/**
 * Reads a file as UTF-8, or returns null when it cannot be read. A file above
 * the direct-read size bound is read in fixed-size chunks instead.
 */
export function readEvidenceText(absolute: string): string | null {
  let size: number

  try {
    size = statSync(absolute).size
  } catch {
    return null
  }

  if (size <= MAX_SCAN_FILE_BYTES) {
    try {
      return readText(absolute)
    } catch {
      return null
    }
  }

  let descriptor: number | null = null

  try {
    descriptor = openSync(absolute, 'r')
    const chunks: Buffer[] = []
    let position = 0

    while (position < size) {
      const chunk = Buffer.allocUnsafe(
        Math.min(STREAM_CHUNK_BYTES, size - position),
      )
      const bytes = readSync(descriptor, chunk, 0, chunk.length, position)

      if (bytes === 0) {
        break
      }

      chunks.push(chunk.subarray(0, bytes))
      position += bytes
    }

    return Buffer.concat(chunks).toString('utf8')
  } catch {
    return null
  } finally {
    if (descriptor !== null) {
      closeSync(descriptor)
    }
  }
}

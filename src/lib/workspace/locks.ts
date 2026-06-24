import {
  closeSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import { PanError, invariant } from '../errors.js'
import { ensureDir, fileExists, isRecord, readJson, sha256 } from '../io.js'
import { lockDir } from '../state.js'
import type { FileLock } from '../types.js'

export interface PathDigest {
  kind: 'file' | 'symlink' | 'missing'
  checksum: string | null
  size: number
  modified_at_ms: number
}

export function digestPath(filePath: string): PathDigest {
  if (!fileExists(filePath)) {
    return {
      kind: 'missing',
      checksum: null,
      size: 0,
      modified_at_ms: 0,
    }
  }

  const metadata = lstatSync(filePath)

  if (metadata.isSymbolicLink()) {
    const target = readlinkSync(filePath)

    return {
      kind: 'symlink',
      checksum: sha256(target),
      size: target.length,
      modified_at_ms: metadata.mtimeMs,
    }
  }

  invariant(metadata.isFile(), `Unsupported lock path kind: ${filePath}`, {
    code: 'UNSUPPORTED_ENTRY',
  })

  return {
    kind: 'file',
    checksum: sha256(readFileSync(filePath)),
    size: metadata.size,
    modified_at_ms: metadata.mtimeMs,
  }
}

export function lockFilePath(stateRoot: string, canonicalPath: string): string {
  return path.join(lockDir(stateRoot), `${sha256(canonicalPath)}.json`)
}

function parseLock(value: unknown, source: string): FileLock {
  invariant(
    isRecord(value) &&
      value.schema_version === 1 &&
      typeof value.lock_id === 'string' &&
      typeof value.path === 'string' &&
      typeof value.canonical_path === 'string' &&
      typeof value.workflow_id === 'string',
    `Invalid file lock at ${source}`,
    { code: 'INVALID_FILE_LOCK' },
  )

  return value as unknown as FileLock
}

export function readFileLock(
  stateRoot: string,
  canonicalPath: string,
): FileLock | null {
  const filePath = lockFilePath(stateRoot, canonicalPath)

  if (!fileExists(filePath)) {
    return null
  }

  return parseLock(readJson(filePath), filePath)
}

export function listFileLocks(stateRoot: string): FileLock[] {
  const directory = lockDir(stateRoot)

  if (!fileExists(directory)) {
    return []
  }

  return readdirSync(directory)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) =>
      parseLock(
        readJson(path.join(directory, entry)),
        path.join(directory, entry),
      ),
    )
}

export function acquireFileLock(stateRoot: string, lock: FileLock): FileLock {
  const filePath = lockFilePath(stateRoot, lock.canonical_path)

  ensureDir(path.dirname(filePath))

  let descriptor: number | null = null

  try {
    descriptor = openSync(filePath, 'wx')
    writeFileSync(descriptor, `${JSON.stringify(lock, null, 2)}\n`, 'utf8')
  } catch {
    const existing = readFileLock(stateRoot, lock.canonical_path)

    throw new PanError(`Path lock is already held for ${lock.path}`, {
      code: 'PATH_LOCK_HELD',
      details: { existing },
    })
  } finally {
    if (descriptor !== null) {
      closeSync(descriptor)
    }
  }

  return lock
}

export function releaseFileLock(
  stateRoot: string,
  canonicalPath: string,
): void {
  rmSync(lockFilePath(stateRoot, canonicalPath), { force: true })
}

export function releaseFileLockById(stateRoot: string, lockId: string): void {
  for (const lock of listFileLocks(stateRoot)) {
    if (lock.lock_id === lockId) {
      releaseFileLock(stateRoot, lock.canonical_path)
      return
    }
  }
}

export function acquireFileLockBatch(
  stateRoot: string,
  locks: FileLock[],
): FileLock[] {
  const acquired: FileLock[] = []

  try {
    for (const lock of [...locks].sort((left, right) =>
      left.path.localeCompare(right.path),
    )) {
      acquired.push(acquireFileLock(stateRoot, lock))
    }
  } catch (error) {
    for (const lock of acquired) {
      releaseFileLock(stateRoot, lock.canonical_path)
    }

    throw error
  }

  return acquired
}

export function canCancelFileLock(
  lock: FileLock,
  currentChecksum: string | null,
): boolean {
  return lock.expected_checksum === currentChecksum
}

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import {
  fileExists,
  isRecord,
  readJson,
  sha256,
  writeJsonAtomic,
} from './io.js'

import type { RepositoryCheckResult } from './repository-checks.js'
import type { WorkspaceSnapshot } from './types.js'

// Cache of clean deterministic gate passes (DEV-001). The key covers the
// workspace fingerprint, the resolved command, and the content hash of
// `runtime/repository-checks.json`, which defines what a profile command means.
// Only a clean pass enters the cache, because a re-run of a failed gate is how
// a repair is observed. Only a Git workspace is cacheable: another kind
// fingerprints as one constant. An entry expires after a TTL because toolchain
// drift is not fingerprinted.

export interface GateCacheEntry {
  key: string
  criterion_id: string
  command: string
  workspace_fingerprint: string
  run_id: string
  cached_at: string
  evidence_path: string
  /** A later run compares this result against its own baseline. */
  repository_result?: RepositoryCheckResult
}

export interface GateCacheStatus {
  enabled: boolean
  path: string
  entries: number
  fresh_entries: number
}

const CACHE_RELATIVE_PATH = 'runtime/cache/gate-results.json'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const CACHE_MAX_ENTRIES = 100

export const GATE_CACHE_ENV = 'PAN_GATE_CACHE'
export const GATE_CACHE_PATH = CACHE_RELATIVE_PATH

function cachePath(root: string): string {
  return path.join(root, CACHE_RELATIVE_PATH)
}

export function gateCacheEnabled(): boolean {
  return process.env[GATE_CACHE_ENV] !== '0'
}

function checksConfigHash(root: string): string {
  const configPath = path.join(root, 'runtime/repository-checks.json')

  try {
    return sha256(readFileSync(configPath))
  } catch {
    return 'no-repository-checks'
  }
}

export function gateCacheableSnapshot(snapshot: WorkspaceSnapshot): boolean {
  return snapshot.kind === 'git'
}

export function gateCacheKey(
  root: string,
  workspaceFingerprint: string,
  command: string,
): string {
  return sha256({
    fingerprint: workspaceFingerprint,
    command,
    checks_config: checksConfigHash(root),
  })
}

function loadEntries(root: string): GateCacheEntry[] {
  const filePath = cachePath(root)

  if (!existsSync(filePath)) {
    return []
  }

  try {
    const value = readJson(filePath)

    if (!isRecord(value) || !Array.isArray(value.entries)) {
      return []
    }

    return value.entries.filter(
      (entry): entry is GateCacheEntry =>
        isRecord(entry) &&
        typeof entry.key === 'string' &&
        typeof entry.cached_at === 'string' &&
        typeof entry.command === 'string' &&
        typeof entry.evidence_path === 'string',
    )
  } catch {
    // A corrupt cache is a cache miss, never a gate failure.
    return []
  }
}

function freshEntries(
  entries: GateCacheEntry[],
  now: number,
): GateCacheEntry[] {
  return entries.filter((entry) => {
    const cachedAt = Date.parse(entry.cached_at)

    return Number.isFinite(cachedAt) && now - cachedAt < CACHE_TTL_MS
  })
}

export function gateCacheLookup(
  root: string,
  key: string,
): GateCacheEntry | null {
  if (!gateCacheEnabled()) {
    return null
  }

  const entries = freshEntries(loadEntries(root), Date.now())
  const entry = entries.find((candidate) => candidate.key === key) ?? null

  // A missing evidence file is a miss: the accepting run must copy the bytes.
  if (entry && !fileExists(path.join(root, entry.evidence_path))) {
    return null
  }

  return entry
}

export function gateCacheStore(root: string, entry: GateCacheEntry): void {
  if (!gateCacheEnabled()) {
    return
  }

  const now = Date.now()
  const entries = freshEntries(loadEntries(root), now).filter(
    (existing) => existing.key !== entry.key,
  )

  entries.push(entry)

  writeJsonAtomic(cachePath(root), {
    schema_version: 1,
    entries: entries.slice(-CACHE_MAX_ENTRIES),
  })
}

export function gateCacheStatus(root: string): GateCacheStatus {
  const entries = loadEntries(root)

  return {
    enabled: gateCacheEnabled(),
    path: CACHE_RELATIVE_PATH,
    entries: entries.length,
    fresh_entries: freshEntries(entries, Date.now()).length,
  }
}

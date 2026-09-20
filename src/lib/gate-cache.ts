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
  /** Who produced the cached execution; absent on records from older releases. */
  recorded_by?: 'agent' | 'harness'
  /** A later run compares this result against its own baseline. */
  repository_result?: RepositoryCheckResult
  /** Suite profile the reporter wrote during the original execution. */
  suite_profile_path?: string
}

/** Everything a caller knows about one clean pass it wants cached. */
export interface GateCacheEntryInput extends Omit<
  GateCacheEntry,
  'cached_at' | 'repository_result' | 'suite_profile_path'
> {
  /** Absent means now, which is what both recorders want. */
  cached_at?: string
  repository_result?: RepositoryCheckResult
  /**
   * Profile the reporter wrote, root-relative. A caller that resolved no
   * artifact passes `null` rather than deciding how the absence is stored.
   */
  suite_profile_path?: string | null
}

/**
 * The one place a gate-cache entry is built.
 *
 * Two recorders store passes: the submission gate and the command-line profile
 * runner. An entry the accepting gate later reuses carries the original
 * execution's suite profile, so a recorder that forgets the optional field
 * silently drops the ship card's profile comparison. Naming every field here
 * makes that omission impossible to write.
 */
export function buildGateCacheEntry(
  input: GateCacheEntryInput,
): GateCacheEntry {
  return {
    key: input.key,
    criterion_id: input.criterion_id,
    command: input.command,
    workspace_fingerprint: input.workspace_fingerprint,
    run_id: input.run_id,
    cached_at: input.cached_at ?? new Date().toISOString(),
    evidence_path: input.evidence_path,
    ...(input.recorded_by ? { recorded_by: input.recorded_by } : {}),
    ...(input.repository_result
      ? { repository_result: input.repository_result }
      : {}),
    ...(input.suite_profile_path
      ? { suite_profile_path: input.suite_profile_path }
      : {}),
  }
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

/**
 * The `DEV-001` gate-cache acceptance rule, in the one term the evidence log
 * uses.
 *
 * A verifier and a remediator each read a `cached` gate from a card that never
 * said what the word meant, and each reached the opposite conclusion: one
 * discounted the pass as stale, the other ordered a rerun the harness had
 * already satisfied. The rule now has one statement, rendered onto every card
 * whose stage owns a repository-check gate and quoted verbatim by the operator
 * guide, so no surface can drift into a second wording or a second term.
 */
export const GATE_CACHE_ACCEPTANCE_RULE =
  'A gate marked `cached` is a real pass, not a skipped one: the identical ' +
  'gate command passed cleanly at this same Git workspace fingerprint and ' +
  'repository-check configuration within the last 24 hours, against a ' +
  'resolved run baseline, and its evidence log carries that original ' +
  'captured output. Treat it as evidence of the same strength as a pass the ' +
  'harness executed just now, and do not order a rerun to replace it. A ' +
  'failure, timeout, skip, override, or baseline-relative credit is never ' +
  'accepted this way.'

function cachePath(root: string): string {
  return path.join(root, CACHE_RELATIVE_PATH)
}

export function gateCacheEnabled(): boolean {
  return process.env[GATE_CACHE_ENV] !== '0'
}

/**
 * Content digest of the verification configuration, which defines what a
 * profile command means. The cache key and the baseline reuse index share this
 * one definition so a result accepted by one cannot be rejected by the other.
 */
export function repositoryChecksConfigDigest(root: string): string {
  const configPath = path.join(root, 'runtime/repository-checks.json')

  try {
    return sha256(readFileSync(configPath))
  } catch {
    return 'no-repository-checks'
  }
}

/**
 * Resolved command text a repository-check profile gate records. The gate and
 * the command-line runner both key the cache on it, so it has one definition.
 */
export function repositoryCheckGateCommand(profileName: string): string {
  return `pan repository-check ${profileName}`
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
    checks_config: repositoryChecksConfigDigest(root),
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

export interface GateCacheAcceptance {
  entry: GateCacheEntry | null
  rejected_entry: GateCacheEntry | null
  rejection: string | null
}

/**
 * A cache lookup filtered by the authority of the recorder.
 *
 * The `full` profile belongs to the harness-owned ship release gate. An agent
 * execution cannot replace it, even when the command and workspace match.
 * Older cache entries predate `recorded_by`, so their evidence header remains
 * the compatibility source for this decision.
 */
export function gateCacheLookupForGate(
  root: string,
  key: string,
): GateCacheAcceptance {
  const entry = gateCacheLookup(root, key)

  if (!entry || entry.command !== repositoryCheckGateCommand('full')) {
    return { entry, rejected_entry: null, rejection: null }
  }

  let recordedBy = entry.recorded_by ?? null

  if (recordedBy === null) {
    try {
      const evidence = readFileSync(
        path.join(root, entry.evidence_path),
        'utf8',
      )
      recordedBy = /^invoked_by=harness$/mu.test(evidence) ? 'harness' : 'agent'
    } catch {
      recordedBy = 'agent'
    }
  }

  if (recordedBy === 'agent') {
    return {
      entry: null,
      rejected_entry: entry,
      rejection:
        `Rejected cached pass ${entry.evidence_path}: an agent-run full ` +
        `profile cannot satisfy the harness-owned ship release gate ` +
        `(VERIFY-001).`,
    }
  }

  return { entry, rejected_entry: null, rejection: null }
}

/**
 * Whether the cache holds a clean pass of one profile at one workspace
 * fingerprint, whoever recorded it.
 *
 * A submission-time claim check asks whether the run has evidence for the
 * profile, not whether the claiming invocation produced it. A gate the
 * harness executed leaves its pass here and no ledger row, so reading the
 * ledger alone reports a correctly cited pass as unrecorded.
 */
export function gateCachePassAtFingerprint(
  root: string,
  profileName: string,
  workspaceFingerprint: string,
): boolean {
  if (!gateCacheEnabled()) {
    return false
  }

  const command = repositoryCheckGateCommand(profileName)

  return freshEntries(loadEntries(root), Date.now()).some(
    (entry) =>
      entry.command === command &&
      entry.workspace_fingerprint === workspaceFingerprint &&
      fileExists(path.join(root, entry.evidence_path)),
  )
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

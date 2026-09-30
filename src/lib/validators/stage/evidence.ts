/**
 * Evidence-path resolution, Git workspace deltas, test deltas, and the shared
 * issue factory every stage validator reports through.
 */

import path from 'node:path'
import { statSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

import { isRecord, fileExists } from '../../io.js'
import type { HandlerInput, HandlerResult } from '../../requirements/types.js'
import {
  gitWorkspaceSnapshot,
  workspaceChangedPathsFromSnapshots,
} from '../../git.js'
import type { WorkspaceSnapshot } from '../../types.js'

const GIT_TIMEOUT_MS = 30_000
const GIT_MAX_BUFFER = 1_024 * 1_024

const HARNESS_EVIDENCE_PREFIXES = [
  'runtime/',
  'library/',
  'governance/',
] as const

function evidencePathCandidate(entry: string): string | null {
  const trimmed = entry.trim()
  const explicit = trimmed.match(/^(?:path|file):\s*(.+)$/iu)
  const candidate = (explicit?.[1] ?? trimmed).split('::', 1)[0]?.trim() ?? ''

  if (candidate.length === 0 || /^[a-z][a-z0-9+.-]*:\/\//iu.test(candidate)) {
    return null
  }

  if (explicit || trimmed.includes('::')) {
    return candidate
  }

  if (/\s/u.test(candidate)) {
    return null
  }

  if (
    candidate.startsWith('./') ||
    candidate.startsWith('../') ||
    candidate.startsWith('/') ||
    /(?:^|\/)\.?[a-z0-9_-]+\.[a-z0-9]+$/iu.test(candidate)
  ) {
    return candidate
  }

  return null
}

/** Modification time of `absolute` in milliseconds, or null when unreadable. */
export function modifiedMs(absolute: string): number | null {
  try {
    return statSync(absolute).mtimeMs
  } catch {
    return null
  }
}

export function workspaceRootFromInput(input: HandlerInput): string {
  if (
    isRecord(input.runState) &&
    typeof input.runState.workspace_root === 'string'
  ) {
    return path.resolve(input.root, input.runState.workspace_root)
  }

  return input.root
}

function isHarnessRelativeEvidencePath(candidate: string): boolean {
  return HARNESS_EVIDENCE_PREFIXES.some(
    (prefix) =>
      candidate === prefix.slice(0, -1) || candidate.startsWith(prefix),
  )
}

function resolveEvidenceFilesystemPath(
  installationRoot: string,
  workspaceRoot: string,
  entry: string,
): string | null {
  const candidate = evidencePathCandidate(entry)

  if (!candidate) {
    return null
  }

  if (path.isAbsolute(candidate)) {
    return candidate
  }

  if (isHarnessRelativeEvidencePath(candidate)) {
    return path.join(installationRoot, candidate)
  }

  return path.join(workspaceRoot, candidate)
}

export function resolveWorkspaceRelativeFilePath(
  installationRoot: string,
  workspaceRoot: string,
  relativePath: string,
): string {
  const trimmed = relativePath.trim()

  if (path.isAbsolute(trimmed)) {
    return trimmed
  }

  if (isHarnessRelativeEvidencePath(trimmed)) {
    return path.join(installationRoot, trimmed)
  }

  return path.join(workspaceRoot, trimmed)
}

export function missingEvidencePath(
  input: HandlerInput,
  entry: unknown,
): string | null {
  if (typeof entry !== 'string') {
    return null
  }

  const candidate = evidencePathCandidate(entry)

  if (!candidate) {
    return null
  }

  const resolved = resolveEvidenceFilesystemPath(
    input.root,
    workspaceRootFromInput(input),
    entry,
  )

  return resolved && !fileExists(resolved) ? candidate : null
}

type GitCommandResult =
  | { ok: true; stdout: string }
  | { ok: false; error: string }

type GitDiffResult =
  | { ok: true; files: string[] }
  | { ok: false; error: string }

export function gitOutput(root: string, gitArgs: string[]): GitCommandResult {
  const result = spawnSync('git', gitArgs, {
    cwd: root,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  })

  if (result.error) {
    return { ok: false, error: result.error.message }
  }

  if (result.status !== 0) {
    return {
      ok: false,
      error: (
        result.stderr ||
        result.stdout ||
        `git exited ${result.status}`
      ).trim(),
    }
  }

  return { ok: true, stdout: result.stdout.trim() }
}

export function gitChangedFiles(root: string): GitDiffResult {
  const files = new Set<string>()

  const tracked = gitOutput(root, [
    'diff',
    '--name-only',
    'HEAD',
    '--diff-filter=ACMR',
  ])

  if (!tracked.ok) {
    return { ok: false, error: tracked.error }
  }

  for (const file of tracked.stdout.split('\n').filter(Boolean)) {
    files.add(file)
  }

  const untracked = gitOutput(root, [
    'ls-files',
    '--others',
    '--exclude-standard',
  ])

  if (!untracked.ok) {
    return { ok: false, error: untracked.error }
  }

  for (const file of untracked.stdout.split('\n').filter(Boolean)) {
    files.add(file)
  }

  return { ok: true, files: [...files] }
}

export function isSpotfixDiffExempt(file: string): boolean {
  if (file.endsWith('.md') || file.endsWith('.mdc')) {
    return true
  }

  if (file.startsWith('docs/') || file.startsWith('tests/')) {
    return true
  }

  if (path.basename(file).includes('.test.')) {
    return true
  }

  if (file.startsWith('.cursor/')) {
    return true
  }

  return false
}

function isHarnessBookkeepingPath(file: string): boolean {
  return (
    file.startsWith('runtime/') ||
    file.endsWith('/.lock') ||
    file.endsWith('/.operation-mutex') ||
    file.includes('/validations/')
  )
}

export function workspaceSourceChanges(root: string): GitDiffResult {
  const diff = gitChangedFiles(root)

  if (!diff.ok) {
    return diff
  }

  return {
    ok: true,
    files: diff.files.filter((file) => !isHarnessBookkeepingPath(file)),
  }
}

/**
 * Paths this attempt changed, measured against the snapshot taken when its own
 * invocation was prepared.
 *
 * `changed_files` describes one attempt's work, so comparing it against the
 * cumulative `git diff HEAD` charged every attempt with the whole run's
 * accumulated diff — including files earlier attempts touched and files the run
 * never touched at all. Returns null when the invocation carries no comparable
 * snapshot, in which case the caller falls back to the cumulative diff.
 */
export function attemptChangedPaths(
  input: HandlerInput,
  workspaceRoot: string,
): string[] | null {
  const invocation = input.invocation

  if (!isRecord(invocation) || !isRecord(invocation.workspace_before)) {
    return null
  }

  const before = invocation.workspace_before as unknown as WorkspaceSnapshot

  if (before.kind !== 'git' || !Array.isArray(before.entries)) {
    return null
  }

  try {
    const after = gitWorkspaceSnapshot(workspaceRoot)

    return workspaceChangedPathsFromSnapshots(before, after).filter(
      (file) => !isHarnessBookkeepingPath(file),
    )
  } catch {
    return null
  }
}

export interface TestsAddedEntry {
  /** The entry as submitted, for messages. */
  raw: string
  /** File portion of the entry. */
  file: string
  contract?: string
}

/**
 * Parse one `tests_added` entry. A bare string is the legacy `<path>` or
 * `<path>::<case>` form and parses as `{ path }` without a contract. An
 * object carries `path` and an optional `contract`.
 */
export function parseTestsAddedEntry(entry: unknown): TestsAddedEntry | null {
  if (typeof entry === 'string') {
    return { raw: entry, file: testFilePortion(entry) }
  }

  if (
    isRecord(entry) &&
    typeof entry.path === 'string' &&
    (entry.contract === undefined || typeof entry.contract === 'string')
  ) {
    return {
      raw: entry.path,
      file: testFilePortion(entry.path),
      ...(typeof entry.contract === 'string'
        ? { contract: entry.contract }
        : {}),
    }
  }

  return null
}

/**
 * An entry names a test file, optionally followed by '::<case name>' in native
 * pytest/Jest notation or the spaced display form ' :: <case>'. Both resolve
 * to the same file: only the file portion resolves against the workspace.
 */
function testFilePortion(entry: string): string {
  return entry.split(/\s*::\s*/u)[0].trim()
}

const TEST_FILE_PATTERN =
  /(?:^|\/)(?:[^/]+\.(?:test|spec)\.[^/]+|test_[^/]+\.py|[^/]+_test\.(?:py|go))$/u

/** JavaScript/TypeScript `test(`/`it(` call sites and Python `def test_`. */
function countTestCallSites(source: string): number {
  const matches = source.match(
    /^[ \t]*(?:(?:test|it)(?:\.\w+)*\s*\(|(?:async\s+)?def\s+test_\w+\s*\()/gmu,
  )

  return matches?.length ?? 0
}

export interface TestDelta {
  path: string
  kind: 'new_file' | 'net_positive'
  count: number
}

/**
 * The attempt's observable test delta: new `*.test.*` files and changed test
 * files whose `test(`/`it(` call-site count rose against `HEAD`. Measured over
 * the paths this attempt changed (the invocation `workspace_before` snapshot),
 * falling back to the cumulative working-tree diff when no snapshot exists.
 * A filesystem workspace or an unavailable Git leaves the delta unobservable
 * and reports nothing; the caller has already failed closed on Git errors.
 */
export function attemptTestDelta(
  input: HandlerInput,
  workspaceRoot: string,
  precomputed: {
    /** This attempt's changed paths, when the caller already snapshotted them. */
    attemptFiles?: string[] | null
    /** The cumulative workspace diff, when the caller already ran it. */
    diff?: ReturnType<typeof workspaceSourceChanges>
  } = {},
): TestDelta[] {
  const workspaceBefore =
    isRecord(input.invocation) && isRecord(input.invocation.workspace_before)
      ? input.invocation.workspace_before
      : null

  if (workspaceBefore?.kind === 'filesystem') {
    return []
  }

  let changed =
    precomputed.attemptFiles !== undefined
      ? precomputed.attemptFiles
      : attemptChangedPaths(input, workspaceRoot)

  if (changed === null) {
    const diff = precomputed.diff ?? workspaceSourceChanges(workspaceRoot)

    if (!diff.ok) {
      return []
    }

    changed = diff.files
  }

  const deltas: TestDelta[] = []

  for (const relativePath of [...new Set(changed)].sort()) {
    if (!TEST_FILE_PATTERN.test(relativePath)) {
      continue
    }

    const absolute = path.join(workspaceRoot, relativePath)

    if (!fileExists(absolute)) {
      continue
    }

    const current = countTestCallSites(readFileSync(absolute, 'utf8'))
    const head = gitOutput(workspaceRoot, ['show', `HEAD:${relativePath}`])

    if (!head.ok) {
      // Not in HEAD: a new file. Zero call sites means no test was added.
      if (current > 0) {
        deltas.push({ path: relativePath, kind: 'new_file', count: current })
      }

      continue
    }

    const net = current - countTestCallSites(head.stdout)

    if (net > 0) {
      deltas.push({ path: relativePath, kind: 'net_positive', count: net })
    }
  }

  return deltas
}

export function gitUnavailableIssue(
  error: string,
): HandlerResult['issues'][number] {
  return issue(
    'git.unavailable',
    `Git-backed validation failed closed: ${error}`,
  )
}

export function issue(
  code: string,
  message: string,
): HandlerResult['issues'][number] {
  return { code, message }
}

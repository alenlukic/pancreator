import { createHash, randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import { errorMessage, invariant, isNodeError, PanError } from './errors.js'

function isPathWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)

  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  )
}

function resolveCanonicalBoundaryPath(targetPath: string): string {
  if (fileExists(targetPath)) {
    return canonicalize(targetPath)
  }

  let ancestor = targetPath

  while (!fileExists(ancestor)) {
    const parent = path.dirname(ancestor)

    invariant(parent !== ancestor, 'Path escapes repository root.', {
      code: 'PATH_ESCAPE',
    })
    ancestor = parent
  }

  const canonicalAncestor = canonicalize(ancestor)
  const remainder = path.relative(ancestor, targetPath)

  return path.resolve(canonicalAncestor, remainder)
}

/** True when `candidate` is a Pancreator installation root. */
export function isPancreatorRoot(candidate: string): boolean {
  const packagePath = path.join(candidate, 'package.json')

  if (!existsSync(packagePath)) {
    return false
  }

  try {
    const packageValue: unknown = JSON.parse(readFileSync(packagePath, 'utf8'))

    return (
      isRecord(packageValue) && packageValue.name === 'pancreator-v2-prototype'
    )
  } catch {
    // Validation reports malformed package files after root discovery.
    return false
  }
}

/**
 * The Pancreator installation root: `PANCREATOR_ROOT` when set, otherwise the
 * nearest ancestor of `start` that is an installation root. Throws
 * `ROOT_NOT_FOUND` when the override is not an installation or no ancestor
 * qualifies.
 */
export function findProjectRoot(start = process.cwd()): string {
  // A detached installation lives outside the target tree, so walking up from
  // the working directory can never reach it. PANCREATOR_ROOT is the explicit
  // override; `bin/pan` sets its own root from BASH_SOURCE, so this matters
  // when the CLI is invoked directly from inside a target repository.
  const configuredRoot = process.env.PANCREATOR_ROOT

  if (configuredRoot && configuredRoot.length > 0) {
    const resolved = path.resolve(configuredRoot)

    if (!isPancreatorRoot(resolved)) {
      throw new PanError(
        `PANCREATOR_ROOT is not a Pancreator installation: ${resolved}`,
        { code: 'ROOT_NOT_FOUND', details: { start, configuredRoot } },
      )
    }

    return resolved
  }

  let current = path.resolve(start)

  while (true) {
    if (isPancreatorRoot(current)) {
      return current
    }

    const parent = path.dirname(current)

    if (parent === current) {
      throw new PanError('Could not locate the Pancreator repository root.', {
        code: 'ROOT_NOT_FOUND',
        details: { start },
      })
    }

    current = parent
  }
}

/** Creates the directory and any missing parents; a no-op when it exists. */
export function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true })
}

/** Reads and parses a JSON file. Throws `INVALID_JSON` when it cannot be read or parsed. */
export function readJson(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as unknown
  } catch (error) {
    throw new PanError(`Failed to read JSON: ${filePath}`, {
      code: 'INVALID_JSON',
      details: { cause: errorMessage(error) },
    })
  }
}

/** Reads a file as UTF-8. Throws `READ_FAILED` when it cannot be read. */
export function readText(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8')
  } catch (error) {
    throw new PanError(`Failed to read file: ${filePath}`, {
      code: 'READ_FAILED',
      details: { cause: errorMessage(error) },
    })
  }
}

/**
 * Writes pretty-printed JSON with a trailing newline through a temporary file
 * and rename, so readers never see a partial file. Creates parent directories.
 */
export function writeJsonAtomic(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath))

  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(tempPath, filePath)
}

/**
 * Writes text, adding a trailing newline when missing, through a temporary
 * file and rename. Creates parent directories.
 */
export function writeTextAtomic(filePath: string, value: string): void {
  ensureDir(path.dirname(filePath))

  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(tempPath, value.endsWith('\n') ? value : `${value}\n`, 'utf8')
  renameSync(tempPath, filePath)
}

/** Appends one compact JSON line to a file, creating the file and its parent directories when missing. Not atomic across writers. */
export function appendJsonLine(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath))
  appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8')
}

/**
 * Hex SHA-256 digest. Strings and bytes are hashed as-is; any other value is
 * hashed through `stableStringify`, so key order never changes the digest.
 */
export function sha256(value: unknown): string {
  const input =
    typeof value === 'string' || value instanceof Uint8Array
      ? value
      : stableStringify(value)

  return createHash('sha256').update(input).digest('hex')
}

/**
 * Digest of a referenced document on the one basis every audited reference
 * states: SHA-256 of the text after leading and trailing whitespace is
 * trimmed. The card's context reference, a child specification's parent
 * reference, and the validator that compares them must share this rule, or
 * identical content reports as drift because of a trailing newline.
 */
export function referenceContentSha256(text: string): string {
  return sha256(text.trim())
}

/**
 * Compact JSON with object keys sorted at every depth, for deterministic
 * hashing. Returns `undefined` as text for a value JSON cannot represent.
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }

  return JSON.stringify(value) ?? 'undefined'
}

/**
 * Converts an absolute or root-relative path to a slash-separated path
 * relative to the canonical root. Throws `PATH_ESCAPE` when the path, after
 * resolving symlinks of its existing part, is the root itself or lies outside
 * it.
 */
export function toRepoRelative(
  root: string,
  absoluteOrRelativePath: string,
): string {
  const canonicalRoot = canonicalize(root)
  const absolute = path.isAbsolute(absoluteOrRelativePath)
    ? path.resolve(absoluteOrRelativePath)
    : path.resolve(canonicalRoot, absoluteOrRelativePath)
  const boundaryPath = resolveCanonicalBoundaryPath(absolute)

  invariant(
    isPathWithinRoot(canonicalRoot, boundaryPath),
    `Path must remain inside the repository: ${absoluteOrRelativePath}`,
    { code: 'PATH_ESCAPE' },
  )

  const relative = path.relative(canonicalRoot, absolute)

  invariant(
    relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative),
    `Path must remain inside the repository: ${absoluteOrRelativePath}`,
    { code: 'PATH_ESCAPE' },
  )

  return relative.split(path.sep).join('/')
}

/**
 * Resolves a relative path against the canonical root and returns the
 * absolute path. Throws `INVALID_PATH` for an empty path and `PATH_ESCAPE`
 * when the path or its symlink-resolved existing part leaves the root.
 */
export function resolveInside(root: string, relativePath: string): string {
  const canonicalRoot = canonicalize(root)

  invariant(
    relativePath.length > 0,
    'Expected a non-empty repository-relative path.',
    { code: 'INVALID_PATH' },
  )

  const absolute = path.resolve(canonicalRoot, relativePath)
  const relative = path.relative(canonicalRoot, absolute)

  invariant(
    !relative.startsWith('..') && !path.isAbsolute(relative),
    `Path escapes repository root: ${relativePath}`,
    { code: 'PATH_ESCAPE' },
  )
  invariant(
    isPathWithinRoot(canonicalRoot, resolveCanonicalBoundaryPath(absolute)),
    `Path escapes repository root: ${relativePath}`,
    { code: 'PATH_ESCAPE' },
  )

  return absolute
}

/** Absolute, symlink-resolved form of an existing path. Throws `PATH_NOT_FOUND` when it does not exist. */
export function canonicalize(filePath: string): string {
  const resolved = path.resolve(filePath)

  try {
    return realpathSync.native(resolved)
  } catch (error) {
    throw new PanError(`Failed to canonicalize path: ${filePath}`, {
      code: 'PATH_NOT_FOUND',
      details: { cause: errorMessage(error) },
    })
  }
}

/**
 * True when a process with this PID exists, probed with signal 0. A process
 * owned by another user (EPERM) counts as alive; a non-positive or
 * non-integer PID does not.
 */
export function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return isNodeError(error) && error.code === 'EPERM'
  }
}

/**
 * Deletes a mutex file whose recorded owner PID is not alive (or is
 * unreadable) and returns true; returns false when the file is absent or its
 * owner is alive.
 */
export function clearStaleOperationMutex(mutexPath: string): boolean {
  if (!existsSync(mutexPath)) {
    return false
  }

  let owner = Number.NaN

  try {
    owner = Number(readFileSync(mutexPath, 'utf8').trim())
  } catch {
    // A malformed mutex is stale.
  }

  if (processIsAlive(owner)) {
    return false
  }

  rmSync(mutexPath, { force: true })
  return true
}

/** The mutex is synchronous, so a waiting caller has no event loop to yield to. */
const MUTEX_SLEEP_SIGNAL = new Int32Array(new SharedArrayBuffer(4))

const MUTEX_POLL_MS = 20

export interface OperationMutexOptions {
  /**
   * How long to keep retrying a mutex a live process still holds.
   *
   * The default refuses immediately, because an operator command that waits
   * on another command reads as a hang. A caller whose work would otherwise
   * be lost — a detached probe that already paid for its live call — asks for
   * a bounded wait so the contended write queues instead of failing.
   */
  readonly waitForHolderMs?: number
}

/**
 * Runs the callback while holding a PID-stamped mutex file at `mutexPath`,
 * removing the mutex afterwards. A stale mutex is cleared once. A live holder
 * makes it throw `RUN_OPERATION_IN_PROGRESS` immediately, or after
 * `waitForHolderMs` of polling when that option is set.
 *
 * The wait blocks the thread synchronously, and the mutex is not reentrant.
 */
export function withOperationMutex<T>(
  mutexPath: string,
  callback: () => T,
  options: OperationMutexOptions = {},
): T {
  ensureDir(path.dirname(mutexPath))

  const candidatePath = `${mutexPath}.${process.pid}.${randomUUID()}.candidate`
  const deadline = Date.now() + Math.max(options.waitForHolderMs ?? 0, 0)
  let acquired = false
  // One clear per acquisition keeps two processes from clearing each other in
  // a loop. A holder that dies later is recovered by the next caller.
  let clearedStale = false

  writeFileSync(candidatePath, `${process.pid}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  })

  try {
    while (!acquired) {
      try {
        // A hard link publishes the complete owner record atomically. Another
        // thread can never observe the empty file window from open-then-write.
        linkSync(candidatePath, mutexPath)
        acquired = true
      } catch (error) {
        if (!clearedStale && clearStaleOperationMutex(mutexPath)) {
          clearedStale = true
          continue
        }

        if (Date.now() < deadline) {
          Atomics.wait(MUTEX_SLEEP_SIGNAL, 0, 0, MUTEX_POLL_MS)
          continue
        }

        let owner = Number.NaN

        try {
          owner = Number(readFileSync(mutexPath, 'utf8').trim())
        } catch {
          // Preserve NaN in diagnostics for an unreadable live mutex.
        }

        throw new PanError(
          `Another Pancreator command is updating this run: ${mutexPath}`,
          {
            code: 'RUN_OPERATION_IN_PROGRESS',
            details: { owner_pid: owner, cause: errorMessage(error) },
          },
        )
      }
    }
  } finally {
    rmSync(candidatePath, { force: true })
  }

  invariant(acquired, `Failed to serialize run operation: ${mutexPath}`, {
    code: 'RUN_OPERATION_SERIALIZATION_FAILED',
  })

  try {
    return callback()
  } finally {
    rmSync(mutexPath, { force: true })
  }
}

/** True when anything exists at the path, including a directory. */
export function fileExists(filePath: string): boolean {
  return existsSync(filePath)
}

/** True when the path exists and is a regular file (following symlinks). */
export function isFile(filePath: string): boolean {
  return existsSync(filePath) && statSync(filePath).isFile()
}

/** True when the path exists and is a directory (following symlinks). */
export function isDirectory(filePath: string): boolean {
  return existsSync(filePath) && statSync(filePath).isDirectory()
}

/** Type guard: true for a non-null, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Verbatim last content line of a text, or '' when none exists. Skips empty
 * lines and Markdown divider lines (`---`, `***`, `___`).
 */
export function lastEvidenceLine(content: string): string {
  const divider = /^\s*(?:[-_*]\s*){3,}$/u
  const lines = content.split('\n')

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]

    if (line.trim().length > 0 && !divider.test(line)) {
      return line
    }
  }

  return ''
}

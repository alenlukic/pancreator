/**
 * One fixture template per suite run, shared by the run's test processes.
 *
 * A template costs seconds to build and the runner starts one process per
 * test file, so a per-process cache charged the suite one build per file: 129
 * builds and 204 seconds of a 287-second run, and a direct penalty for
 * splitting any file. A template now lives under the scratch directory
 * `bin/run-tests` exports. The first process to ask for a key builds it under
 * a lock, publishes it with a rename, and every other process waits and then
 * clones what it built. The run directory carries the cache away at exit.
 *
 * A test file executed outside that wrapper has no run directory. The cache
 * is then unavailable and the caller keeps its own per-process build.
 */
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

/** A checkpoint chain is the slowest template and takes about a minute. */
const LOCK_TIMEOUT_MS = 600_000
const POLL_INTERVAL_MS = 20

// Atomics.wait is the only sleep available to synchronous fixture code, which
// is how every test in this suite builds its fixtures.
const SLEEP_SIGNAL = new Int32Array(new SharedArrayBuffer(4))

export interface SharedTemplate<Metadata> {
  /** The published template. Callers clone it; they never use it in place. */
  path: string
  metadata: Metadata
}

interface Envelope<Metadata> {
  schema_version: 1
  key: string
  metadata: Metadata
}

function sleep(milliseconds: number): void {
  Atomics.wait(SLEEP_SIGNAL, 0, 0, milliseconds)
}

/** The run-wide cache directory, or null outside `bin/run-tests`. */
function cacheRoot(): string | null {
  const runDirectory = process.env.PANCREATOR_TEST_TMP

  if (!runDirectory || runDirectory.length === 0) {
    return null
  }

  const root = path.join(runDirectory, 'templates')

  mkdirSync(root, { recursive: true })

  return root
}

/** A filesystem-safe name that still reads as the key that produced it. */
export function templateName(key: string): string {
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 12)
  const slug = key
    .replace(/[^a-zA-Z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48)

  return `${slug === '' ? 'template' : slug}-${digest}`
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch (error: unknown) {
    // A process owned by another user answers EPERM, which still proves it
    // exists. Only ESRCH proves it is gone.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function readPublished<Metadata>(
  metadataPath: string,
): Envelope<Metadata> | null {
  try {
    return JSON.parse(readFileSync(metadataPath, 'utf8')) as Envelope<Metadata>
  } catch {
    return null
  }
}

function acquire(lockPath: string): boolean {
  try {
    mkdirSync(lockPath)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false
    }

    throw error
  }

  writeFileSync(path.join(lockPath, 'owner'), `${process.pid}\n`)

  return true
}

/**
 * Whether the builder holding the lock still exists. A lock whose owner file
 * is not written yet counts as held, because the holder is milliseconds old;
 * the caller's deadline covers a holder that dies inside that window.
 */
function lockHolderIsAlive(lockPath: string): boolean {
  let owner: string

  try {
    owner = readFileSync(path.join(lockPath, 'owner'), 'utf8')
  } catch {
    return existsSync(lockPath)
  }

  const pid = Number.parseInt(owner.trim(), 10)

  return Number.isNaN(pid) ? existsSync(lockPath) : processIsAlive(pid)
}

function publish<Metadata>(
  root: string,
  name: string,
  key: string,
  build: (destination: string) => Metadata,
): Metadata {
  const templatePath = path.join(root, name)
  const metadataPath = path.join(root, `${name}.json`)
  const staging = path.join(root, `.staging-${name}-${process.pid}`)

  rmSync(staging, { recursive: true, force: true })

  let metadata: Metadata

  try {
    metadata = build(staging)
  } catch (error: unknown) {
    rmSync(staging, { recursive: true, force: true })

    throw error
  }

  if (!existsSync(staging)) {
    throw new Error(
      `shared template "${key}" did not create its destination ${staging}`,
    )
  }

  // The template appears under its published name in one rename, so no
  // process can clone a half-written tree. A leftover from a builder that
  // died under the lock is discarded rather than merged into this one.
  rmSync(templatePath, { recursive: true, force: true })
  renameSync(staging, templatePath)

  const metadataStaging = `${metadataPath}.${process.pid}`
  const envelope: Envelope<Metadata> = { schema_version: 1, key, metadata }

  writeFileSync(metadataStaging, `${JSON.stringify(envelope, null, 2)}\n`)
  renameSync(metadataStaging, metadataPath)

  return metadata
}

/**
 * The template for `key`, built once for the whole suite run.
 *
 * `build` receives a path that does not exist yet and must create it, either
 * by populating a new directory or by renaming a tree it built elsewhere into
 * that path. It returns whatever the caller must recover alongside the tree,
 * such as the run id a driven fixture holds. Returns null when this process
 * has no run directory, which tells the caller to build its own copy.
 */
export function sharedTemplate<Metadata>(
  key: string,
  build: (destination: string) => Metadata,
): SharedTemplate<Metadata> | null {
  const root = cacheRoot()

  if (root === null) {
    return null
  }

  const name = templateName(key)
  const templatePath = path.join(root, name)
  const metadataPath = path.join(root, `${name}.json`)
  const lockPath = path.join(root, `${name}.lock`)
  const deadline = Date.now() + LOCK_TIMEOUT_MS

  while (Date.now() < deadline) {
    const published = readPublished<Metadata>(metadataPath)

    if (published !== null) {
      return { path: templatePath, metadata: published.metadata }
    }

    if (!acquire(lockPath)) {
      if (lockHolderIsAlive(lockPath)) {
        sleep(POLL_INTERVAL_MS)
      } else {
        // The builder died under the lock. Reclaim it and build instead of
        // waiting for a process that will never publish.
        rmSync(lockPath, { recursive: true, force: true })
      }

      continue
    }

    try {
      const raced = readPublished<Metadata>(metadataPath)

      if (raced !== null) {
        return { path: templatePath, metadata: raced.metadata }
      }

      return { path: templatePath, metadata: publish(root, name, key, build) }
    } finally {
      rmSync(lockPath, { recursive: true, force: true })
    }
  }

  process.stderr.write(
    `[shared-template] timed out waiting for "${key}"; building it in this process instead\n`,
  )

  return null
}

/**
 * Helper client: source-digest-keyed compilation, spawn, and the line
 * protocol for communicating with `cursor-handoff.swift --serve`.
 *
 * The helper ships as Swift source at `src/native/cursor-handoff.swift` and
 * is compiled on first use into
 * `runtime/cache/native/cursor-handoff-<16 hex of sha256>` through a
 * temporary file and an atomic rename.
 *
 * This module never reads or edits the compiled binary directly. It compiles
 * through swiftc and communicates via stdin/stdout JSON lines.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, renameSync, unlinkSync } from 'node:fs'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

import { PanError } from '../errors.js'
import { fileExists, readText } from '../io.js'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Harness-relative path of the Swift source. */
export const SWIFT_SOURCE_RELATIVE = 'src/native/cursor-handoff.swift'

/** The cache directory for compiled helpers (harness-relative). */
const NATIVE_CACHE_RELATIVE = 'runtime/cache/native'

/**
 * Harness-relative path of the compiled helper for a given source SHA-256.
 * Only the first 16 hex characters are used in the filename.
 */
export function helperBinaryRelative(sourceDigest: string): string {
  return path.posix.join(
    NATIVE_CACHE_RELATIVE,
    `cursor-handoff-${sourceDigest.slice(0, 16)}`,
  )
}

// ---------------------------------------------------------------------------
// Platform check
// ---------------------------------------------------------------------------

/** True when the platform (the current process's by default) is macOS. */
export function isMacOS(platform = process.platform): boolean {
  return platform === 'darwin'
}

// ---------------------------------------------------------------------------
// Source digest
// ---------------------------------------------------------------------------

/**
 * SHA-256 of the Swift source text. Used to detect source changes that
 * require a rebuild.
 */
export function swiftSourceDigest(root: string): string {
  const sourcePath = path.join(root, SWIFT_SOURCE_RELATIVE)
  const text = readText(sourcePath)
  return createHash('sha256').update(text).digest('hex')
}

// ---------------------------------------------------------------------------
// swiftc discovery
// ---------------------------------------------------------------------------

/**
 * Locate `swiftc`: try `xcrun --find swiftc`, then search PATH.
 * Returns the absolute path, or `null` when not found.
 */
export function findSwiftc(): string | null {
  // Try xcrun first
  const xcrun = spawnSync('xcrun', ['--find', 'swiftc'], {
    encoding: 'utf8',
    timeout: 10_000,
  })

  if (xcrun.status === 0) {
    const found = xcrun.stdout.trim()
    if (found.length > 0 && fileExists(found)) {
      return found
    }
  }

  // Fall back to which
  const which = spawnSync('which', ['swiftc'], {
    encoding: 'utf8',
    timeout: 5_000,
  })

  if (which.status === 0) {
    const found = which.stdout.trim()
    if (found.length > 0 && fileExists(found)) {
      return found
    }
  }

  return null
}

/**
 * The macOS SDK path, or `null` when `xcrun` cannot report one. The swiftc
 * that `xcrun --find` returns cannot load the standard library without it
 * when invoked directly.
 */
function macSdkPath(): string | null {
  const result = spawnSync('xcrun', ['--show-sdk-path'], {
    encoding: 'utf8',
    timeout: 10_000,
  })
  const found = result.status === 0 ? result.stdout.trim() : ''

  return found.length > 0 ? found : null
}

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

/**
 * Compile the Swift source and return the path to the binary. Writes to a
 * temporary file and atomically renames into the cache path.
 *
 * Throws with code `HANDOFF_HELPER_BUILD_FAILED` when compilation fails.
 */
export function compileHelper(
  root: string,
  swiftcPath: string,
  digest: string,
): string {
  const sourcePath = path.join(root, SWIFT_SOURCE_RELATIVE)
  const cacheDir = path.join(root, NATIVE_CACHE_RELATIVE)
  const binaryPath = path.join(root, helperBinaryRelative(digest))
  const tmpPath = `${binaryPath}.tmp.${process.pid}`

  mkdirSync(cacheDir, { recursive: true })

  const sdk = macSdkPath()
  const result = spawnSync(
    swiftcPath,
    [...(sdk === null ? [] : ['-sdk', sdk]), '-O', '-o', tmpPath, sourcePath],
    { encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
  )

  if (result.status !== 0) {
    try {
      if (fileExists(tmpPath)) {
        unlinkSync(tmpPath)
      }
    } catch {
      // best effort
    }

    throw new PanError(
      `swiftc failed (exit ${String(result.status ?? 'null')}):\n${result.stderr}`,
      { code: 'HANDOFF_HELPER_BUILD_FAILED' },
    )
  }

  renameSync(tmpPath, binaryPath)
  return binaryPath
}

// ---------------------------------------------------------------------------
// Live bridge protocol
// ---------------------------------------------------------------------------

export type HelperReply = Record<string, unknown>

/**
 * A single open helper process. Dispose with `close()`.
 */
export interface HelperSession {
  /**
   * Send one JSON request and receive one JSON reply. Returns the parsed
   * reply or rejects on timeout, helper exit, or protocol error.
   */
  send(request: Record<string, unknown>): Promise<HelperReply>
  /**
   * End the session. The helper restores `AXManualAccessibility` when its
   * stdin closes, so it gets a grace period to exit before SIGTERM.
   */
  close(): Promise<void>
}

/** How long one request may wait for its reply. */
const REPLY_TIMEOUT_MS = 10_000

/** How long `close()` waits for the helper to exit on stdin EOF. */
const EXIT_GRACE_MS = 2_000

function protocolError(message: string): PanError {
  return new PanError(message, { code: 'HANDOFF_HELPER_PROTOCOL' })
}

interface PendingReply {
  onLine: (line: string) => void
  onExit: (error: PanError) => void
}

/**
 * Spawn the helper in `--serve` mode and return a session handle.
 *
 * The helper reads one JSON request per line on stdin and writes one JSON
 * reply per line on stdout. This function never shells out; it passes the
 * binary path directly as the executable.
 */
export function spawnHelperSession(binaryPath: string): HelperSession {
  const child = spawn(binaryPath, ['--serve'], {
    stdio: ['pipe', 'pipe', 'inherit'],
  })

  const rl = createInterface({ input: child.stdout! })
  const pending: PendingReply[] = []
  let exited = false

  const exitPromise = new Promise<void>((resolve) => {
    const settle = (error: PanError): void => {
      exited = true

      for (const waiter of pending.splice(0)) {
        waiter.onExit(error)
      }

      resolve()
    }

    child.once('exit', (code, signal) => {
      settle(
        protocolError(
          `Helper exited (code ${String(code)}, signal ${String(signal)}).`,
        ),
      )
    })
    child.once('error', (error) => {
      settle(protocolError(`Helper failed to start: ${error.message}`))
    })
  })

  rl.on('line', (line) => {
    pending.shift()?.onLine(line)
  })

  function send(request: Record<string, unknown>): Promise<HelperReply> {
    if (exited) {
      return Promise.reject(protocolError('Helper is no longer running.'))
    }

    return new Promise((resolve, reject) => {
      const waiter: PendingReply = {
        onLine: (line) => {
          clearTimeout(timeoutId)

          try {
            resolve(JSON.parse(line) as HelperReply)
          } catch {
            reject(protocolError(`Malformed helper reply: ${line}`))
          }
        },
        onExit: (error) => {
          clearTimeout(timeoutId)
          reject(error)
        },
      }
      const timeoutId = setTimeout(() => {
        const index = pending.indexOf(waiter)

        if (index !== -1) {
          pending.splice(index, 1)
        }

        reject(protocolError('Helper response timeout.'))
      }, REPLY_TIMEOUT_MS)

      pending.push(waiter)
      child.stdin!.write(`${JSON.stringify(request)}\n`)
    })
  }

  async function close(): Promise<void> {
    rl.close()
    child.stdin?.end()

    if (exited) {
      return
    }

    let graceTimer: NodeJS.Timeout | undefined
    const grace = new Promise<'grace_expired'>((resolve) => {
      graceTimer = setTimeout(() => resolve('grace_expired'), EXIT_GRACE_MS)
    })
    const outcome = await Promise.race([exitPromise, grace])

    clearTimeout(graceTimer)

    if (outcome === 'grace_expired') {
      child.kill('SIGTERM')
    }
  }

  return { send, close }
}

// ---------------------------------------------------------------------------
// High-level: ensure helper is built and ready
// ---------------------------------------------------------------------------

export interface HelperReadyResult {
  /** Absolute path to the binary. */
  binaryPath: string
  /** Source digest (full 64-char hex). */
  digest: string
  /** Whether the binary was compiled during this call. */
  compiled: boolean
}

/**
 * Ensure the helper binary exists for the current source. Compiles on first
 * use or when the source has changed. Returns the binary path and digest.
 *
 * Throws with code `HANDOFF_UNSUPPORTED_PLATFORM` on non-macOS.
 * Throws with code `HANDOFF_HELPER_UNAVAILABLE` when swiftc is absent and
 * no pre-built binary exists.
 * Throws with code `HANDOFF_HELPER_BUILD_FAILED` when compilation fails.
 */
export function ensureHelper(
  root: string,
  options: { platform?: string; swiftcPath?: string | null } = {},
): HelperReadyResult {
  const platform = options.platform ?? process.platform

  if (platform !== 'darwin') {
    throw new PanError('pan handoff is supported on macOS only.', {
      code: 'HANDOFF_UNSUPPORTED_PLATFORM',
    })
  }

  const digest = swiftSourceDigest(root)
  const binaryRelative = helperBinaryRelative(digest)
  const binaryPath = path.join(root, binaryRelative)

  if (fileExists(binaryPath)) {
    return { binaryPath, digest, compiled: false }
  }

  const swiftc =
    options.swiftcPath === undefined ? findSwiftc() : options.swiftcPath

  if (swiftc === null) {
    throw new PanError(
      'No compiled helper and no swiftc. Install the Xcode Command Line Tools.',
      { code: 'HANDOFF_HELPER_UNAVAILABLE' },
    )
  }

  const compiled = compileHelper(root, swiftc, digest)
  return { binaryPath: compiled, digest, compiled: true }
}

// ---------------------------------------------------------------------------
// Preflight (for pan doctor — never compiles)
// ---------------------------------------------------------------------------

export interface HelperPreflightResult {
  platform_supported: boolean
  swiftc_path: string | null
  /** First 16 hex chars of the current Swift source digest, or null. */
  source_digest: string | null
  /** Whether the compiled binary for the current source exists. */
  binary_built: boolean
  /** Harness-relative binary path when built, else null. */
  binary_path: string | null
}

/**
 * Non-failing preflight check that doctor can call. Never compiles; never
 * changes state.
 */
export function helperPreflight(
  root: string,
  options: { platform?: string } = {},
): HelperPreflightResult {
  const platform = options.platform ?? process.platform

  if (platform !== 'darwin') {
    return {
      platform_supported: false,
      swiftc_path: null,
      source_digest: null,
      binary_built: false,
      binary_path: null,
    }
  }

  let digest: string | null = null
  let binaryBuilt = false
  let binaryPath: string | null = null

  try {
    digest = swiftSourceDigest(root)
    const rel = helperBinaryRelative(digest)
    const abs = path.join(root, rel)
    binaryBuilt = fileExists(abs)
    binaryPath = binaryBuilt ? rel : null
  } catch {
    // Swift source missing or unreadable
  }

  return {
    platform_supported: true,
    swiftc_path: findSwiftc(),
    source_digest: digest !== null ? digest.slice(0, 16) : null,
    binary_built: binaryBuilt,
    binary_path: binaryPath,
  }
}

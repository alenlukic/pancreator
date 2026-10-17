import {
  accessSync,
  constants,
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Bound where a spawned agent may write, at the operating system rather than
 * in the harness record.
 *
 * An unattended prompt task is granted a small set of roots. Nothing in the
 * agent protocol keeps a shell command the model writes inside them, and a
 * before-and-after snapshot of the harness root cannot separate this agent's
 * writes from a concurrent run's, nor observe a tree large enough to cost
 * more than the task. Denying the write is the only control that holds
 * without either compromise.
 *
 * The profile allows everything else the agent already had, and denies only
 * writes outside the granted roots and the locations an agent process needs
 * for its own state.
 */

const SANDBOX_BINARY = '/usr/bin/sandbox-exec'

/** Operator escape hatch: `0` disables enforcement and names the reason. */
export const WRITE_SANDBOX_ENV = 'PANCREATOR_WRITE_SANDBOX'

export interface PreparedLaunch {
  binary: string
  argv: string[]
  /** Release the profile file, if one was written. Always safe to call. */
  cleanup: () => void
}

export interface WriteSandbox {
  /** `sandbox-exec` when the write boundary is enforced, `none` otherwise. */
  mode: 'sandbox-exec' | 'none'
  /** Why enforcement is unavailable. Empty when it is enforced. */
  reason: string
  writeRoots: string[]
  effectiveWriteRoots: string[]
  wrap: (binary: string, argv: string[]) => PreparedLaunch
}

function quoted(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/**
 * Both the declared path and its resolved path. The sandbox matches the
 * resolved path, and a macOS fixture reaches the same directory through
 * `/tmp` and `/private/tmp`.
 */
function subpaths(directories: string[]): string[] {
  const resolved = new Set<string>()

  for (const directory of directories) {
    const absolute = path.resolve(directory)

    resolved.add(absolute)

    let ancestor = absolute
    while (!existsSync(ancestor) && path.dirname(ancestor) !== ancestor) {
      ancestor = path.dirname(ancestor)
    }
    resolved.add(
      path.resolve(realpathSync(ancestor), path.relative(ancestor, absolute)),
    )
  }

  return [...resolved].sort()
}

/**
 * Locations an agent process writes for itself rather than for its task:
 * its credential and session state, its caches, and the temporary directory
 * every child process expects.
 */
function agentStateRoots(): string[] {
  const home = homedir()

  return [
    tmpdir(),
    '/private/var/folders',
    '/private/var/tmp',
    '/private/tmp',
    '/dev',
    path.join(home, '.cursor'),
    path.join(home, '.config'),
    path.join(home, 'Library', 'Caches'),
    path.join(home, 'Library', 'Application Support'),
    path.join(home, 'Library', 'Logs'),
  ]
}

/**
 * Renders a macOS `sandbox-exec` profile that allows everything except file
 * writes, then re-allows writes under the given roots and the temporary,
 * device, and per-user state directories the agent needs. Strict collectors
 * receive only their roots and /dev/null; subprocess denial is opt-in.
 * Protected custody roots remain denied even when task writes are unrestricted.
 * The boolean argument form preserves the collector profile API.
 */
export function writeSandboxProfile(
  writeRoots: string[],
  protectedRootsOrStrict: string[] | boolean = [],
  enforceWritesOrDenySubprocesses?: boolean,
  options: { strict?: boolean; denySubprocesses?: boolean } = {},
): string {
  const protectedRoots = Array.isArray(protectedRootsOrStrict)
    ? protectedRootsOrStrict
    : []
  const strict =
    typeof protectedRootsOrStrict === 'boolean'
      ? protectedRootsOrStrict
      : (options.strict ?? false)
  const enforceWrites =
    typeof protectedRootsOrStrict === 'boolean'
      ? true
      : (enforceWritesOrDenySubprocesses ?? true)
  const denySubprocesses =
    typeof protectedRootsOrStrict === 'boolean'
      ? (enforceWritesOrDenySubprocesses ?? false)
      : (options.denySubprocesses ?? false)
  const allowed = [
    ...subpaths(writeRoots),
    ...(strict ? ['/dev/null'] : subpaths(agentStateRoots())),
  ]
  const protectedPaths = subpaths(protectedRoots)
  const ancestors = new Set<string>()
  for (const protectedPath of protectedPaths) {
    let ancestor = path.dirname(protectedPath)
    while (path.dirname(ancestor) !== ancestor) {
      ancestors.add(ancestor)
      ancestor = path.dirname(ancestor)
    }
  }

  return [
    '(version 1)',
    '(allow default)',
    ...(denySubprocesses ? ['(deny process-fork)'] : []),
    ...(enforceWrites
      ? [
          '(deny file-write*)',
          `(allow file-write* ${allowed
            .map((directory) => `(subpath ${quoted(directory)})`)
            .join(' ')})`,
        ]
      : []),
    ...protectedPaths.map(
      (directory) => `(deny file-write* (subpath ${quoted(directory)}))`,
    ),
    ...[...ancestors].map(
      (directory) => `(deny file-write-unlink (literal ${quoted(directory)}))`,
    ),
  ].join('\n')
}

export function custodyProtectionAvailable(): boolean {
  if (process.platform !== 'darwin') return false
  try {
    accessSync(SANDBOX_BINARY, constants.X_OK)
    return true
  } catch (error) {
    if (
      ['ENOENT', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')
    )
      return false
    throw error
  }
}

function unavailable(reason: string, writeRoots: string[]): WriteSandbox {
  return {
    mode: 'none',
    reason,
    writeRoots,
    effectiveWriteRoots: subpaths([...writeRoots, ...agentStateRoots()]),
    wrap: (binary, argv) => ({ binary, argv, cleanup: () => {} }),
  }
}

/**
 * The write boundary for one spawn. A caller that receives `none` MUST fall
 * back to observing the filesystem and MUST record the reason, because an
 * unenforced boundary that nobody records is the state this exists to end.
 */
export function resolveWriteSandbox(
  writeRoots: string[],
  protectedRootsOrOptions:
    | string[]
    | { strict?: boolean; denySubprocesses?: boolean } = [],
): WriteSandbox {
  const protectedRoots = Array.isArray(protectedRootsOrOptions)
    ? protectedRootsOrOptions
    : []
  const options = Array.isArray(protectedRootsOrOptions)
    ? {}
    : protectedRootsOrOptions
  if (!custodyProtectionAvailable()) {
    return unavailable(
      `Write enforcement needs executable macOS sandbox-exec; this host is ${process.platform}.`,
      writeRoots,
    )
  }

  const reason =
    process.env[WRITE_SANDBOX_ENV] === '0'
      ? `Disabled by ${WRITE_SANDBOX_ENV}=0.`
      : writeRoots.length === 0
        ? 'The caller granted no write roots to enforce.'
        : ''
  if (reason && protectedRoots.length === 0)
    return unavailable(reason, writeRoots)
  const profile = writeSandboxProfile(
    writeRoots,
    protectedRoots,
    reason === '',
    options,
  )

  return {
    mode: reason ? 'none' : 'sandbox-exec',
    reason,
    writeRoots,
    effectiveWriteRoots: subpaths([...writeRoots, ...agentStateRoots()]),
    // The profile travels in a file rather than in an argument. Endpoint
    // security on an operator machine kills an exec whose single argument
    // reaches a kilobyte, which a profile listing every granted root does.
    wrap: (binary, argv) => {
      const directory = mkdtempSync(path.join(tmpdir(), 'pan-write-sandbox-'))
      const profilePath = path.join(directory, 'profile.sb')

      writeFileSync(profilePath, `${profile}\n`)

      return {
        binary: SANDBOX_BINARY,
        argv: ['-f', profilePath, binary, ...argv],
        cleanup: () => {
          rmSync(directory, { recursive: true, force: true })
        },
      }
    },
  }
}

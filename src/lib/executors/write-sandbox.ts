import {
  accessSync,
  constants,
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

    try {
      resolved.add(realpathSync(absolute))
    } catch {
      // A granted root the task will create still belongs in the profile.
    }
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

export function writeSandboxProfile(writeRoots: string[]): string {
  const allowed = [...subpaths(writeRoots), ...subpaths(agentStateRoots())]

  return [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    `(allow file-write* ${allowed
      .map((directory) => `(subpath ${quoted(directory)})`)
      .join(' ')})`,
  ].join('\n')
}

function unavailable(reason: string, writeRoots: string[]): WriteSandbox {
  return {
    mode: 'none',
    reason,
    writeRoots,
    wrap: (binary, argv) => ({ binary, argv, cleanup: () => {} }),
  }
}

/**
 * The write boundary for one spawn. A caller that receives `none` MUST fall
 * back to observing the filesystem and MUST record the reason, because an
 * unenforced boundary that nobody records is the state this exists to end.
 */
export function resolveWriteSandbox(writeRoots: string[]): WriteSandbox {
  if (writeRoots.length === 0) {
    return unavailable('The caller granted no write roots to enforce.', [])
  }

  if (process.env[WRITE_SANDBOX_ENV] === '0') {
    return unavailable(`Disabled by ${WRITE_SANDBOX_ENV}=0.`, writeRoots)
  }

  if (process.platform !== 'darwin') {
    return unavailable(
      `Write enforcement needs macOS sandbox-exec; this host is ${process.platform}.`,
      writeRoots,
    )
  }

  try {
    accessSync(SANDBOX_BINARY, constants.X_OK)
  } catch {
    return unavailable(`${SANDBOX_BINARY} is not executable on this host.`, [
      ...writeRoots,
    ])
  }

  const profile = writeSandboxProfile(writeRoots)

  return {
    mode: 'sandbox-exec',
    reason: '',
    writeRoots,
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

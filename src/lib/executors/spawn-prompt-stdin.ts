import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns,
} from 'node:child_process'
import {
  closeSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Spawn with stdin from a file, never `spawnSync`'s `input` pipe. Node
 * writes that pipe to completion before it reaps the child. A governance
 * card exceeds the pipe buffer. A child that exits without reading stdin
 * then deadlocks the parent until timeout, and occupies a test worker for
 * the rest of the suite.
 */
export function spawnSyncWithStdinFile(
  binary: string,
  argv: readonly string[],
  options: SpawnSyncOptionsWithStringEncoding,
): SpawnSyncReturns<string> {
  const { input, ...spawnOptions } = options
  if (typeof input !== 'string') {
    return spawnSync(binary, argv, options)
  }

  const stdinDir = mkdtempSync(path.join(tmpdir(), 'pan-spawn-stdin-'))
  const promptPath = path.join(stdinDir, 'prompt')
  let stdinFd: number | undefined

  try {
    writeFileSync(promptPath, input, { mode: 0o600, flag: 'wx' })
    stdinFd = openSync(promptPath, 'r')
    // Keep only the open descriptor on Unix. A killed parent must not leave
    // a plaintext governance prompt behind in the temporary directory.
    if (process.platform !== 'win32') rmSync(promptPath)
    return spawnSync(binary, argv, {
      ...spawnOptions,
      stdio: [stdinFd, 'pipe', 'pipe'],
    })
  } finally {
    if (stdinFd !== undefined) {
      closeSync(stdinFd)
    }
    rmSync(stdinDir, { recursive: true, force: true })
  }
}

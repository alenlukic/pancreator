import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { isRecord } from '../../src/lib/io.js'

export const PAN_RUN = path.join(process.cwd(), 'bin', 'pan-run')
export const PROCESS_TIMEOUT_MS = 30_000

export function runEnv(
  root: string,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }

  // Surrounding diagnostics would change the captured streams.
  delete env.PAN_VERBOSE
  delete env.PAN_PROGRESS_FD
  delete env.PAN_RUN_HEARTBEAT_SECONDS
  delete env.PAN_RUN_LINE_WIDTH
  delete env.PAN_RUN_TAIL_LINES
  delete env.PAN_RUN_RECORD

  return { ...env, ...extra, PANCREATOR_ROOT: root }
}

export function runPanRun(
  args: string[],
  options: { root: string; env?: NodeJS.ProcessEnv; input?: string },
) {
  return spawnSync(PAN_RUN, args, {
    encoding: 'utf8',
    env: runEnv(options.root, options.env),
    input: options.input,
    timeout: PROCESS_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  })
}

/** Read and parse a JSON file, returning null on any error. */
export function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

export function findLatestLogDir(root: string): string | null {
  const shellLogsDir = path.join(root, 'runtime', 'logs', 'shell')

  if (!existsSync(shellLogsDir)) {
    return null
  }

  const dirs = readdirSync(shellLogsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()

  const last = dirs.at(-1)

  return last === undefined ? null : path.join(shellLogsDir, last)
}

export function readRecord(root: string): Record<string, unknown> {
  const dir = findLatestLogDir(root)

  assert.ok(dir, 'a shell log directory must exist')

  const record = readJsonFile(path.join(dir, 'record.json'))

  assert.ok(isRecord(record), 'record.json must be a JSON object')

  return record
}

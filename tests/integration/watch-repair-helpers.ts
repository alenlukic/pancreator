import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { watchRecordPath } from '../../src/lib/watch.js'

export const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

/** Run the real CLI against a fixture root and capture both channels. */
export function runCli(
  root: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
  })

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

/** Write one seeded ledger beside the invocation. */
export function seedLedger(
  root: string,
  runId: string,
  invocationId: string,
  entries: Array<Record<string, unknown>>,
): void {
  const ledger = path.join(root, watchRecordPath(root, runId, invocationId))

  mkdirSync(path.dirname(ledger), { recursive: true })
  writeFileSync(
    ledger,
    `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    'utf8',
  )
}

/** One schema-1 ledger entry with the fields every reader needs. */
export function ledgerEntry(
  runId: string,
  invocationId: string,
  event: string,
  recordedAt: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: 1,
    event,
    run_id: runId,
    invocation_id: invocationId,
    recorded_at: recordedAt,
    cadence_seconds: 60,
    wake: 0,
    ...extra,
  }
}

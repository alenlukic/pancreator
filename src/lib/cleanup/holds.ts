/** Liveness checks that hold a cleanup target its owner still uses. */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { isRecord } from '../io.js'

/** Marker `bin/pan-run` keeps in a record directory while its helper runs. */
const PAN_RUN_HELPER_MARKER = '.pan-run.cjs'

/** Whether a positive integer pid names a live process this user can signal. */
export function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Why a `bin/pan-run` record must stay untouched: its wrapper is still alive
 * before the exit, or still streaming output that outlived the command, or
 * its record is unreadable while the helper marker remains. Mirrors the
 * wrapper's own compaction judgment.
 */
export function shellRecordHold(target: string): string | null {
  let record: unknown = null

  try {
    record = JSON.parse(readFileSync(path.join(target, 'record.json'), 'utf8'))
  } catch {
    // An absent or partial record is judged by the helper marker below.
  }

  if (isRecord(record)) {
    const wrapperPid = Number(record.wrapper_pid)
    const running =
      (record.ended_at === null ||
        record.ended_at === undefined ||
        record.output_drained === false) &&
      processIsAlive(wrapperPid)

    return running ? `wrapper process ${wrapperPid} is still running` : null
  }

  return existsSync(path.join(target, PAN_RUN_HELPER_MARKER))
    ? 'record.json is unreadable while the pan-run helper marker remains'
    : null
}

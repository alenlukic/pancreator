/** Attributable blocking intervals, independent of terminal transport. */
import { appendJsonLine, fileExists, isRecord, readText } from '../io.js'

export interface BlockingReceipt {
  schema_version: 1
  ledger: string
  watch_session_id: string
  watcher_pid: number
  watcher_process_identity: string
  parent_pid: number
  parent_process_identity: string
  started_at: string
  ended_at: string
  result: string
}

export function validBlockingReceipt(value: unknown): value is BlockingReceipt {
  if (!isRecord(value)) return false
  return (
    value.schema_version === 1 &&
    [
      'ledger',
      'watch_session_id',
      'watcher_process_identity',
      'parent_process_identity',
      'result',
    ].every((key) => typeof value[key] === 'string' && value[key].length > 0) &&
    Number.isSafeInteger(value.watcher_pid) &&
    Number(value.watcher_pid) > 0 &&
    Number.isSafeInteger(value.parent_pid) &&
    Number(value.parent_pid) > 0 &&
    typeof value.started_at === 'string' &&
    typeof value.ended_at === 'string' &&
    Number.isFinite(Date.parse(value.started_at)) &&
    Number.isFinite(Date.parse(value.ended_at)) &&
    Date.parse(value.ended_at) >= Date.parse(value.started_at)
  )
}

export function appendBlockingReceipt(
  absoluteLedger: string,
  receipt: BlockingReceipt,
): void {
  if (!validBlockingReceipt(receipt))
    throw new Error('Invalid watch blocking receipt.')
  appendJsonLine(`${absoluteLedger}.blocking.jsonl`, receipt)
}

export function readBlockingReceipts(
  absoluteLedger: string,
): BlockingReceipt[] {
  const file = `${absoluteLedger}.blocking.jsonl`
  if (!fileExists(file)) return []
  return readText(file)
    .split('\n')
    .filter((line) => line.trim())
    .flatMap((line) => {
      const value: unknown = JSON.parse(line)
      if (!validBlockingReceipt(value))
        throw new Error(`Invalid watch blocking receipt: ${file}`)
      return [value]
    })
}

/**
 * Own `bin/pan-run` record discovery by Cursor conversation id and deterministic
 * record classification from heartbeat, process table, and output growth.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { isRecord } from '../io.js'

const RECORD_DIR_MS_PATTERN = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-/u

export type ShellRecordState =
  | 'exited'
  | 'dead'
  | 'stopped'
  | 'heartbeat_stale'
  | 'busy'
  | 'idle'
  | 'running'

export interface ProcessTableRow {
  pid: number
  ppid: number
  stat: string
  time: string
  lstart: string
}

export type ProcessTable = Map<number, ProcessTableRow>

export interface AgentShellRecord {
  record_path: string
  label: string | null
  pid: number | null
  wrapper_pid: number | null
  started_at: string | null
  ended_at: string | null
  exit_code: number | null
  parent_record: string | null
  cursor_conversation_id: string | null
  wrapper_process_identity: string | null
  heartbeat_seconds: number | null
  heartbeat_age_seconds: number | null
  log_bytes: number | null
  last_output_at: string | null
  silent_seconds: number | null
  process_state: ShellRecordState
  tree_cpu_seconds: number | null
}

function shellRecordDirectoryMs(name: string): number | null {
  const match = RECORD_DIR_MS_PATTERN.exec(name)

  if (!match) {
    return null
  }

  const [, y, mo, d, h, mi, s] = match

  return Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  )
}

function parseCpuTime(value: string): number | null {
  const trimmed = value.trim()

  if (trimmed.length === 0) {
    return null
  }

  const parts = trimmed.split(':')
  let seconds = 0

  if (parts.length === 3) {
    const [daysHours, minutes, secs] = parts
    const dayParts = daysHours.split('-')

    if (dayParts.length === 2) {
      seconds += Number(dayParts[0]) * 86_400
      seconds += Number(dayParts[1]) * 3600
    } else {
      seconds += Number(daysHours) * 3600
    }

    seconds += Number(minutes) * 60
    seconds += Number.parseFloat(secs)
  } else if (parts.length === 2) {
    seconds += Number(parts[0]) * 60
    seconds += Number.parseFloat(parts[1] ?? '0')
  } else {
    seconds += Number.parseFloat(trimmed)
  }

  return Number.isFinite(seconds) ? seconds : null
}

/** One `ps` sample for every process; null when the table is unreadable. */
export function sampleProcessTable(): ProcessTable | null {
  try {
    const result = spawnSync(
      'ps',
      [
        '-A',
        '-o',
        'pid=',
        '-o',
        'ppid=',
        '-o',
        'stat=',
        '-o',
        'time=',
        '-o',
        'lstart=',
      ],
      { encoding: 'utf8', timeout: 5_000, maxBuffer: 8 * 1024 * 1024 },
    )

    if (result.error || result.status !== 0) {
      return null
    }

    return parseProcessTable(result.stdout)
  } catch {
    return null
  }
}

/** Parse `ps -o pid=,ppid=,stat=,time=,lstart=` rows; `lstart` keeps the exact `ps` text. */
export function parseProcessTable(stdout: string): ProcessTable | null {
  const table: ProcessTable = new Map()

  for (const line of stdout.split('\n')) {
    const match = /^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/u.exec(line.trim())

    if (!match) {
      continue
    }

    table.set(Number(match[1]), {
      pid: Number(match[1]),
      ppid: Number(match[2]),
      stat: match[3],
      time: match[4],
      lstart: match[5].trim(),
    })
  }

  return table.size > 0 ? table : null
}

function treeCpuSeconds(
  rootPid: number | null,
  table: ProcessTable | null,
): number | null {
  if (rootPid === null || table === null) {
    return null
  }

  let total = 0
  let found = false
  const children = new Map<number, number[]>()

  for (const row of table.values()) {
    const list = children.get(row.ppid) ?? []
    list.push(row.pid)
    children.set(row.ppid, list)
  }

  const stack = [rootPid]

  while (stack.length > 0) {
    const pid = stack.pop()

    if (pid === undefined) {
      continue
    }

    const row = table.get(pid)

    if (row) {
      const cpu = parseCpuTime(row.time)

      if (cpu !== null) {
        total += cpu
        found = true
      }
    }

    for (const child of children.get(pid) ?? []) {
      stack.push(child)
    }
  }

  return found ? total : null
}

export function classifyShellRecord(
  record: AgentShellRecord,
  previous: AgentShellRecord | null,
  table: ProcessTable | null,
): ShellRecordState {
  if (record.ended_at !== null) {
    return 'exited'
  }

  const wrapperPid = record.wrapper_pid
  const wrapperRow =
    wrapperPid !== null && table ? table.get(wrapperPid) : undefined
  const wrapperAlive =
    wrapperPid !== null &&
    wrapperRow !== undefined &&
    !wrapperRow.stat.toUpperCase().startsWith('Z')

  if (
    wrapperPid !== null &&
    (!wrapperAlive ||
      (record.wrapper_process_identity !== null &&
        wrapperRow !== undefined &&
        wrapperRow.lstart !== record.wrapper_process_identity))
  ) {
    return 'dead'
  }

  const commandPid = record.pid
  const commandRow =
    commandPid !== null && table ? table.get(commandPid) : undefined

  if (commandRow?.stat.toUpperCase().startsWith('T')) {
    return 'stopped'
  }

  const heartbeatSeconds = record.heartbeat_seconds ?? 60
  const heartbeatAge = record.heartbeat_age_seconds

  if (heartbeatAge !== null && heartbeatAge > 2 * heartbeatSeconds) {
    return 'heartbeat_stale'
  }

  if (previous) {
    const logGrew =
      record.log_bytes !== null &&
      previous.log_bytes !== null &&
      record.log_bytes > previous.log_bytes
    const cpuGrew =
      record.tree_cpu_seconds !== null &&
      previous.tree_cpu_seconds !== null &&
      record.tree_cpu_seconds > previous.tree_cpu_seconds

    if (logGrew || cpuGrew) {
      return 'busy'
    }

    return 'idle'
  }

  return 'running'
}

function readRecordJson(directory: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(path.join(directory, 'record.json'), 'utf8'),
    )

    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function readHeartbeat(
  directory: string,
  nowMs: number,
): {
  age_seconds: number | null
  log_bytes: number | null
  last_output_at: string | null
  silent_seconds: number | null
} {
  try {
    const heartbeatPath = path.join(directory, 'heartbeat.json')
    const heartbeatMs = statSync(heartbeatPath).mtimeMs
    const heartbeatRaw: unknown = JSON.parse(
      readFileSync(heartbeatPath, 'utf8'),
    )
    const heartbeat = isRecord(heartbeatRaw) ? heartbeatRaw : {}
    const logBytes =
      typeof heartbeat.log_bytes === 'number' ? heartbeat.log_bytes : null
    const lastOutputAt =
      typeof heartbeat.last_output_at === 'string'
        ? heartbeat.last_output_at
        : null
    let silentSeconds: number | null = null

    if (lastOutputAt) {
      const lastMs = Date.parse(lastOutputAt)

      if (Number.isFinite(lastMs)) {
        silentSeconds = Math.max(0, (nowMs - lastMs) / 1000)
      }
    }

    return {
      age_seconds: Math.max(0, (nowMs - heartbeatMs) / 1000),
      log_bytes: logBytes,
      last_output_at: lastOutputAt,
      silent_seconds: silentSeconds,
    }
  } catch {
    return {
      age_seconds: null,
      log_bytes: null,
      last_output_at: null,
      silent_seconds: null,
    }
  }
}

/**
 * The last sample of each record in this process. A watch reads once per wake,
 * so a sample at least this old is the previous wake's and decides `busy` or
 * `idle`; reads closer together inside one wake keep the older baseline.
 */
const PRIOR_SAMPLE_MIN_MS = 10_000
const priorSamples = new Map<
  string,
  { record: AgentShellRecord; sampled_ms: number }
>()

/** Own records for the given conversation ids since `sinceMs`. */
export function readAgentShellRecords(
  root: string,
  agentIds: ReadonlySet<string>,
  sinceMs: number,
  nowMs: number,
  table: ProcessTable | null = sampleProcessTable(),
): AgentShellRecord[] {
  const shellDir = path.join(root, 'runtime', 'logs', 'shell')
  let names: string[]

  try {
    names = readdirSync(shellDir)
  } catch {
    return []
  }

  const floorMs = sinceMs - 2_000
  const records: AgentShellRecord[] = []

  for (const name of names) {
    const dirMs = shellRecordDirectoryMs(name)

    if (dirMs === null) {
      continue
    }

    const directory = path.join(shellDir, name)
    const recordJson = readRecordJson(directory)

    if (!recordJson) {
      continue
    }

    const startedAtMs =
      typeof recordJson.started_at === 'string'
        ? Date.parse(recordJson.started_at)
        : NaN
    const recordAnchorMs = Number.isFinite(startedAtMs) ? startedAtMs : dirMs

    if (dirMs < floorMs && recordAnchorMs < floorMs) {
      continue
    }

    const conversationId =
      typeof recordJson.cursor_conversation_id === 'string'
        ? recordJson.cursor_conversation_id
        : null

    if (!conversationId || !agentIds.has(conversationId)) {
      continue
    }

    const heartbeat = readHeartbeat(directory, nowMs)
    const wrapperPid =
      typeof recordJson.wrapper_pid === 'number' ? recordJson.wrapper_pid : null
    const pid = typeof recordJson.pid === 'number' ? recordJson.pid : null
    const partial: AgentShellRecord = {
      record_path: path.relative(root, path.join(directory, 'record.json')),
      label: typeof recordJson.label === 'string' ? recordJson.label : null,
      pid,
      wrapper_pid: wrapperPid,
      started_at:
        typeof recordJson.started_at === 'string'
          ? recordJson.started_at
          : null,
      ended_at:
        typeof recordJson.ended_at === 'string' ? recordJson.ended_at : null,
      exit_code:
        typeof recordJson.exit_code === 'number' ? recordJson.exit_code : null,
      parent_record:
        typeof recordJson.parent_record === 'string'
          ? recordJson.parent_record
          : null,
      cursor_conversation_id: conversationId,
      wrapper_process_identity:
        typeof recordJson.wrapper_process_identity === 'string'
          ? recordJson.wrapper_process_identity
          : null,
      heartbeat_seconds:
        typeof recordJson.heartbeat_seconds === 'number'
          ? recordJson.heartbeat_seconds
          : null,
      heartbeat_age_seconds: heartbeat.age_seconds,
      log_bytes: heartbeat.log_bytes,
      last_output_at: heartbeat.last_output_at,
      silent_seconds: heartbeat.silent_seconds,
      process_state: 'running',
      tree_cpu_seconds: treeCpuSeconds(pid, table),
    }

    const prior = priorSamples.get(directory)
    const previous =
      prior && nowMs - prior.sampled_ms >= PRIOR_SAMPLE_MIN_MS
        ? prior.record
        : null

    partial.process_state = classifyShellRecord(partial, previous, table)

    if (!prior || previous) {
      priorSamples.set(directory, {
        record: partial,
        sampled_ms: nowMs,
      })
    }

    records.push(partial)
  }

  records.sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''))

  return records
}

export function validatedConversationId(
  value: string | undefined,
): string | null {
  if (!value) {
    return null
  }

  const trimmed = value.trim()

  return /^[A-Za-z0-9_-]{1,128}$/u.test(trimmed) ? trimmed : null
}

export function validatedParentRecord(
  value: string | undefined,
): string | null {
  if (!value) {
    return null
  }

  const trimmed = value.trim()

  return /^runtime\/logs\/shell\/[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9._-]+$/u.test(
    trimmed,
  )
    ? trimmed
    : null
}

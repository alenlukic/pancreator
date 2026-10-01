/**
 * Agent index readers for the watch: per-agent events, open calls, stop
 * records, linked shell heartbeats, and the activity summary.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import {
  SCHEMA_VERSION,
  SHELL_TOOLS,
  agentEventFile,
  findAgent,
  isRecord,
  readIndex,
  resolveCanonicalId,
  type AgentEntry,
  type AgentEvent,
  type AgentIndex,
  type AgentStatus,
  type AgentStopRecord,
  type EventKind,
} from './store.js'
import { readTranscriptState, type TranscriptState } from './transcript.js'
import {
  readAgentShellRecords,
  type AgentShellRecord,
} from './shell-records.js'
import { agentLiveness, type AgentLiveness } from '../watch/liveness.js'

// A pan-run record that started this long before a shell call cannot be its.
const PAN_RUN_LINK_LEAD_MS = 2_000
const PAN_RUN_LINK_WINDOW_MS = 30_000

// ---------------------------------------------------------------------------
// Reader helpers for watch integration
// ---------------------------------------------------------------------------

function loadEventsForEntry(root: string, agent: AgentEntry): AgentEvent[] {
  const events: AgentEvent[] = []

  for (const id of [agent.agent_id, ...agent.aliases]) {
    const file = agentEventFile(root, id)

    if (!existsSync(file)) {
      continue
    }

    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.length === 0) {
        continue
      }

      try {
        const event = JSON.parse(line) as unknown

        if (isRecord(event) && event.schema_version === SCHEMA_VERSION) {
          events.push(event as unknown as AgentEvent)
        }
      } catch {
        // A torn final line from a concurrent append is skipped.
      }
    }
  }

  return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

/** Load every event for an agent, merging the event files of its aliases. */
export function loadAgentEvents(root: string, agentId: string): AgentEvent[] {
  const agent = getAgentEntry(root, agentId)

  return agent ? loadEventsForEntry(root, agent) : []
}

/**
 * The newest event recorded for an agent across its alias event files, or null
 * when the agent is unknown or has no events.
 */
export function getLatestEvent(
  root: string,
  agentId: string,
): AgentEvent | null {
  const events = loadAgentEvents(root, agentId)

  return events[events.length - 1] ?? null
}

function openCallIn(events: AgentEvent[]): AgentEvent | null {
  const open = new Map<string, AgentEvent>()

  for (const event of events) {
    const id = event.tool_use_id ?? ''

    if (event.kind === 'call_started') {
      open.set(id, event)
    } else if (event.kind === 'call_finished' || event.kind === 'call_failed') {
      open.delete(id)
    } else if (event.kind === 'stopped') {
      open.clear()
    }
  }

  return [...open.values()].pop() ?? null
}

/** The call that started without finishing, when one is open. */
export function getOpenCall(root: string, agentId: string): AgentEvent | null {
  return openCallIn(loadAgentEvents(root, agentId))
}

/** The agent's recorded stop, or null when it is unknown or has not stopped. */
export function getStopRecord(
  root: string,
  agentId: string,
): AgentStopRecord | null {
  return getAgentEntry(root, agentId)?.stop ?? null
}

/**
 * Look up an agent's index entry by its canonical id or any alias. Returns null
 * when the index holds no matching agent.
 */
export function getAgentEntry(
  root: string,
  agentId: string,
): AgentEntry | null {
  const index = readIndex(root)
  const canonical = resolveCanonicalId(index, agentId)

  return canonical !== null ? findAgent(index, canonical) : null
}

/** The newest agent registered for one run invocation. */
export function getAgentByRunInvocation(
  root: string,
  runId: string,
  invocationId: string,
): AgentEntry | null {
  return (
    readIndex(root)
      .agents.filter(
        (a) => a.run_id === runId && a.invocation_id === invocationId,
      )
      .sort((a, b) => b.registered_at.localeCompare(a.registered_at))[0] ?? null
  )
}

/**
 * Read the agent index, returning an empty index when the file is missing or
 * unreadable.
 */
export function readAgentIndex(root: string): AgentIndex {
  return readIndex(root)
}

// ---------------------------------------------------------------------------
// Activity view for watch wakes
// ---------------------------------------------------------------------------

/** Whether a tool name is one `bin/pan-run` wraps, so a linked heartbeat applies. */
export function isShellTool(toolName: string): boolean {
  return SHELL_TOOLS.has(toolName)
}

export interface ShellHeartbeat {
  record_path: string
  heartbeat_at: string
  age_seconds: number
  /** From the linked record.json; null when absent or unreadable. */
  label: string | null
  pid: number | null
  /** From the linked heartbeat.json; null/empty when the file holds `{}`. */
  elapsed_seconds: number | null
  log_bytes: number | null
  last_output_at: string | null
  recent_lines: string[]
}

export interface AgentActivity {
  agent_id: string
  aliases: string[]
  /** Harness-relative event file of the canonical id. */
  event_file: string
  event_count: number
  last_event_kind: EventKind | null
  last_event_tool: string | null
  last_event_at: string | null
  last_event_age_seconds: number | null
  open_call: {
    tool: string
    tool_use_id?: string | null
    started_at: string
    summary?: string
    shell_heartbeat: ShellHeartbeat | null
    shell_record_state?: AgentShellRecord['process_state'] | null
    shell_link?: 'conversation_id' | 'time_window' | null
  } | null
  shell_records?: AgentShellRecord[]
  liveness?: AgentLiveness
  /**
   * An open call holds off a stall verdict. A shell call holds it only while
   * its linked `bin/pan-run` heartbeat is younger than two cadences.
   */
  stall_suppressed: boolean
  stop: {
    status: AgentStatus
    recorded_at: string
    transcript_path: string | null
    source: 'hook' | 'transcript'
    /** The stop left a readable, non-empty transcript behind. */
    terminal_output_present: boolean
  } | null
  transcript: TranscriptState | null
  /** Changes whenever an event lands or the stop record changes. */
  signature: string
}

function shellRecordDirectoryMs(name: string): number | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-/u.exec(name)

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

interface RunningShellRecord {
  directory: string
  record: Record<string, unknown>
}

/**
 * The command a hook payload's `tool_input.command` carries can differ in
 * whitespace from the array `bin/pan-run` recorded, so this compares on
 * collapsed, trimmed text rather than an exact match.
 */
function commandTextMatchesSummary(command: unknown, summary: string): boolean {
  if (!Array.isArray(command) || command.length === 0) {
    return false
  }

  if (!command.every((word): word is string => typeof word === 'string')) {
    return false
  }

  const commandText = command.join(' ').trim().replace(/\s+/gu, ' ')

  if (commandText.length === 0) {
    return false
  }

  return summary.replace(/\s+/gu, ' ').includes(commandText)
}

/**
 * The `bin/pan-run` record an open shell call started, among every record
 * that began within the link window and has not ended. With no way to
 * attribute a shell call to its exact wrapper (no hook-supplied identity
 * crosses the child shell), several in-window running records are
 * ambiguous; a summary that names the linked record's own command breaks
 * the tie, and the earliest candidate otherwise does, matching this link's
 * original single-candidate behavior.
 */
function heartbeatFromDirectory(
  root: string,
  directory: string,
  record: Record<string, unknown>,
  nowMs: number,
): ShellHeartbeat | null {
  try {
    const heartbeatPath = path.join(directory, 'heartbeat.json')
    const heartbeatMs = statSync(heartbeatPath).mtimeMs
    const heartbeatRaw: unknown = JSON.parse(
      readFileSync(heartbeatPath, 'utf8'),
    )
    const heartbeat = isRecord(heartbeatRaw) ? heartbeatRaw : {}
    const recentLines = Array.isArray(heartbeat.recent_lines)
      ? heartbeat.recent_lines.filter(
          (line): line is string => typeof line === 'string',
        )
      : []

    return {
      record_path: path.relative(root, path.join(directory, 'record.json')),
      heartbeat_at: new Date(heartbeatMs).toISOString(),
      age_seconds: Math.max(0, (nowMs - heartbeatMs) / 1000),
      label: typeof record.label === 'string' ? record.label : null,
      pid: typeof record.pid === 'number' ? record.pid : null,
      elapsed_seconds:
        typeof heartbeat.elapsed_seconds === 'number'
          ? heartbeat.elapsed_seconds
          : null,
      log_bytes:
        typeof heartbeat.log_bytes === 'number' ? heartbeat.log_bytes : null,
      last_output_at:
        typeof heartbeat.last_output_at === 'string'
          ? heartbeat.last_output_at
          : null,
      recent_lines: recentLines,
    }
  } catch {
    return null
  }
}

function recordCommandMatchesSummary(
  recordPath: string,
  root: string,
  summary: string,
): boolean {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(resolveInsideRecord(root, recordPath), 'utf8'),
    )
    return (
      isRecord(parsed) && commandTextMatchesSummary(parsed.command, summary)
    )
  } catch {
    return false
  }
}

function resolveInsideRecord(root: string, relative: string): string {
  return path.join(root, relative)
}

/** Prefer the agent's own `bin/pan-run` record by conversation id; fall back to the time window. */
export function linkOpenShellCall(
  root: string,
  callStartedAt: string,
  nowMs: number,
  summary: string | undefined,
  shellRecords: AgentShellRecord[],
  agentIds: ReadonlySet<string>,
): {
  heartbeat: ShellHeartbeat | null
  shell_record_state: AgentShellRecord['process_state'] | null
  shell_link: 'conversation_id' | 'time_window' | null
} {
  const startedMs = Date.parse(callStartedAt)

  if (!Number.isFinite(startedMs)) {
    return {
      heartbeat: null,
      shell_record_state: null,
      shell_link: null,
    }
  }

  const owned = shellRecords.filter((record) => {
    if (record.ended_at !== null) {
      return false
    }

    const id = record.cursor_conversation_id

    if (!id || !agentIds.has(id)) {
      return false
    }

    const recordMs = record.started_at ? Date.parse(record.started_at) : NaN

    return (
      Number.isFinite(recordMs) && recordMs >= startedMs - PAN_RUN_LINK_LEAD_MS
    )
  })

  const topLevel = owned.filter((record) => record.parent_record === null)
  const pool = topLevel.length > 0 ? topLevel : owned
  const preferred =
    summary !== undefined
      ? pool.find((record) =>
          recordCommandMatchesSummary(record.record_path, root, summary),
        )
      : undefined
  const chosen = preferred ?? pool[0] ?? null

  if (chosen) {
    const directory = path.join(root, path.dirname(chosen.record_path))

    try {
      const recordJson: unknown = JSON.parse(
        readFileSync(path.join(directory, 'record.json'), 'utf8'),
      )
      const record = isRecord(recordJson) ? recordJson : {}

      return {
        heartbeat: heartbeatFromDirectory(root, directory, record, nowMs),
        shell_record_state: chosen.process_state,
        shell_link: 'conversation_id',
      }
    } catch {
      return {
        heartbeat: null,
        shell_record_state: chosen.process_state,
        shell_link: 'conversation_id',
      }
    }
  }

  const fallback = linkedShellHeartbeatTimeWindow(
    root,
    callStartedAt,
    nowMs,
    summary,
  )

  return {
    heartbeat: fallback,
    shell_record_state: null,
    shell_link: fallback ? 'time_window' : null,
  }
}

function linkedShellHeartbeatTimeWindow(
  root: string,
  callStartedAt: string,
  nowMs: number,
  summary?: string,
): ShellHeartbeat | null {
  const startedMs = Date.parse(callStartedAt)
  const shellDir = path.join(root, 'runtime', 'logs', 'shell')

  if (!Number.isFinite(startedMs)) {
    return null
  }

  let names: string[]

  try {
    names = readdirSync(shellDir)
  } catch {
    return null
  }

  const candidates = names
    .map((name) => ({ name, ms: shellRecordDirectoryMs(name) }))
    .filter(
      (item): item is { name: string; ms: number } =>
        item.ms !== null &&
        item.ms >=
          Math.floor((startedMs - PAN_RUN_LINK_LEAD_MS) / 1000) * 1000 &&
        item.ms <= startedMs + PAN_RUN_LINK_WINDOW_MS,
    )
    .sort((a, b) => a.ms - b.ms)

  const running: RunningShellRecord[] = []

  for (const { name } of candidates) {
    const directory = path.join(shellDir, name)

    try {
      const record = JSON.parse(
        readFileSync(path.join(directory, 'record.json'), 'utf8'),
      ) as unknown

      if (!isRecord(record) || record.ended_at !== null) {
        continue
      }

      running.push({ directory, record })
    } catch {
      continue
    }
  }

  if (running.length === 0) {
    return null
  }

  const preferred = summary
    ? running.find(({ record }) =>
        commandTextMatchesSummary(record.command, summary),
      )
    : undefined
  const ordered = preferred
    ? [preferred, ...running.filter((item) => item !== preferred)]
    : running

  for (const { directory, record } of ordered) {
    try {
      const heartbeatPath = path.join(directory, 'heartbeat.json')
      const heartbeatMs = statSync(heartbeatPath).mtimeMs
      const heartbeatRaw: unknown = JSON.parse(
        readFileSync(heartbeatPath, 'utf8'),
      )
      const heartbeat = isRecord(heartbeatRaw) ? heartbeatRaw : {}
      const recentLines = Array.isArray(heartbeat.recent_lines)
        ? heartbeat.recent_lines.filter(
            (line): line is string => typeof line === 'string',
          )
        : []

      return {
        record_path: path.relative(root, path.join(directory, 'record.json')),
        heartbeat_at: new Date(heartbeatMs).toISOString(),
        age_seconds: Math.max(0, (nowMs - heartbeatMs) / 1000),
        label: typeof record.label === 'string' ? record.label : null,
        pid: typeof record.pid === 'number' ? record.pid : null,
        elapsed_seconds:
          typeof heartbeat.elapsed_seconds === 'number'
            ? heartbeat.elapsed_seconds
            : null,
        log_bytes:
          typeof heartbeat.log_bytes === 'number' ? heartbeat.log_bytes : null,
        last_output_at:
          typeof heartbeat.last_output_at === 'string'
            ? heartbeat.last_output_at
            : null,
        recent_lines: recentLines,
      }
    } catch {
      continue
    }
  }

  return null
}

function transcriptPresent(transcriptPath: string | null): boolean {
  if (!transcriptPath) {
    return false
  }

  try {
    return statSync(transcriptPath).size > 0
  } catch {
    return false
  }
}

type ResolvedStop = {
  status: AgentStatus
  recorded_at: string
  transcript_path: string | null
  source: 'hook' | 'transcript'
}

/**
 * The agent's stop from its index record, else from its latest kept
 * `stopped` line, because lock contention can drop the index update, else
 * from a transcript whose last turn ended.
 *
 * A resumed subagent keeps its earlier stop and its ended transcript turn
 * until it stops again, so a stop is current only when no call started after
 * it and it is not older than `notBeforeMs`. A watch passes the creation time
 * of the invocation it observes there, because a stop recorded before that
 * invocation existed belongs to an earlier attempt.
 */
function resolveStop(
  agent: AgentEntry,
  events: AgentEvent[],
  nowMs: number,
  notBeforeMs: number | null,
): ResolvedStop | null {
  const lastCallStartedMs = events.reduce(
    (latest, event) =>
      event.kind === 'call_started'
        ? Math.max(latest, Date.parse(event.timestamp))
        : latest,
    Number.NEGATIVE_INFINITY,
  )
  const current = (recordedAt: string): boolean => {
    const recordedMs = Date.parse(recordedAt)

    return (
      !(recordedMs < lastCallStartedMs) &&
      (notBeforeMs === null || !(recordedMs < notBeforeMs))
    )
  }

  if (agent.stop && current(agent.stop.recorded_at)) {
    return {
      status: agent.stop.status,
      recorded_at: agent.stop.recorded_at,
      transcript_path: agent.transcript_path,
      source: 'hook',
    }
  }

  const stoppedLine = [...events]
    .reverse()
    .find((event) => event.kind === 'stopped' && event.status !== undefined)

  if (stoppedLine?.status !== undefined && current(stoppedLine.timestamp)) {
    return {
      status: stoppedLine.status,
      recorded_at: stoppedLine.timestamp,
      transcript_path: stoppedLine.transcript_path ?? agent.transcript_path,
      source: 'hook',
    }
  }

  const transcript = readTranscriptState(agent, nowMs)
  const transcriptRecordedAt = transcript
    ? new Date(transcript.mtime_ms).toISOString()
    : null

  if (
    transcript?.turn_ended &&
    transcriptRecordedAt !== null &&
    current(transcriptRecordedAt)
  ) {
    return {
      status: transcript.turn_status === 'success' ? 'completed' : 'error',
      recorded_at: transcriptRecordedAt,
      transcript_path: transcript.path,
      source: 'transcript',
    }
  }

  return null
}

/**
 * The agent's current stop, or null when the index does not know the id or
 * the agent has not stopped since `notBeforeMs`. It reads only what the stop
 * decision needs, so a watch can ask it between wakes.
 */
export function readAgentStop(
  root: string,
  agentId: string,
  nowMs: number,
  notBeforeMs: number | null = null,
): ResolvedStop | null {
  const agent = getAgentEntry(root, agentId)

  return agent
    ? resolveStop(agent, loadEventsForEntry(root, agent), nowMs, notBeforeMs)
    : null
}

/**
 * Everything one watch wake records about an agent. Returns null when the
 * index does not know the id yet. A stop older than `notBeforeMs` is not
 * reported; see `resolveStop`.
 */
export function readAgentActivity(
  root: string,
  agentId: string,
  nowMs: number,
  cadenceSeconds: number,
  notBeforeMs: number | null = null,
): AgentActivity | null {
  const agent = getAgentEntry(root, agentId)

  if (!agent) {
    return null
  }

  const events = loadEventsForEntry(root, agent)
  const latest = events[events.length - 1] ?? null
  const openEvent = openCallIn(events)
  const lastEventAt = latest?.timestamp ?? agent.last_event_at
  const lastMs = Date.parse(lastEventAt)
  const transcript = readTranscriptState(agent, nowMs)
  const agentIds = new Set([agent.agent_id, ...agent.aliases])
  const registeredMs = Date.parse(agent.registered_at)
  const shellRecords = Number.isFinite(registeredMs)
    ? readAgentShellRecords(root, agentIds, registeredMs, nowMs)
    : []
  const stopRecord = resolveStop(agent, events, nowMs, notBeforeMs)
  let openCall: AgentActivity['open_call'] = null
  let stallSuppressed = false

  if (openEvent && stopRecord === null) {
    const tool = openEvent.tool_name ?? 'unknown'
    const shell = SHELL_TOOLS.has(tool)
    const link = shell
      ? linkOpenShellCall(
          root,
          openEvent.timestamp,
          nowMs,
          openEvent.summary,
          shellRecords,
          agentIds,
        )
      : {
          heartbeat: null,
          shell_record_state: null,
          shell_link: null,
        }

    openCall = {
      tool,
      tool_use_id: openEvent.tool_use_id ?? null,
      started_at: openEvent.timestamp,
      ...(openEvent.summary ? { summary: openEvent.summary } : {}),
      shell_heartbeat: link.heartbeat,
      shell_record_state: link.shell_record_state,
      shell_link: link.shell_link,
    }
    stallSuppressed = shell
      ? link.heartbeat !== null &&
        link.heartbeat.age_seconds < 2 * cadenceSeconds
      : true
  }

  const stop = stopRecord
    ? {
        ...stopRecord,
        terminal_output_present: transcriptPresent(stopRecord.transcript_path),
      }
    : null
  const signature = createHash('sha256')
    .update(
      [
        agent.agent_id,
        events.length,
        latest?.timestamp ?? '',
        latest?.kind ?? '',
        latest?.tool_use_id ?? '',
        stopRecord?.status ?? '',
        stopRecord?.recorded_at ?? '',
        transcript?.size ?? '',
        transcript?.mtime_ms ?? '',
      ].join(':'),
    )
    .digest('hex')
    .slice(0, 16)

  const activityBody = {
    agent_id: agent.agent_id,
    aliases: [...agent.aliases],
    event_file: path.relative(root, agentEventFile(root, agent.agent_id)),
    event_count: events.length,
    last_event_kind: latest?.kind ?? agent.last_event_kind,
    last_event_tool: latest?.tool_name ?? null,
    last_event_at: lastEventAt,
    last_event_age_seconds: Number.isFinite(lastMs)
      ? Math.max(0, (nowMs - lastMs) / 1000)
      : null,
    open_call: openCall,
    stall_suppressed: stallSuppressed,
    stop,
    transcript,
    signature,
    shell_records: shellRecords,
  }

  return {
    ...activityBody,
    liveness: agentLiveness({
      ...activityBody,
      stop,
      transcript,
      open_call: openCall,
    }),
  }
}

/** Activity signature for progress fingerprinting, or null for an unknown id. */
export function agentActivitySignature(
  root: string,
  agentId: string,
): string | null {
  return readAgentActivity(root, agentId, Date.now(), 60)?.signature ?? null
}

/** @deprecated Prefer linkOpenShellCall; kept for callers that need the window only. */
export function linkedShellHeartbeat(
  root: string,
  callStartedAt: string,
  nowMs: number,
  summary?: string,
): ShellHeartbeat | null {
  return linkedShellHeartbeatTimeWindow(root, callStartedAt, nowMs, summary)
}

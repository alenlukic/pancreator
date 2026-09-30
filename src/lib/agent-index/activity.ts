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

export interface ShellHeartbeat {
  record_path: string
  heartbeat_at: string
  age_seconds: number
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
    started_at: string
    summary?: string
    shell_heartbeat: ShellHeartbeat | null
  } | null
  /**
   * An open call holds off a stall verdict. A shell call holds it only while
   * its linked `bin/pan-run` heartbeat is younger than two cadences.
   */
  stall_suppressed: boolean
  stop: {
    status: AgentStatus
    recorded_at: string
    transcript_path: string | null
    /** The stop left a readable, non-empty transcript behind. */
    terminal_output_present: boolean
  } | null
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

/**
 * The `bin/pan-run` record an open shell call started: the earliest record
 * that began within the link window after the call and has not ended.
 */
export function linkedShellHeartbeat(
  root: string,
  callStartedAt: string,
  nowMs: number,
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

  for (const { name } of candidates) {
    const directory = path.join(shellDir, name)

    try {
      const record = JSON.parse(
        readFileSync(path.join(directory, 'record.json'), 'utf8'),
      ) as unknown

      if (!isRecord(record) || record.ended_at !== null) {
        continue
      }

      const heartbeatMs = statSync(
        path.join(directory, 'heartbeat.json'),
      ).mtimeMs

      return {
        record_path: path.relative(root, path.join(directory, 'record.json')),
        heartbeat_at: new Date(heartbeatMs).toISOString(),
        age_seconds: Math.max(0, (nowMs - heartbeatMs) / 1000),
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

/**
 * The agent's stop from its index record, else from its latest kept
 * `stopped` line, because lock contention can drop the index update.
 */
function resolveStop(
  agent: AgentEntry,
  events: AgentEvent[],
): {
  status: AgentStatus
  recorded_at: string
  transcript_path: string | null
} | null {
  if (agent.stop) {
    return {
      status: agent.stop.status,
      recorded_at: agent.stop.recorded_at,
      transcript_path: agent.transcript_path,
    }
  }

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i] as AgentEvent

    if (event.kind === 'stopped' && event.status !== undefined) {
      return {
        status: event.status,
        recorded_at: event.timestamp,
        transcript_path: event.transcript_path ?? agent.transcript_path,
      }
    }
  }

  return null
}

/**
 * Everything one watch wake records about an agent. Returns null when the
 * index does not know the id yet.
 */
export function readAgentActivity(
  root: string,
  agentId: string,
  nowMs: number,
  cadenceSeconds: number,
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
  const stopRecord = resolveStop(agent, events)
  let openCall: AgentActivity['open_call'] = null
  let stallSuppressed = false

  if (openEvent && stopRecord === null) {
    const tool = openEvent.tool_name ?? 'unknown'
    const shell = SHELL_TOOLS.has(tool)
    const heartbeat = shell
      ? linkedShellHeartbeat(root, openEvent.timestamp, nowMs)
      : null

    openCall = {
      tool,
      started_at: openEvent.timestamp,
      ...(openEvent.summary ? { summary: openEvent.summary } : {}),
      shell_heartbeat: heartbeat,
    }
    stallSuppressed = shell
      ? heartbeat !== null && heartbeat.age_seconds < 2 * cadenceSeconds
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
      ].join(':'),
    )
    .digest('hex')
    .slice(0, 16)

  return {
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
    signature,
  }
}

/** Activity signature for progress fingerprinting, or null for an unknown id. */
export function agentActivitySignature(
  root: string,
  agentId: string,
): string | null {
  return readAgentActivity(root, agentId, Date.now(), 60)?.signature ?? null
}

/**
 * Hook-fed agent activity index.
 *
 * Appends bounded event lines to per-agent JSONL files and maintains a
 * mutex-guarded `index.json`. Designed for hook start-up performance:
 * every write path is synchronous and the lock wait is bounded.
 *
 * Layout under `runtime/logs/agents/`:
 *   index.json    — summary of known agents with aliases and pending launches
 *   <id>.jsonl    — append-only event stream for one agent
 *   index.lock    — operation mutex
 */
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const AGENTS_DIR = 'runtime/logs/agents'
const INDEX_FILE = 'index.json'
const LOCK_FILE = 'index.lock'
const SCHEMA_VERSION = 1
const MAX_EVENT_LINE_BYTES = 4096
const MAX_SUMMARY_CHARS = 200
const HEARTBEAT_THROTTLE_MS = 15_000
const PRUNE_TERMINAL_AFTER_MS = 7 * 24 * 60 * 60 * 1_000
const LOCK_WAIT_MS = 500
const LOCK_RETRIES = 6

const SECRET_NAME =
  /TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL|AUTH|SESSION/i
const MIN_SECRET_LENGTH = 8

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AgentStatus = 'running' | 'completed' | 'error' | 'aborted'

export type EventKind =
  | 'registered'
  | 'launch_requested'
  | 'launch_returned'
  | 'call_started'
  | 'call_finished'
  | 'call_failed'
  | 'stopped'

export interface AgentStopRecord {
  status: AgentStatus
  recorded_at: string
  tool_call_count: number
  modified_file_count: number
  duration_seconds: number | null
}

export interface AgentEntry {
  agent_id: string
  parent_agent_id: string | null
  subagent_type: string | null
  model: string | null
  status: AgentStatus
  registered_at: string
  last_event_at: string
  last_event_kind: EventKind
  run_id: string | null
  invocation_id: string | null
  aliases: string[]
  transcript_path: string | null
  stop: AgentStopRecord | null
}

export interface PendingLaunch {
  parent_agent_id: string
  tool_use_id: string
  prompt_digest: string
  subagent_type: string | null
  description: string | null
  requested_at: string
}

export interface AgentIndex {
  schema_version: typeof SCHEMA_VERSION
  updated_at: string
  agents: AgentEntry[]
  aliases: Record<string, string>
  pending_launches: PendingLaunch[]
}

export interface AgentEvent {
  schema_version: typeof SCHEMA_VERSION
  kind: EventKind
  agent_id: string
  timestamp: string
  tool_name?: string
  tool_use_id?: string
  summary?: string
  duration_ms?: number
  failure_type?: string
}

// ---------------------------------------------------------------------------
// Hook payload shapes (from Cursor hook events)
// ---------------------------------------------------------------------------

export interface PreToolUsePayload {
  event: 'preToolUse'
  conversation_id?: string
  tool_name?: string
  tool_use_id?: string
  tool_input?: unknown
}

export interface PostToolUsePayload {
  event: 'postToolUse' | 'postToolUseFailure'
  conversation_id?: string
  tool_name?: string
  tool_use_id?: string
  tool_output?: unknown
}

export interface SubagentStartPayload {
  event: 'subagentStart'
  conversation_id?: string
  subagent_id?: string
  parent_conversation_id?: string
  parent_tool_call_id?: string
  tool_call_id?: string
  task_text?: string
  subagent_type?: string
  model?: string
}

export interface SubagentStopPayload {
  event: 'subagentStop'
  conversation_id?: string
  subagent_id?: string
  parent_conversation_id?: string
  status?: AgentStatus
  agent_transcript_path?: string
  tool_call_count?: number
  modified_file_count?: number
  duration_seconds?: number
}

export type HookPayload =
  | PreToolUsePayload
  | PostToolUsePayload
  | SubagentStartPayload
  | SubagentStopPayload

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function agentsDir(root: string): string {
  return path.join(root, AGENTS_DIR)
}

export function agentEventFile(root: string, agentId: string): string {
  return path.join(agentsDir(root), `${sanitizeId(agentId)}.jsonl`)
}

function indexPath(root: string): string {
  return path.join(agentsDir(root), INDEX_FILE)
}

function lockPath(root: string): string {
  return path.join(agentsDir(root), LOCK_FILE)
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128)
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

function collectSecrets(): string[] {
  const secrets: string[] = []

  for (const [name, value] of Object.entries(process.env)) {
    if (
      SECRET_NAME.test(name) &&
      typeof value === 'string' &&
      value.length >= MIN_SECRET_LENGTH
    ) {
      secrets.push(value)
    }
  }

  return secrets.sort((a, b) => b.length - a.length)
}

function redact(text: string, secrets: string[]): string {
  let result = text

  for (const secret of secrets) {
    result = result.split(secret).join('[REDACTED]')
  }

  return result
}

function boundedSummary(
  text: string,
  secrets: string[],
  maxChars = MAX_SUMMARY_CHARS,
): string {
  const redacted = redact(text, secrets)

  return redacted.length > maxChars
    ? redacted.slice(0, maxChars) + '…'
    : redacted
}

// ---------------------------------------------------------------------------
// Run/invocation parsing
// ---------------------------------------------------------------------------

const RUN_INVOCATION_PATTERN =
  /runtime\/logs\/workflows\/([^/]+)\/agent\/invocations\/([^/.\s]+)\./u

export function parseRunInvocation(
  text: string,
): { run_id: string; invocation_id: string } | null {
  const match = RUN_INVOCATION_PATTERN.exec(text)

  if (!match) {
    return null
  }

  return { run_id: match[1] as string, invocation_id: match[2] as string }
}

// ---------------------------------------------------------------------------
// Mutex (best-effort file lock)
// ---------------------------------------------------------------------------

function tryAcquireLock(lockFile: string): boolean {
  try {
    // O_EXCL: fails if file already exists
    writeFileSync(lockFile, String(process.pid), { flag: 'wx' })
    return true
  } catch {
    return false
  }
}

function releaseLock(lockFile: string): void {
  try {
    rmSync(lockFile)
  } catch {
    // ignore
  }
}

function withLock<T>(lockFile: string, fn: () => T, fallback: () => T): T {
  for (let i = 0; i < LOCK_RETRIES; i += 1) {
    if (tryAcquireLock(lockFile)) {
      try {
        return fn()
      } finally {
        releaseLock(lockFile)
      }
    }

    // Synchronous busy-wait (hook must be fast; total max ~250ms)
    const deadline = Date.now() + LOCK_WAIT_MS / LOCK_RETRIES

    while (Date.now() < deadline) {
      // spin
    }
  }

  // Lock contention: fail open (C-004)
  return fallback()
}

// ---------------------------------------------------------------------------
// Index read/write
// ---------------------------------------------------------------------------

function emptyIndex(): AgentIndex {
  return {
    schema_version: SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    agents: [],
    aliases: {},
    pending_launches: [],
  }
}

function readIndex(root: string): AgentIndex {
  try {
    const raw = JSON.parse(readFileSync(indexPath(root), 'utf8')) as unknown

    if (
      raw !== null &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      (raw as Record<string, unknown>).schema_version === SCHEMA_VERSION
    ) {
      return raw as AgentIndex
    }
  } catch {
    // unreadable or malformed
  }

  return emptyIndex()
}

function writeIndex(root: string, index: AgentIndex): void {
  const file = indexPath(root)
  const tmp = `${file}.${process.pid}.tmp`

  writeFileSync(tmp, JSON.stringify(index, null, 2) + '\n')
  // Atomic rename (same filesystem)
  try {
    renameSync(tmp, file)
  } catch {
    try {
      rmSync(tmp)
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Pruning
// ---------------------------------------------------------------------------

function isTerminal(status: AgentStatus): boolean {
  return status === 'completed' || status === 'error' || status === 'aborted'
}

function pruneIndex(index: AgentIndex, nowMs: number): void {
  const cutoffMs = nowMs - PRUNE_TERMINAL_AFTER_MS
  const toRemove = new Set<string>()

  for (const agent of index.agents) {
    if (isTerminal(agent.status)) {
      const lastMs = Date.parse(agent.last_event_at)

      if (Number.isFinite(lastMs) && lastMs < cutoffMs) {
        toRemove.add(agent.agent_id)
      }
    }
  }

  if (toRemove.size === 0) {
    return
  }

  index.agents = index.agents.filter((a) => !toRemove.has(a.agent_id))

  const aliasMap: Record<string, string> = {}

  for (const [alias, canonical] of Object.entries(index.aliases)) {
    if (!toRemove.has(canonical)) {
      aliasMap[alias] = canonical
    }
  }

  index.aliases = aliasMap

  index.pending_launches = index.pending_launches.filter(
    (pl) => !toRemove.has(pl.parent_agent_id),
  )
}

// ---------------------------------------------------------------------------
// Alias resolution
// ---------------------------------------------------------------------------

export function resolveCanonicalId(
  index: AgentIndex,
  id: string,
): string | null {
  // Check if this is already a canonical id
  if (index.agents.some((a) => a.agent_id === id)) {
    return id
  }

  // Check aliases
  return index.aliases[id] ?? null
}

function registerAlias(
  index: AgentIndex,
  alias: string,
  canonical: string,
): void {
  if (alias !== canonical && !index.aliases[alias]) {
    index.aliases[alias] = canonical
  }
}

// ---------------------------------------------------------------------------
// Event appending
// ---------------------------------------------------------------------------

function appendEvent(root: string, agentId: string, event: AgentEvent): void {
  const file = agentEventFile(root, agentId)
  const line = JSON.stringify(event)

  if (Buffer.byteLength(line, 'utf8') > MAX_EVENT_LINE_BYTES) {
    // Truncate the summary field to fit
    const trimmed = {
      ...event,
      summary: event.summary
        ? event.summary.slice(0, 100) + '…'
        : event.summary,
    }
    appendFileSync(file, JSON.stringify(trimmed) + '\n')
  } else {
    appendFileSync(file, line + '\n')
  }
}

// ---------------------------------------------------------------------------
// Public event handlers
// ---------------------------------------------------------------------------

/**
 * Handle `preToolUse` — record a call_started event and, for Task calls,
 * a pending launch in the index.
 */
export function handlePreToolUse(
  root: string,
  payload: PreToolUsePayload,
): void {
  const agentId = payload.conversation_id

  if (!agentId) {
    return
  }

  const now = new Date().toISOString()
  const secrets = collectSecrets()
  const toolName = payload.tool_name ?? 'unknown'
  const toolUseId = payload.tool_use_id ?? ''

  // Derive a bounded summary from the tool input
  let summary: string | undefined

  if (payload.tool_input !== null && payload.tool_input !== undefined) {
    try {
      const raw =
        typeof payload.tool_input === 'string'
          ? payload.tool_input
          : JSON.stringify(payload.tool_input)

      summary = boundedSummary(raw, secrets)
    } catch {
      // ignore
    }
  }

  // Append event to per-agent file
  ensureAgentsDir(root)
  appendEvent(root, agentId, {
    schema_version: SCHEMA_VERSION,
    kind: 'call_started',
    agent_id: agentId,
    timestamp: now,
    tool_name: toolName,
    tool_use_id: toolUseId,
    ...(summary !== undefined ? { summary } : {}),
  })

  // For Task calls, record a pending launch in the index
  if (toolName === 'Task') {
    const description = extractTaskDescription(payload.tool_input, secrets)
    const promptDigest = computePromptDigest(payload.tool_input)

    withLock(
      lockPath(root),
      () => {
        const index = readIndex(root)
        const now2 = new Date().toISOString()

        // Ensure agent is registered
        ensureAgentEntry(index, agentId, now2)
        index.agents.find((a) => a.agent_id === agentId)!.last_event_at = now2
        index.agents.find((a) => a.agent_id === agentId)!.last_event_kind =
          'launch_requested'

        // Add pending launch (keyed by parent+tool_use_id)
        const existing = index.pending_launches.findIndex(
          (pl) =>
            pl.parent_agent_id === agentId && pl.tool_use_id === toolUseId,
        )

        const launch: PendingLaunch = {
          parent_agent_id: agentId,
          tool_use_id: toolUseId,
          prompt_digest: promptDigest,
          subagent_type: null,
          description,
          requested_at: now2,
        }

        if (existing >= 0) {
          index.pending_launches[existing] = launch
        } else {
          index.pending_launches.push(launch)
        }

        pruneIndex(index, Date.now())
        index.updated_at = now2
        writeIndex(root, index)
      },
      () => {
        // fail open: event already appended, skip index update
      },
    )
  } else {
    // Update last_event_at in index (throttled)
    updateLastEventThrottled(root, agentId, now, 'call_started')
  }
}

/**
 * Handle `postToolUse` or `postToolUseFailure` — record call_finished or
 * call_failed, and for Task calls record the returned handle.
 */
export function handlePostToolUse(
  root: string,
  payload: PostToolUsePayload,
): void {
  const agentId = payload.conversation_id

  if (!agentId) {
    return
  }

  const now = new Date().toISOString()
  const isFailed = payload.event === 'postToolUseFailure'
  const kind: EventKind = isFailed ? 'call_failed' : 'call_finished'
  const toolName = payload.tool_name ?? 'unknown'
  const toolUseId = payload.tool_use_id ?? ''

  ensureAgentsDir(root)
  appendEvent(root, agentId, {
    schema_version: SCHEMA_VERSION,
    kind,
    agent_id: agentId,
    timestamp: now,
    tool_name: toolName,
    tool_use_id: toolUseId,
  })

  // For Task postToolUse, extract the returned handle and record launch_returned
  if (toolName === 'Task' && !isFailed) {
    const handle = extractTaskHandle(payload.tool_output)

    if (handle) {
      appendEvent(root, agentId, {
        schema_version: SCHEMA_VERSION,
        kind: 'launch_returned',
        agent_id: agentId,
        timestamp: now,
        tool_use_id: toolUseId,
        summary: boundedSummary(handle, collectSecrets()),
      })
    }

    withLock(
      lockPath(root),
      () => {
        const index = readIndex(root)
        const agent = index.agents.find((a) => a.agent_id === agentId)

        if (agent) {
          agent.last_event_at = now
          agent.last_event_kind = 'launch_returned'
        }

        // Link the handle as an alias to the pending launch's child when we
        // know the child id; otherwise record it as an unresolved alias.
        if (handle) {
          // Find pending launch by tool_use_id
          const launch = index.pending_launches.find(
            (pl) =>
              pl.parent_agent_id === agentId && pl.tool_use_id === toolUseId,
          )

          if (launch) {
            // Try to find the child agent registered for this launch
            const child = index.agents.find(
              (a) =>
                a.parent_agent_id === agentId && a.aliases.includes(toolUseId),
            )

            if (child) {
              registerAlias(index, handle, child.agent_id)
            } else {
              // Record as pending alias resolution
              if (!index.aliases[handle]) {
                index.aliases[handle] = handle
              }
            }
          }
        }

        pruneIndex(index, Date.now())
        index.updated_at = now
        writeIndex(root, index)
      },
      () => {},
    )
  } else {
    updateLastEventThrottled(root, agentId, now, kind)
  }
}

/**
 * Handle `subagentStart` — register the child agent and link it to the
 * pending launch.
 */
export function handleSubagentStart(
  root: string,
  payload: SubagentStartPayload,
): void {
  // Use subagent_id when present, else conversation_id of the child
  const rawChildId = payload.subagent_id ?? payload.conversation_id ?? null

  if (!rawChildId) {
    return
  }

  const parentId = payload.parent_conversation_id ?? null
  const toolCallId = payload.tool_call_id ?? null
  const now = new Date().toISOString()
  const taskText = payload.task_text ?? ''
  const parsed = parseRunInvocation(taskText)

  // Prompt digest to match against pending launches
  const promptDigest = computePromptDigest(taskText)

  ensureAgentsDir(root)
  appendEvent(root, rawChildId, {
    schema_version: SCHEMA_VERSION,
    kind: 'registered',
    agent_id: rawChildId,
    timestamp: now,
    ...(toolCallId ? { tool_use_id: toolCallId } : {}),
  })

  withLock(
    lockPath(root),
    () => {
      const index = readIndex(root)

      // Register the child
      let childEntry = index.agents.find((a) => a.agent_id === rawChildId)

      if (!childEntry) {
        childEntry = {
          agent_id: rawChildId,
          parent_agent_id: parentId,
          subagent_type: payload.subagent_type ?? null,
          model: payload.model ?? null,
          status: 'running',
          registered_at: now,
          last_event_at: now,
          last_event_kind: 'registered',
          run_id: parsed?.run_id ?? null,
          invocation_id: parsed?.invocation_id ?? null,
          aliases: [],
          transcript_path: null,
          stop: null,
        }
        index.agents.push(childEntry)
      } else {
        childEntry.last_event_at = now
        childEntry.last_event_kind = 'registered'

        if (parsed && !childEntry.run_id) {
          childEntry.run_id = parsed.run_id
          childEntry.invocation_id = parsed.invocation_id
        }
      }

      // Register aliases
      if (toolCallId && toolCallId !== rawChildId) {
        registerAlias(index, toolCallId, rawChildId)

        if (!childEntry.aliases.includes(toolCallId)) {
          childEntry.aliases.push(toolCallId)
        }
      }

      // Link to pending launch: by tool_call_id equality or by parent+digest
      if (parentId) {
        const launch = index.pending_launches.find(
          (pl) =>
            pl.parent_agent_id === parentId &&
            (toolCallId
              ? pl.tool_use_id === toolCallId
              : pl.prompt_digest === promptDigest),
        )

        if (launch) {
          // Register the tool_use_id of the launch as an alias of this child
          if (
            launch.tool_use_id !== rawChildId &&
            !childEntry.aliases.includes(launch.tool_use_id)
          ) {
            registerAlias(index, launch.tool_use_id, rawChildId)
            childEntry.aliases.push(launch.tool_use_id)
          }

          if (launch.subagent_type) {
            childEntry.subagent_type = launch.subagent_type
          }
        }
      }

      pruneIndex(index, Date.now())
      index.updated_at = now
      writeIndex(root, index)
    },
    () => {},
  )
}

/**
 * Handle `subagentStop` — mark the agent stopped.
 */
export function handleSubagentStop(
  root: string,
  payload: SubagentStopPayload,
): void {
  const now = new Date().toISOString()

  ensureAgentsDir(root)

  withLock(
    lockPath(root),
    () => {
      const index = readIndex(root)

      // Resolve the stopped child in priority order (Q-002 disposition)
      const rawId =
        payload.subagent_id ??
        (payload.agent_transcript_path
          ? path.basename(payload.agent_transcript_path, '.json')
          : null) ??
        payload.conversation_id ??
        null

      if (!rawId) {
        return
      }

      const canonical = resolveCanonicalId(index, rawId) ?? rawId

      // Append stop event to the agent's event file
      const stopStatus: AgentStatus =
        (payload.status as AgentStatus | undefined) ?? 'completed'
      appendEvent(root, canonical, {
        schema_version: SCHEMA_VERSION,
        kind: 'stopped',
        agent_id: canonical,
        timestamp: now,
        ...(payload.duration_seconds !== undefined
          ? { duration_ms: Math.round(payload.duration_seconds * 1000) }
          : {}),
      })

      // Update index entry
      let agent = index.agents.find((a) => a.agent_id === canonical)

      if (!agent) {
        // Late-registering stop: create a minimal entry
        agent = {
          agent_id: canonical,
          parent_agent_id: payload.parent_conversation_id ?? null,
          subagent_type: null,
          model: null,
          status: stopStatus,
          registered_at: now,
          last_event_at: now,
          last_event_kind: 'stopped',
          run_id: null,
          invocation_id: null,
          aliases: [],
          transcript_path: payload.agent_transcript_path ?? null,
          stop: null,
        }
        index.agents.push(agent)
      }

      agent.status = stopStatus
      agent.last_event_at = now
      agent.last_event_kind = 'stopped'

      if (payload.agent_transcript_path && !agent.transcript_path) {
        agent.transcript_path = payload.agent_transcript_path
      }

      agent.stop = {
        status: stopStatus,
        recorded_at: now,
        tool_call_count: payload.tool_call_count ?? 0,
        modified_file_count: payload.modified_file_count ?? 0,
        duration_seconds: payload.duration_seconds ?? null,
      }

      // Register aliases from stop payload
      if (rawId !== canonical) {
        registerAlias(index, rawId, canonical)
      }

      pruneIndex(index, Date.now())
      index.updated_at = now
      writeIndex(root, index)
    },
    () => {},
  )
}

// ---------------------------------------------------------------------------
// Reader helpers for watch integration
// ---------------------------------------------------------------------------

/**
 * Load all events for an agent (merging aliases).
 */
export function loadAgentEvents(root: string, agentId: string): AgentEvent[] {
  const index = readIndex(root)
  const canonical = resolveCanonicalId(index, agentId) ?? agentId
  const agent = index.agents.find((a) => a.agent_id === canonical)

  if (!agent) {
    return []
  }

  const ids = [canonical, ...agent.aliases]
  const events: AgentEvent[] = []

  for (const id of ids) {
    const file = agentEventFile(root, id)

    if (!existsSync(file)) {
      continue
    }

    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)

    for (const line of lines) {
      try {
        const event = JSON.parse(line) as unknown

        if (
          event !== null &&
          typeof event === 'object' &&
          !Array.isArray(event) &&
          (event as Record<string, unknown>).schema_version === SCHEMA_VERSION
        ) {
          events.push(event as AgentEvent)
        }
      } catch {
        // ignore unparseable lines
      }
    }
  }

  return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

/**
 * Get the latest event for an agent.
 */
export function getLatestEvent(
  root: string,
  agentId: string,
): AgentEvent | null {
  const events = loadAgentEvents(root, agentId)

  return events.length > 0 ? events[events.length - 1]! : null
}

/**
 * Get the open call (started but not finished) for an agent.
 */
export function getOpenCall(root: string, agentId: string): AgentEvent | null {
  const events = loadAgentEvents(root, agentId)
  const openByToolUseId = new Map<string, AgentEvent>()

  for (const event of events) {
    const id = event.tool_use_id ?? ''

    if (event.kind === 'call_started') {
      openByToolUseId.set(id, event)
    } else if (event.kind === 'call_finished' || event.kind === 'call_failed') {
      openByToolUseId.delete(id)
    }
  }

  const openCalls = [...openByToolUseId.values()]

  return openCalls.length > 0 ? openCalls[openCalls.length - 1]! : null
}

/**
 * Get the stop record for an agent from the index.
 */
export function getStopRecord(
  root: string,
  agentId: string,
): AgentStopRecord | null {
  const index = readIndex(root)
  const canonical = resolveCanonicalId(index, agentId) ?? agentId
  const agent = index.agents.find((a) => a.agent_id === canonical)

  return agent?.stop ?? null
}

/**
 * Get the full agent entry from the index.
 */
export function getAgentEntry(
  root: string,
  agentId: string,
): AgentEntry | null {
  const index = readIndex(root)
  const canonical = resolveCanonicalId(index, agentId) ?? agentId

  return index.agents.find((a) => a.agent_id === canonical) ?? null
}

/**
 * Get the agent entry from run+invocation ids.
 */
export function getAgentByRunInvocation(
  root: string,
  runId: string,
  invocationId: string,
): AgentEntry | null {
  const index = readIndex(root)

  return (
    index.agents.find(
      (a) => a.run_id === runId && a.invocation_id === invocationId,
    ) ?? null
  )
}

/**
 * Compute an activity signature (hash) for use in progress fingerprinting.
 */
export function agentActivitySignature(
  root: string,
  agentId: string,
): string | null {
  const latest = getLatestEvent(root, agentId)

  if (!latest) {
    return null
  }

  return createHash('sha256')
    .update(
      `${agentId}:${latest.timestamp}:${latest.kind}:${latest.tool_use_id ?? ''}`,
    )
    .digest('hex')
    .slice(0, 16)
}

/**
 * Read the full index.
 */
export function readAgentIndex(root: string): AgentIndex {
  return readIndex(root)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function ensureAgentsDir(root: string): void {
  const dir = agentsDir(root)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function ensureAgentEntry(
  index: AgentIndex,
  agentId: string,
  now: string,
): AgentEntry {
  const existing = index.agents.find((a) => a.agent_id === agentId)

  if (existing) {
    return existing
  }

  const entry: AgentEntry = {
    agent_id: agentId,
    parent_agent_id: null,
    subagent_type: null,
    model: null,
    status: 'running',
    registered_at: now,
    last_event_at: now,
    last_event_kind: 'registered',
    run_id: null,
    invocation_id: null,
    aliases: [],
    transcript_path: null,
    stop: null,
  }
  index.agents.push(entry)

  return entry
}

function updateLastEventThrottled(
  root: string,
  agentId: string,
  now: string,
  kind: EventKind,
): void {
  withLock(
    lockPath(root),
    () => {
      const index = readIndex(root)
      const agent = index.agents.find((a) => a.agent_id === agentId)

      if (!agent) {
        // First time we see this agent from a non-Task tool call
        ensureAgentEntry(index, agentId, now)
        const newAgent = index.agents.find((a) => a.agent_id === agentId)!
        newAgent.last_event_at = now
        newAgent.last_event_kind = kind
        pruneIndex(index, Date.now())
        index.updated_at = now
        writeIndex(root, index)
        return
      }

      const lastMs = Date.parse(agent.last_event_at)
      const nowMs = Date.parse(now)

      // Throttle: only update if enough time has passed
      if (!Number.isFinite(lastMs) || nowMs - lastMs >= HEARTBEAT_THROTTLE_MS) {
        agent.last_event_at = now
        agent.last_event_kind = kind
        pruneIndex(index, Date.now())
        index.updated_at = now
        writeIndex(root, index)
      }
    },
    () => {},
  )
}

function extractTaskDescription(
  toolInput: unknown,
  secrets: string[],
): string | null {
  try {
    const input =
      typeof toolInput === 'string' ? JSON.parse(toolInput) : toolInput

    if (
      input !== null &&
      typeof input === 'object' &&
      !Array.isArray(input) &&
      typeof (input as Record<string, unknown>).description === 'string'
    ) {
      return boundedSummary(
        (input as Record<string, unknown>).description as string,
        secrets,
      )
    }
  } catch {
    // ignore
  }

  return null
}

function extractTaskHandle(toolOutput: unknown): string | null {
  try {
    const output =
      typeof toolOutput === 'string' ? JSON.parse(toolOutput) : toolOutput

    if (typeof output === 'string' && output.length > 0) {
      return output.slice(0, 128)
    }

    if (
      output !== null &&
      typeof output === 'object' &&
      !Array.isArray(output)
    ) {
      const record = output as Record<string, unknown>
      const id = record.agent_id ?? record.id ?? record.conversation_id ?? null

      if (typeof id === 'string' && id.length > 0) {
        return id.slice(0, 128)
      }
    }
  } catch {
    // ignore
  }

  return null
}

function computePromptDigest(input: unknown): string {
  try {
    const text = typeof input === 'string' ? input : JSON.stringify(input)

    return createHash('sha256').update(text).digest('hex').slice(0, 16)
  } catch {
    return ''
  }
}

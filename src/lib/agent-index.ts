/**
 * Hook-fed agent activity index.
 *
 * Appends bounded event lines to per-agent JSONL files and maintains a
 * mutex-guarded `index.json`. Designed for hook start-up performance:
 * every write path is synchronous and the lock wait is bounded.
 *
 * Layout under `runtime/logs/agents/`:
 *   index.json    — summary of known agents with aliases and pending launches
 *   <id>.jsonl    — append-only event stream for one agent id or alias
 *   index.lock    — operation mutex
 */
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

const AGENT_INDEX_HOOK_MARKER = 'pan-hook-agent-index'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readJsonFileOrNull(filePath: string): unknown {
  if (!existsSync(filePath)) {
    return null
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

/** Hook event names whose entries include a command naming `marker`. */
function hookEventsWithMarker(document: unknown, marker: string): string[] {
  if (!isPlainObject(document) || !isPlainObject(document.hooks)) {
    return []
  }

  const events: string[] = []

  for (const [event, entries] of Object.entries(document.hooks)) {
    if (!Array.isArray(entries)) {
      continue
    }

    const carriesMarker = entries.some(
      (entry) =>
        isPlainObject(entry) &&
        typeof entry.command === 'string' &&
        entry.command.includes(marker),
    )

    if (carriesMarker) {
      events.push(event)
    }
  }

  return events
}

export interface AgentIndexHooksStatus {
  /** True when the projected file carries every canonical agent-index hook. */
  projected: boolean
  /** Canonical hook events whose agent-index entry the projected file lacks. */
  missing_events: string[]
}

/**
 * Whether the checkout's projected `.cursor/hooks.json` still wires the
 * agent-index hooks (`bin/pan-hook-agent-index`) that `library/cursor/hooks.json`
 * declares. Without them, no subagent ever registers in the agent index, and
 * `pan watch --agent` cannot tell an unregistered agent apart from a stalled
 * one. Returns null when the canonical source is absent, which happens in a
 * unit-test temp root that carries no `library/` tree and therefore has
 * nothing to compare against.
 */
export function agentIndexHooksStatus(
  root: string,
): AgentIndexHooksStatus | null {
  const canonical = readJsonFileOrNull(
    path.join(root, 'library', 'cursor', 'hooks.json'),
  )

  if (canonical === null) {
    return null
  }

  const requiredEvents = hookEventsWithMarker(
    canonical,
    AGENT_INDEX_HOOK_MARKER,
  )

  if (requiredEvents.length === 0) {
    return { projected: true, missing_events: [] }
  }

  const projected = readJsonFileOrNull(path.join(root, '.cursor', 'hooks.json'))

  if (projected === null) {
    return { projected: false, missing_events: requiredEvents }
  }

  const projectedEvents = new Set(
    hookEventsWithMarker(projected, AGENT_INDEX_HOOK_MARKER),
  )
  const missingEvents = requiredEvents.filter(
    (event) => !projectedEvents.has(event),
  )

  return {
    projected: missingEvents.length === 0,
    missing_events: missingEvents,
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const AGENTS_DIR = 'runtime/logs/agents'
const INDEX_FILE = 'index.json'
const LOCK_FILE = 'index.lock'
const SCHEMA_VERSION = 1
const MAX_EVENT_LINE_BYTES = 4096
const MAX_SUMMARY_CHARS = 200
// A truncated path names no file, so a longer one is left off the event line.
const MAX_TRANSCRIPT_PATH_CHARS = 1024
const MAX_ID_CHARS = 128
const HEARTBEAT_THROTTLE_MS = 15_000
// Cost-backed bound: it keeps index.json small and its rewrite fast.
const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1_000
const LOCK_ATTEMPTS = 10
const LOCK_RETRY_SLEEP_MS = 25
// A lock file whose owner never wrote its pid is stale after this long.
const EMPTY_LOCK_STALE_MS = 5_000
// A pan-run record that started this long before a shell call cannot be its.
const PAN_RUN_LINK_LEAD_MS = 2_000
const PAN_RUN_LINK_WINDOW_MS = 30_000

const SECRET_NAME =
  /TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL|AUTH|SESSION/i
const MIN_SECRET_LENGTH = 8
const INLINE_ASSIGNMENT = /\b([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S+)/g
const SECRET_FLAG =
  /(--?[A-Za-z0-9_-]*(?:token|secret|password|passwd|api[-_]?key|credential)[A-Za-z0-9_-]*)(=|\s+)(\S+)/gi

const SHELL_TOOLS = new Set(['Shell', 'Bash', 'run_terminal_cmd'])
const FILE_TOOLS = new Set([
  'Read',
  'Write',
  'StrReplace',
  'Edit',
  'MultiEdit',
  'Delete',
  'EditNotebook',
  'NotebookEdit',
  'read_file',
  'edit_file',
  'search_replace',
  'delete_file',
])
const PATH_FIELDS = [
  'path',
  'file_path',
  'target_file',
  'target_notebook',
  'notebook_path',
]

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
  /** Digest of the task text, the last key the stop resolution tries. */
  prompt_digest?: string | null
  stop: AgentStopRecord | null
}

export interface PendingLaunch {
  parent_agent_id: string
  tool_use_id: string
  prompt_digest: string | null
  subagent_type: string | null
  description: string | null
  requested_at: string
  /** Handle the parent's Task call returned, once seen. */
  handle?: string | null
  /** Child the launch linked to, once `subagentStart` matched it. */
  resolved_agent_id?: string | null
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
  status?: AgentStatus
  /** On a `stopped` line, so the stop survives a dropped index update. */
  transcript_path?: string
}

// ---------------------------------------------------------------------------
// Hook payload shapes (from Cursor hook events)
// ---------------------------------------------------------------------------

export interface PreToolUsePayload {
  event: 'preToolUse'
  conversation_id?: string
  parent_tool_call_id?: string
  tool_name?: string
  tool_use_id?: string
  tool_input?: unknown
}

export interface PostToolUsePayload {
  event: 'postToolUse' | 'postToolUseFailure'
  conversation_id?: string
  parent_tool_call_id?: string
  tool_name?: string
  tool_use_id?: string
  tool_output?: unknown
  failure_type?: string
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
  status?: string
  task_text?: string
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
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, MAX_ID_CHARS)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

// ---------------------------------------------------------------------------
// Redaction and summaries
// ---------------------------------------------------------------------------

/**
 * The secret set `bin/pan-run` applies: values of secret-named environment
 * variables and of secret-named entries in the root `.env`.
 */
export function collectSecrets(root: string): string[] {
  const secrets = new Set<string>()
  const add = (name: string, value: unknown): void => {
    if (
      SECRET_NAME.test(name) &&
      typeof value === 'string' &&
      value.length >= MIN_SECRET_LENGTH
    ) {
      secrets.add(value)
    }
  }

  for (const [name, value] of Object.entries(process.env)) {
    add(name, value)
  }

  let envText = ''

  try {
    envText = readFileSync(path.join(root, '.env'), 'utf8')
  } catch {
    // No .env file is the common case.
  }

  for (const line of envText.split(/\r?\n/)) {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
      line.trim(),
    )

    if (!match) {
      continue
    }

    let value = match[2] as string

    if (/^'.*'$/.test(value) || /^".*"$/.test(value)) {
      value = value.slice(1, -1)
    }

    add(match[1] as string, value)
  }

  return [...secrets].sort((a, b) => b.length - a.length)
}

function redact(text: string, secrets: string[]): string {
  let result = text

  for (const secret of secrets) {
    result = result.split(secret).join('[REDACTED]')
  }

  // A literal typed inline never reaches the environment, so the name of the
  // assignment or flag is the only signal left.
  result = result.replace(INLINE_ASSIGNMENT, (whole, name: string) =>
    SECRET_NAME.test(name) ? `${name}=[REDACTED]` : whole,
  )

  return result.replace(
    SECRET_FLAG,
    (_whole, flag: string, separator: string) =>
      `${flag}${separator}[REDACTED]`,
  )
}

function boundedSummary(text: string, secrets: string[]): string {
  const redacted = redact(text, secrets)

  return redacted.length > MAX_SUMMARY_CHARS
    ? redacted.slice(0, MAX_SUMMARY_CHARS) + '…'
    : redacted
}

function parseToolInput(toolInput: unknown): Record<string, unknown> | null {
  if (isRecord(toolInput)) {
    return toolInput
  }

  if (typeof toolInput === 'string') {
    try {
      const parsed = JSON.parse(toolInput) as unknown

      return isRecord(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  return null
}

/**
 * The only input a call event keeps: a redacted, truncated command for shell
 * tools, the path for file tools, the subagent type and short description
 * for `Task`, and nothing for every other tool. File contents, prompt
 * bodies, and tool output never reach the index.
 */
export function summarizeToolInput(
  toolName: string,
  toolInput: unknown,
  secrets: string[],
): string | undefined {
  const input = parseToolInput(toolInput)

  if (!input) {
    return undefined
  }

  if (SHELL_TOOLS.has(toolName)) {
    const command = nonEmptyString(input.command)

    return command ? boundedSummary(command, secrets) : undefined
  }

  if (FILE_TOOLS.has(toolName)) {
    for (const field of PATH_FIELDS) {
      const value = nonEmptyString(input[field])

      if (value) {
        return boundedSummary(value, secrets)
      }
    }

    return undefined
  }

  if (toolName === 'Task') {
    const type = nonEmptyString(input.subagent_type)
    const description = nonEmptyString(input.description)
    const text = [type, description].filter(Boolean).join(': ')

    return text.length > 0 ? boundedSummary(text, secrets) : undefined
  }

  return undefined
}

/** Digest of a prompt text; both link sides digest the same field. */
export function promptDigest(text: string | null | undefined): string | null {
  if (typeof text !== 'string' || text.length === 0) {
    return null
  }

  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

// ---------------------------------------------------------------------------
// Run/invocation parsing
// ---------------------------------------------------------------------------

const RUN_INVOCATION_PATTERN =
  /runtime\/logs\/workflows\/([^/\s]+)\/agent\/invocations\/([^/.\s]+)\.(?:md|json|delegation\.md)\b/u

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
// Mutex (file lock with stale-owner recovery)
// ---------------------------------------------------------------------------

const sleepCell = new Int32Array(new SharedArrayBuffer(4))

function sleepSync(milliseconds: number): void {
  Atomics.wait(sleepCell, 0, 0, milliseconds)
}

function tryAcquireLock(lockFile: string): boolean {
  try {
    writeFileSync(lockFile, String(process.pid), { flag: 'wx' })
    return true
  } catch {
    return false
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    // EPERM means the process exists under another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function lockIsStale(lockFile: string): boolean {
  let text: string
  let mtimeMs: number

  try {
    text = readFileSync(lockFile, 'utf8').trim()
    mtimeMs = statSync(lockFile).mtimeMs
  } catch {
    return false
  }

  const pid = Number.parseInt(text, 10)

  if (Number.isInteger(pid) && pid > 0) {
    return !processAlive(pid)
  }

  return Date.now() - mtimeMs > EMPTY_LOCK_STALE_MS
}

/**
 * Run `fn` under the index mutex. Returns false without running it when the
 * lock stays held past the bounded wait, which callers treat as a dropped
 * index update (fail open). Event lines are appended outside the lock.
 */
function withLock(lockFile: string, fn: () => void): boolean {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    if (tryAcquireLock(lockFile)) {
      try {
        fn()
      } finally {
        rmSync(lockFile, { force: true })
      }

      return true
    }

    // A dead owner is removed at once. Two processes can both judge the same
    // lock stale; the loser then overwrites one index update, which the
    // index already tolerates, and never an event line.
    if (lockIsStale(lockFile)) {
      rmSync(lockFile, { force: true })
      continue
    }

    sleepSync(LOCK_RETRY_SLEEP_MS)
  }

  return false
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
      isRecord(raw) &&
      raw.schema_version === SCHEMA_VERSION &&
      Array.isArray(raw.agents) &&
      isRecord(raw.aliases) &&
      Array.isArray(raw.pending_launches)
    ) {
      return raw as unknown as AgentIndex
    }
  } catch {
    // unreadable or malformed
  }

  return emptyIndex()
}

function writeIndex(root: string, index: AgentIndex, nowIso: string): void {
  pruneIndex(index, Date.parse(nowIso))
  index.updated_at = nowIso

  const file = indexPath(root)
  const tmp = `${file}.${process.pid}.tmp`

  writeFileSync(tmp, JSON.stringify(index, null, 2) + '\n')

  try {
    renameSync(tmp, file)
  } catch {
    rmSync(tmp, { force: true })
  }
}

function isTerminal(status: AgentStatus): boolean {
  return status === 'completed' || status === 'error' || status === 'aborted'
}

function pruneIndex(index: AgentIndex, nowMs: number): void {
  const cutoffMs = nowMs - PRUNE_AFTER_MS
  const removed = new Set<string>()

  for (const agent of index.agents) {
    const lastMs = Date.parse(agent.last_event_at)

    if (
      isTerminal(agent.status) &&
      Number.isFinite(lastMs) &&
      lastMs < cutoffMs
    ) {
      removed.add(agent.agent_id)
    }
  }

  if (removed.size > 0) {
    index.agents = index.agents.filter((a) => !removed.has(a.agent_id))
    index.aliases = Object.fromEntries(
      Object.entries(index.aliases).filter(
        ([, canonical]) => !removed.has(canonical),
      ),
    )
  }

  // A launch whose child never registered, or one already resolved, has no
  // further use once it is older than the retention window.
  index.pending_launches = index.pending_launches.filter((launch) => {
    const requestedMs = Date.parse(launch.requested_at)
    const resolved = launch.resolved_agent_id ?? null

    if (resolved !== null && removed.has(resolved)) {
      return false
    }

    return !(Number.isFinite(requestedMs) && requestedMs < cutoffMs)
  })
}

// ---------------------------------------------------------------------------
// Alias resolution
// ---------------------------------------------------------------------------

export function resolveCanonicalId(
  index: AgentIndex,
  id: string,
): string | null {
  if (index.agents.some((a) => a.agent_id === id)) {
    return id
  }

  const canonical = index.aliases[id]

  return canonical !== undefined &&
    index.agents.some((a) => a.agent_id === canonical)
    ? canonical
    : null
}

function findAgent(index: AgentIndex, canonical: string): AgentEntry | null {
  return index.agents.find((a) => a.agent_id === canonical) ?? null
}

function linkAlias(index: AgentIndex, alias: string, canonical: string): void {
  if (alias === canonical || index.aliases[alias] !== undefined) {
    return
  }

  if (index.agents.some((a) => a.agent_id === alias)) {
    return
  }

  index.aliases[alias] = canonical
  const entry = findAgent(index, canonical)

  if (entry && !entry.aliases.includes(alias)) {
    entry.aliases.push(alias)
  }
}

function newAgentEntry(agentId: string, nowIso: string): AgentEntry {
  return {
    agent_id: agentId,
    parent_agent_id: null,
    subagent_type: null,
    model: null,
    status: 'running',
    registered_at: nowIso,
    last_event_at: nowIso,
    last_event_kind: 'registered',
    run_id: null,
    invocation_id: null,
    aliases: [],
    transcript_path: null,
    prompt_digest: null,
    stop: null,
  }
}

/**
 * Resolve the agent behind a tool event. An unknown conversation id whose
 * `parent_tool_call_id` names a registered child becomes that child's alias,
 * so a child's own tool calls land on the entry its launch registered.
 */
function resolveActor(
  index: AgentIndex,
  rawId: string,
  parentToolCallId: string | null,
  nowIso: string,
): { entry: AgentEntry; changed: boolean } {
  const known = resolveCanonicalId(index, rawId)

  if (known !== null) {
    return { entry: findAgent(index, known) as AgentEntry, changed: false }
  }

  if (parentToolCallId !== null) {
    const child = resolveCanonicalId(index, parentToolCallId)

    if (child !== null) {
      linkAlias(index, rawId, child)
      return { entry: findAgent(index, child) as AgentEntry, changed: true }
    }
  }

  const entry = newAgentEntry(rawId, nowIso)
  index.agents.push(entry)

  return { entry, changed: true }
}

// ---------------------------------------------------------------------------
// Event appending
// ---------------------------------------------------------------------------

function ensureAgentsDir(root: string): void {
  mkdirSync(agentsDir(root), { recursive: true })
}

function appendEvent(root: string, fileId: string, event: AgentEvent): void {
  let line = JSON.stringify(event)

  if (Buffer.byteLength(line, 'utf8') > MAX_EVENT_LINE_BYTES) {
    line = JSON.stringify({ ...event, summary: undefined })
  }

  appendFileSync(agentEventFile(root, fileId), line + '\n')
}

function touch(entry: AgentEntry, nowIso: string, kind: EventKind): void {
  entry.last_event_at = nowIso
  entry.last_event_kind = kind
}

function heartbeatDue(entry: AgentEntry, nowIso: string): boolean {
  const lastMs = Date.parse(entry.last_event_at)

  return (
    !Number.isFinite(lastMs) ||
    Date.parse(nowIso) - lastMs >= HEARTBEAT_THROTTLE_MS
  )
}

// ---------------------------------------------------------------------------
// Public event handlers
// ---------------------------------------------------------------------------

/**
 * Handle `preToolUse`: append `call_started`, and for a `Task` call record a
 * pending launch keyed by parent and `tool_use_id`.
 */
export function handlePreToolUse(
  root: string,
  payload: PreToolUsePayload,
): void {
  const rawId = nonEmptyString(payload.conversation_id)

  if (!rawId) {
    return
  }

  const nowIso = new Date().toISOString()
  const secrets = collectSecrets(root)
  const toolName = nonEmptyString(payload.tool_name) ?? 'unknown'
  const toolUseId = nonEmptyString(payload.tool_use_id) ?? ''
  const summary = summarizeToolInput(toolName, payload.tool_input, secrets)

  ensureAgentsDir(root)
  appendEvent(root, rawId, {
    schema_version: SCHEMA_VERSION,
    kind: 'call_started',
    agent_id: rawId,
    timestamp: nowIso,
    tool_name: toolName,
    tool_use_id: toolUseId,
    ...(summary !== undefined ? { summary } : {}),
  })

  const parentToolCallId = nonEmptyString(payload.parent_tool_call_id)

  withLock(lockPath(root), () => {
    const index = readIndex(root)
    const { entry, changed } = resolveActor(
      index,
      rawId,
      parentToolCallId,
      nowIso,
    )

    if (toolName === 'Task') {
      const input = parseToolInput(payload.tool_input)
      const launch: PendingLaunch = {
        parent_agent_id: entry.agent_id,
        tool_use_id: toolUseId,
        prompt_digest: promptDigest(nonEmptyString(input?.prompt)),
        subagent_type: nonEmptyString(input?.subagent_type),
        description:
          input && nonEmptyString(input.description)
            ? boundedSummary(input.description as string, secrets)
            : null,
        requested_at: nowIso,
        handle: null,
        resolved_agent_id: null,
      }
      const existing = index.pending_launches.findIndex(
        (pl) =>
          pl.parent_agent_id === entry.agent_id && pl.tool_use_id === toolUseId,
      )

      if (existing >= 0) {
        index.pending_launches[existing] = launch
      } else {
        index.pending_launches.push(launch)
      }

      touch(entry, nowIso, 'launch_requested')
      writeIndex(root, index, nowIso)
      return
    }

    if (changed || heartbeatDue(entry, nowIso)) {
      touch(entry, nowIso, 'call_started')
      writeIndex(root, index, nowIso)
    }
  })
}

/**
 * Handle `postToolUse` or `postToolUseFailure`. For a returned `Task`, parse
 * the agent handle into an alias; the output body is never stored.
 */
export function handlePostToolUse(
  root: string,
  payload: PostToolUsePayload,
): void {
  const rawId = nonEmptyString(payload.conversation_id)

  if (!rawId) {
    return
  }

  const nowIso = new Date().toISOString()
  const failed = payload.event === 'postToolUseFailure'
  const kind: EventKind = failed ? 'call_failed' : 'call_finished'
  const toolName = nonEmptyString(payload.tool_name) ?? 'unknown'
  const toolUseId = nonEmptyString(payload.tool_use_id) ?? ''
  const failureType = failed ? nonEmptyString(payload.failure_type) : null

  ensureAgentsDir(root)
  appendEvent(root, rawId, {
    schema_version: SCHEMA_VERSION,
    kind,
    agent_id: rawId,
    timestamp: nowIso,
    tool_name: toolName,
    tool_use_id: toolUseId,
    ...(failureType ? { failure_type: failureType.slice(0, 64) } : {}),
  })

  const handle =
    toolName === 'Task' && !failed
      ? extractTaskHandle(payload.tool_output)
      : null

  if (handle !== null) {
    appendEvent(root, rawId, {
      schema_version: SCHEMA_VERSION,
      kind: 'launch_returned',
      agent_id: rawId,
      timestamp: nowIso,
      tool_name: toolName,
      tool_use_id: toolUseId,
      summary: handle,
    })
  }

  const parentToolCallId = nonEmptyString(payload.parent_tool_call_id)

  withLock(lockPath(root), () => {
    const index = readIndex(root)
    const { entry, changed } = resolveActor(
      index,
      rawId,
      parentToolCallId,
      nowIso,
    )

    if (handle !== null) {
      const launch = index.pending_launches.find(
        (pl) =>
          pl.parent_agent_id === entry.agent_id && pl.tool_use_id === toolUseId,
      )

      if (launch) {
        launch.handle = handle

        if (launch.resolved_agent_id) {
          linkAlias(index, handle, launch.resolved_agent_id)
        }
      }

      touch(entry, nowIso, 'launch_returned')
      writeIndex(root, index, nowIso)
      return
    }

    if (changed || heartbeatDue(entry, nowIso)) {
      touch(entry, nowIso, kind)
      writeIndex(root, index, nowIso)
    }
  })
}

/**
 * Handle `subagentStart`: register the child, parse its run and invocation,
 * and link the parent's pending launch by `tool_call_id` equality or by
 * parent plus prompt digest.
 */
export function handleSubagentStart(
  root: string,
  payload: SubagentStartPayload,
): void {
  const subagentId = nonEmptyString(payload.subagent_id)
  const conversationId = nonEmptyString(payload.conversation_id)
  const explicitParent = nonEmptyString(payload.parent_conversation_id)
  const childId = subagentId ?? conversationId

  if (!childId) {
    return
  }

  // Without an explicit parent field, a payload that carries both ids fired
  // in the parent's conversation, so `conversation_id` names the parent.
  const parentId =
    explicitParent ??
    (subagentId && conversationId && conversationId !== subagentId
      ? conversationId
      : null)
  const childConversationId =
    explicitParent &&
    subagentId &&
    conversationId &&
    conversationId !== explicitParent &&
    conversationId !== subagentId
      ? conversationId
      : null
  const toolCallId = nonEmptyString(payload.tool_call_id)
  const taskText = nonEmptyString(payload.task_text) ?? ''
  const parsed = parseRunInvocation(taskText)
  const digest = promptDigest(taskText)
  const nowIso = new Date().toISOString()

  ensureAgentsDir(root)
  appendEvent(root, childId, {
    schema_version: SCHEMA_VERSION,
    kind: 'registered',
    agent_id: childId,
    timestamp: nowIso,
    ...(toolCallId ? { tool_use_id: toolCallId } : {}),
  })

  withLock(lockPath(root), () => {
    const index = readIndex(root)
    const parentCanonical =
      parentId !== null
        ? (resolveCanonicalId(index, parentId) ?? parentId)
        : null
    const canonical = resolveCanonicalId(index, childId)
    let child = canonical !== null ? findAgent(index, canonical) : null

    if (!child) {
      child = newAgentEntry(childId, nowIso)
      index.agents.push(child)
    }

    child.parent_agent_id = parentCanonical ?? child.parent_agent_id
    child.subagent_type =
      nonEmptyString(payload.subagent_type) ?? child.subagent_type
    child.model = nonEmptyString(payload.model) ?? child.model
    child.prompt_digest = digest ?? child.prompt_digest ?? null
    child.status = 'running'
    touch(child, nowIso, 'registered')

    if (parsed) {
      child.run_id = parsed.run_id
      child.invocation_id = parsed.invocation_id
    }

    for (const alias of [toolCallId, childConversationId]) {
      if (alias) {
        linkAlias(index, alias, child.agent_id)
      }
    }

    if (parentCanonical !== null) {
      const open = index.pending_launches.filter(
        (pl) =>
          pl.parent_agent_id === parentCanonical &&
          (pl.resolved_agent_id ?? null) === null,
      )
      const launch =
        (toolCallId
          ? open.find((pl) => pl.tool_use_id === toolCallId)
          : undefined) ??
        (digest ? open.find((pl) => pl.prompt_digest === digest) : undefined)

      if (launch) {
        launch.resolved_agent_id = child.agent_id

        if (launch.tool_use_id) {
          linkAlias(index, launch.tool_use_id, child.agent_id)
        }

        if (launch.handle) {
          linkAlias(index, launch.handle, child.agent_id)
        }

        child.subagent_type = child.subagent_type ?? launch.subagent_type
      }
    }

    writeIndex(root, index, nowIso)
  })
}

function transcriptKey(transcriptPath: string | null): string | null {
  if (!transcriptPath) {
    return null
  }

  const key = path.basename(transcriptPath).replace(/\.jsonl?$/u, '')

  return key.length > 0 ? key : null
}

function normalizeStopStatus(value: unknown): AgentStatus {
  return value === 'error' || value === 'aborted' ? value : 'completed'
}

/**
 * Resolve the stopped child in the Q-002 order: `subagent_id`, the transcript
 * basename, a registered child `conversation_id`, then parent plus task-text
 * digest. The parent itself is never the answer. The caller passes the
 * transcript path already redacted, because its basename becomes an alias
 * and, for an unresolved stop, the event file name.
 */
function resolveStoppedChild(
  index: AgentIndex,
  payload: SubagentStopPayload,
  transcriptPath: string | null,
): { canonical: string | null; rawKeys: string[] } {
  const parentId = nonEmptyString(payload.parent_conversation_id)
  const parentCanonical =
    parentId !== null ? (resolveCanonicalId(index, parentId) ?? parentId) : null
  const notParent = (canonical: string | null): string | null =>
    canonical !== null && canonical !== parentCanonical ? canonical : null
  const subagentId = nonEmptyString(payload.subagent_id)
  const transcript = transcriptKey(transcriptPath)
  const rawKeys = [subagentId, transcript].filter(
    (key): key is string => key !== null,
  )

  for (const key of rawKeys) {
    const canonical = notParent(resolveCanonicalId(index, key))

    if (canonical !== null) {
      return { canonical, rawKeys }
    }
  }

  const conversationId = nonEmptyString(payload.conversation_id)

  if (conversationId !== null) {
    const canonical = notParent(resolveCanonicalId(index, conversationId))
    const entry = canonical !== null ? findAgent(index, canonical) : null

    if (entry && entry.parent_agent_id !== null) {
      return { canonical, rawKeys }
    }
  }

  const digest = promptDigest(nonEmptyString(payload.task_text))

  if (parentCanonical !== null && digest !== null) {
    const match = index.agents
      .filter(
        (a) =>
          a.parent_agent_id === parentCanonical &&
          a.prompt_digest === digest &&
          a.status === 'running',
      )
      .sort((a, b) => b.registered_at.localeCompare(a.registered_at))[0]

    if (match) {
      return { canonical: match.agent_id, rawKeys }
    }
  }

  return { canonical: null, rawKeys }
}

/**
 * Handle `subagentStop`: append the stop line first, so lock contention can
 * drop only the index update, then record the stop on the child's entry.
 */
export function handleSubagentStop(
  root: string,
  payload: SubagentStopPayload,
): void {
  const nowIso = new Date().toISOString()
  const status = normalizeStopStatus(payload.status)
  const rawTranscriptPath = nonEmptyString(payload.agent_transcript_path)
  const transcriptPath =
    rawTranscriptPath !== null
      ? redact(rawTranscriptPath, collectSecrets(root))
      : null
  const storedTranscriptPath =
    transcriptPath !== null &&
    transcriptPath.length <= MAX_TRANSCRIPT_PATH_CHARS
      ? transcriptPath
      : null
  const { canonical, rawKeys } = resolveStoppedChild(
    readIndex(root),
    payload,
    transcriptPath,
  )
  const target = canonical ?? rawKeys[0] ?? null

  if (target === null) {
    return
  }

  ensureAgentsDir(root)
  appendEvent(root, target, {
    schema_version: SCHEMA_VERSION,
    kind: 'stopped',
    agent_id: target,
    timestamp: nowIso,
    status,
    ...(typeof payload.duration_seconds === 'number'
      ? { duration_ms: Math.round(payload.duration_seconds * 1000) }
      : {}),
    ...(storedTranscriptPath !== null
      ? { transcript_path: storedTranscriptPath }
      : {}),
  })

  withLock(lockPath(root), () => {
    const index = readIndex(root)
    const resolved =
      resolveStoppedChild(index, payload, transcriptPath).canonical ?? target
    let agent = findAgent(
      index,
      resolveCanonicalId(index, resolved) ?? resolved,
    )

    if (!agent) {
      agent = newAgentEntry(resolved, nowIso)
      agent.parent_agent_id = nonEmptyString(payload.parent_conversation_id)
      index.agents.push(agent)
    }

    agent.status = status
    touch(agent, nowIso, 'stopped')
    agent.transcript_path = storedTranscriptPath ?? agent.transcript_path
    agent.stop = {
      status,
      recorded_at: nowIso,
      tool_call_count:
        typeof payload.tool_call_count === 'number'
          ? payload.tool_call_count
          : 0,
      modified_file_count:
        typeof payload.modified_file_count === 'number'
          ? payload.modified_file_count
          : 0,
      duration_seconds:
        typeof payload.duration_seconds === 'number'
          ? payload.duration_seconds
          : null,
    }

    for (const key of rawKeys) {
      linkAlias(index, key, agent.agent_id)
    }

    writeIndex(root, index, nowIso)
  })
}

/**
 * The agent handle a `Task` call returned: a JSON string or an object's id
 * field, else a plain handle token, else an `agent id: <token>` mention.
 */
export function extractTaskHandle(toolOutput: unknown): string | null {
  let output = toolOutput

  if (typeof output === 'string') {
    const trimmed = output.trim()

    try {
      output = JSON.parse(trimmed) as unknown
    } catch {
      output = trimmed
    }
  }

  if (typeof output === 'string') {
    if (/^[A-Za-z0-9_-]{1,128}$/u.test(output)) {
      return output
    }

    const mention =
      /agent[ _-]?id["']?\s*[:=]\s*["']?([A-Za-z0-9_-]{1,128})/iu.exec(output)

    return mention ? (mention[1] as string) : null
  }

  if (isRecord(output)) {
    for (const field of ['agent_id', 'agentId', 'id', 'conversation_id']) {
      const value = nonEmptyString(output[field])

      if (value && /^[A-Za-z0-9_-]{1,128}$/u.test(value)) {
        return value
      }
    }
  }

  return null
}

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

export function getStopRecord(
  root: string,
  agentId: string,
): AgentStopRecord | null {
  return getAgentEntry(root, agentId)?.stop ?? null
}

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

/**
 * Agent index storage: bounds and paths, the index record and hook payload
 * shapes, secret redaction and tool-input summaries, the bounded index lock,
 * index read, write, and prune, agent identity resolution, and event appends.
 * The hook entry point loads this module, so it imports only Node built-ins.
 */

import { createHash } from 'node:crypto'
import {
  readFileSync,
  writeFileSync,
  statSync,
  rmSync,
  renameSync,
  mkdirSync,
  appendFileSync,
} from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const AGENTS_DIR = 'runtime/logs/agents'
const INDEX_FILE = 'index.json'
const LOCK_FILE = 'index.lock'
export const SCHEMA_VERSION = 1
const MAX_EVENT_LINE_BYTES = 4096
const MAX_SUMMARY_CHARS = 200
// A truncated path names no file, so a longer one is left off the event line.
export const MAX_TRANSCRIPT_PATH_CHARS = 1024
const MAX_ID_CHARS = 128
const HEARTBEAT_THROTTLE_MS = 15_000
// Cost-backed bound: it keeps index.json small and its rewrite fast.
const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1_000
const LOCK_ATTEMPTS = 10
const LOCK_RETRY_SLEEP_MS = 25
// A lock file whose owner never wrote its pid is stale after this long.
const EMPTY_LOCK_STALE_MS = 5_000

const SECRET_NAME =
  /TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL|AUTH|SESSION/i
const MIN_SECRET_LENGTH = 8
const INLINE_ASSIGNMENT = /\b([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S+)/g
const SECRET_FLAG =
  /(--?[A-Za-z0-9_-]*(?:token|secret|password|passwd|api[-_]?key|credential)[A-Za-z0-9_-]*)(=|\s+)(\S+)/gi

export const SHELL_TOOLS = new Set(['Shell', 'Bash', 'run_terminal_cmd'])
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

export function lockPath(root: string): string {
  return path.join(agentsDir(root), LOCK_FILE)
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, MAX_ID_CHARS)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function nonEmptyString(value: unknown): string | null {
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

export function redact(text: string, secrets: string[]): string {
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

export function boundedSummary(text: string, secrets: string[]): string {
  const redacted = redact(text, secrets)

  return redacted.length > MAX_SUMMARY_CHARS
    ? redacted.slice(0, MAX_SUMMARY_CHARS) + '…'
    : redacted
}

export function parseToolInput(
  toolInput: unknown,
): Record<string, unknown> | null {
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
export function withLock(lockFile: string, fn: () => void): boolean {
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

export function readIndex(root: string): AgentIndex {
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

export function writeIndex(
  root: string,
  index: AgentIndex,
  nowIso: string,
): void {
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

export function findAgent(
  index: AgentIndex,
  canonical: string,
): AgentEntry | null {
  return index.agents.find((a) => a.agent_id === canonical) ?? null
}

export function linkAlias(
  index: AgentIndex,
  alias: string,
  canonical: string,
): void {
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

export function newAgentEntry(agentId: string, nowIso: string): AgentEntry {
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
export function resolveActor(
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

export function ensureAgentsDir(root: string): void {
  mkdirSync(agentsDir(root), { recursive: true })
}

export function appendEvent(
  root: string,
  fileId: string,
  event: AgentEvent,
): void {
  let line = JSON.stringify(event)

  if (Buffer.byteLength(line, 'utf8') > MAX_EVENT_LINE_BYTES) {
    line = JSON.stringify({ ...event, summary: undefined })
  }

  appendFileSync(agentEventFile(root, fileId), line + '\n')
}

export function touch(
  entry: AgentEntry,
  nowIso: string,
  kind: EventKind,
): void {
  entry.last_event_at = nowIso
  entry.last_event_kind = kind
}

export function heartbeatDue(entry: AgentEntry, nowIso: string): boolean {
  const lastMs = Date.parse(entry.last_event_at)

  return (
    !Number.isFinite(lastMs) ||
    Date.parse(nowIso) - lastMs >= HEARTBEAT_THROTTLE_MS
  )
}

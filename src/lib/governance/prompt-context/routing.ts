/**
 * The prompt hook: command and role routing, the conversation store, and the
 * hook response.
 */

import { readdirSync } from 'node:fs'
import path from 'node:path'

import { STANDALONE_MODES } from '../../governance-card/modes.js'
import {
  isRecord,
  fileExists,
  readText,
  readJson,
  writeJsonAtomic,
} from '../../io.js'
import type { RunState } from '../../types.js'
import {
  ROLE_SET,
  TURN_REMINDER_STATE_PATH,
  loadTurnReminderRegistry,
  type TurnReminderRegistry,
  type TurnReminderRole,
} from './registry.js'
import { liveRuns } from './cards.js'
import { renderTurnReminder } from './reminders.js'

interface ConversationRecord {
  role: Exclude<TurnReminderRole, 'none'>
  mode: string | null
  updated_at: string
}

interface ConversationStore {
  schema_version: 1
  conversations: Record<string, ConversationRecord>
}

interface PromptPayload {
  conversation_id: string | null
  hook_event_name: string | null
  prompt: string
}

interface RoleResolution {
  role: TurnReminderRole
  mode: string | null
}

export interface PromptContextResponse {
  continue: true
  additional_context?: string
}
// The Copilot runtime in VS Code replaces a project hook's context on the
// first prompt with its own, so session start carries the reminder too.
const HOOK_EVENTS = new Set([
  'beforeSubmitPrompt',
  'UserPromptSubmit',
  'sessionStart',
  'SessionStart',
])
const HORIZON_SESSION_ROOT = 'runtime/logs/horizon'

const SUPERVISOR_COMMAND_ROLES: Record<string, TurnReminderRole> = {
  'pan-start': 'regular-supervisor',
  'pan-resume': 'regular-supervisor',
  'pan-qa-workflow': 'regular-supervisor',
  'pan-cohort': 'cohort-supervisor',
  'pan-horizon': 'long-horizon-supervisor',
}

const STANDALONE_COMMAND_ROLES: Record<string, TurnReminderRole> = {
  'pan-pair': 'pair',
  'pan-shepherd': 'shepherd',
  'pan-debloat': 'debloat',
  'pan-cleanup': 'cleanup',
}

/** Bounded read-only commands, which `OOS-2` excludes from the reminder. */
const EXCLUDED_COMMANDS = new Set([
  'pan-augment',
  'pan-status',
  'pan-summarize-context',
  'pan-validate',
])

function parsePayload(value: unknown): PromptPayload {
  if (!isRecord(value)) {
    throw new Error('hook payload MUST be an object')
  }

  return {
    conversation_id:
      typeof value.conversation_id === 'string' &&
      value.conversation_id.length > 0
        ? value.conversation_id
        : null,
    hook_event_name:
      typeof value.hook_event_name === 'string'
        ? value.hook_event_name
        : typeof value.hookEventName === 'string'
          ? value.hookEventName
          : null,
    prompt: typeof value.prompt === 'string' ? value.prompt : '',
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * Match the opening line of a canonical command source against the body Cursor
 * expands. Projection substitutes `{{…}}` placeholders and Cursor substitutes
 * `$ARGUMENTS`, so both spans match any single-line text.
 */
function commandSourceMarker(root: string, command: string): RegExp | null {
  const source = path.join(
    root,
    'library',
    'cursor',
    'commands',
    `${command}.md`,
  )

  if (!fileExists(source)) {
    return null
  }

  const marker = readText(source)
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  if (!marker) {
    return null
  }

  return new RegExp(
    marker
      .split(/\{\{[A-Z0-9_]+\}\}|\$ARGUMENTS/u)
      .map((fragment) => escapeRegExp(fragment))
      .join('[^\\n]*'),
    'u',
  )
}

function knownCommands(root: string): string[] {
  const directory = path.join(root, 'library', 'cursor', 'commands')

  try {
    return readdirSync(directory)
      .filter((name) => name.startsWith('pan-') && name.endsWith('.md'))
      .map((name) => name.slice(0, -3))
      .sort()
  } catch {
    return []
  }
}

/**
 * The command a turn invokes, or null for an ordinary message. A token is an
 * invocation only in command position at the head of the prompt, and only when
 * it names a projected command. Prose that mentions `pan watch` names a command
 * without invoking one, and classifying it would persist the wrong role.
 */
function explicitCommand(root: string, prompt: string): string | null {
  const commands = new Set(knownCommands(root))
  const head = prompt.trimStart()
  const literal = /^\/(pan-[a-z0-9-]+)\b/u.exec(head)?.[1]

  if (literal && commands.has(literal)) {
    return literal
  }

  const shell = /^(?:\.\/bin\/)?pan\s+([a-z][a-z0-9-]*)\b/u.exec(head)?.[1]

  if (shell && commands.has(`pan-${shell}`)) {
    return `pan-${shell}`
  }

  for (const command of commands) {
    const marker = commandSourceMarker(root, command)

    if (marker?.test(prompt)) {
      return command
    }
  }

  return null
}

function modeForCommand(command: string): string | null {
  const direct = command.slice('pan-'.length)

  if (STANDALONE_MODES[direct]) {
    return direct
  }

  const aliases: Record<string, string> = {
    decompose: 'decomposition',
    'summarize-context': 'unbound',
  }

  return aliases[direct] ?? null
}

function roleForCommand(command: string): RoleResolution {
  const supervisorRole = SUPERVISOR_COMMAND_ROLES[command]

  if (supervisorRole) {
    return { role: supervisorRole, mode: 'supervisor' }
  }

  const standaloneRole = STANDALONE_COMMAND_ROLES[command]

  if (standaloneRole) {
    return {
      role: standaloneRole,
      mode: modeForCommand(command),
    }
  }

  if (
    command === 'pan-meta-orchestrator' ||
    command === 'pan-orchestrator' ||
    EXCLUDED_COMMANDS.has(command)
  ) {
    return { role: 'none', mode: null }
  }

  return { role: 'standalone-other', mode: modeForCommand(command) }
}

function readConversationStore(
  root: string,
  registry: TurnReminderRegistry,
  now: Date,
): ConversationStore {
  const statePath = path.join(root, TURN_REMINDER_STATE_PATH)

  if (!fileExists(statePath)) {
    return { schema_version: 1, conversations: {} }
  }

  // The store is a cache the resolver owns, so unreadable content, an unusable
  // shape, or a single corrupt record is dropped and rewritten on the next
  // turn. Throwing here would leave every conversation without a reminder
  // until the file is deleted by hand, because the caller answers permissively
  // and never writes.
  let value: unknown

  try {
    value = readJson(statePath)
  } catch {
    return { schema_version: 1, conversations: {} }
  }

  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    !isRecord(value.conversations)
  ) {
    return { schema_version: 1, conversations: {} }
  }

  const cutoff =
    now.getTime() - registry.state.max_age_days * 24 * 60 * 60 * 1000
  const conversations: Record<string, ConversationRecord> = {}

  for (const [conversationId, candidate] of Object.entries(
    value.conversations,
  )) {
    if (
      !isRecord(candidate) ||
      typeof candidate.role !== 'string' ||
      !ROLE_SET.has(candidate.role) ||
      candidate.role === 'none' ||
      (candidate.mode !== null && typeof candidate.mode !== 'string') ||
      typeof candidate.updated_at !== 'string'
    ) {
      continue
    }

    const updatedAt = Date.parse(candidate.updated_at)

    if (!Number.isFinite(updatedAt) || updatedAt < cutoff) {
      continue
    }

    conversations[conversationId] = {
      role: candidate.role as Exclude<TurnReminderRole, 'none'>,
      mode: candidate.mode,
      updated_at: candidate.updated_at,
    }
  }

  return { schema_version: 1, conversations }
}

function writeConversationStore(
  root: string,
  registry: TurnReminderRegistry,
  store: ConversationStore,
): void {
  const entries = Object.entries(store.conversations)
    .sort(
      ([, left], [, right]) =>
        Date.parse(right.updated_at) - Date.parse(left.updated_at),
    )
    .slice(0, registry.state.max_entries)

  writeJsonAtomic(path.join(root, TURN_REMINDER_STATE_PATH), {
    schema_version: 1,
    conversations: Object.fromEntries(entries),
  })
}

function hasLiveHorizonSession(root: string): boolean {
  const directory = path.join(root, HORIZON_SESSION_ROOT)

  try {
    return readdirSync(directory, { withFileTypes: true }).some((entry) => {
      if (!entry.isDirectory()) {
        return false
      }

      try {
        const value = readJson(path.join(directory, entry.name, 'session.json'))
        return (
          isRecord(value) &&
          (value.status === 'created' || value.status === 'running')
        )
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}

function inferredSupervisorRole(
  root: string,
  runs: RunState[],
): TurnReminderRole | null {
  if (
    hasLiveHorizonSession(root) ||
    runs.some(
      (run) =>
        run.horizon !== undefined ||
        run.operator_involvement?.contracts?.includes('long_horizon') === true,
    )
  ) {
    return 'long-horizon-supervisor'
  }

  if (runs.some((run) => run.cohort !== undefined)) {
    return 'cohort-supervisor'
  }

  return runs.length > 0 ? 'regular-supervisor' : null
}

function resolveRole(
  root: string,
  payload: PromptPayload,
  store: ConversationStore,
  runs: RunState[],
): RoleResolution {
  if (
    /\b(?:\.\/bin\/)?pan\s+horizon\s+start\b[^\n]*\s--headless\b/u.test(
      payload.prompt,
    )
  ) {
    return { role: 'none', mode: null }
  }

  const command = explicitCommand(root, payload.prompt)

  if (command) {
    return roleForCommand(command)
  }

  if (
    /\bpan-meta-orchestrator\b/u.test(payload.prompt) ||
    /\bpan-orchestrator\b/u.test(payload.prompt)
  ) {
    return { role: 'none', mode: null }
  }

  const stored = payload.conversation_id
    ? store.conversations[payload.conversation_id]
    : undefined
  const inferred = inferredSupervisorRole(root, runs)

  if (stored) {
    if (
      stored.role === 'regular-supervisor' ||
      stored.role === 'cohort-supervisor' ||
      stored.role === 'long-horizon-supervisor'
    ) {
      if (!inferred) {
        return { role: 'unbound', mode: 'unbound' }
      }

      return { role: inferred, mode: 'supervisor' }
    }

    return { role: stored.role, mode: stored.mode }
  }

  return inferred
    ? { role: inferred, mode: 'supervisor' }
    : { role: 'unbound', mode: 'unbound' }
}

/**
 * Handle a prompt-submit hook payload: infer the conversation's reminder role
 * from the prompt, the stored conversation role, and live runs, record that
 * role in the turn reminder state file, and return the rendered governance
 * reminder as `additional_context`. Returns only `{ continue: true }` for other
 * hook events, headless horizon starts, named orchestrator prompts, and any
 * error, so the hook never blocks a prompt.
 */
export function resolvePromptContext(
  root: string,
  payloadText: string,
  now = new Date(),
): PromptContextResponse {
  try {
    const registry = loadTurnReminderRegistry(root)
    const payload = parsePayload(JSON.parse(payloadText))

    if (
      payload.hook_event_name !== null &&
      !HOOK_EVENTS.has(payload.hook_event_name)
    ) {
      return { continue: true }
    }

    const store = readConversationStore(root, registry, now)
    const runs = liveRuns(root)
    const resolution = resolveRole(root, payload, store, runs)

    if (resolution.role === 'none') {
      return { continue: true }
    }

    if (payload.conversation_id) {
      store.conversations[payload.conversation_id] = {
        role: resolution.role,
        mode: resolution.mode,
        updated_at: now.toISOString(),
      }
      writeConversationStore(root, registry, store)
    }

    const reminder = renderTurnReminder(root, resolution.role, {
      mode: resolution.mode,
      registry,
      liveRuns: runs,
    })

    return {
      continue: true,
      additional_context: reminder.content,
    }
  } catch {
    return { continue: true }
  }
}

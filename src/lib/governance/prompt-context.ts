import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { STANDALONE_MODES } from '../governance-card.js'
import {
  fileExists,
  isRecord,
  readJson,
  readText,
  sha256,
  writeJsonAtomic,
} from '../io.js'
import { loadPolicyCatalog } from '../policies.js'
import {
  harnessPathPrefix,
  isTargetInstallation,
  loadProjectConfig,
} from '../project-config.js'
import { listRunStates, runIsLive } from '../state.js'
import type { Policy, RunState } from '../types.js'

export const TURN_REMINDER_REGISTRY_PATH =
  'governance/registries/turn_reminder_profiles.json'
export const TURN_REMINDER_SCHEMA_PATH =
  'library/schemas/turn-reminder-profiles.schema.json'
export const TURN_REMINDER_STATE_PATH = '.cursor/hooks/state/conversations.json'

export const TURN_REMINDER_ROLES = [
  'regular-supervisor',
  'cohort-supervisor',
  'long-horizon-supervisor',
  'unbound',
  'pair',
  'shepherd',
  'debloat',
  'cleanup',
  'standalone-other',
  'none',
] as const

export type TurnReminderRole = (typeof TURN_REMINDER_ROLES)[number]

interface PolicySelector {
  id: string
  type: 'policy'
  policy_id: string
  instruction_sha256: string
}

/**
 * Each installation mode ships a different operating card, so one card
 * selector pins a heading and digest per mode.
 */
export const TURN_REMINDER_CARD_MODES = [
  'self_development',
  'embedded',
  'detached',
] as const

export type TurnReminderCardMode = (typeof TURN_REMINDER_CARD_MODES)[number]

interface CardSection {
  heading: string
  content_sha256: string
}

interface CardSelector {
  id: string
  type: 'card'
  sections: Record<TurnReminderCardMode, CardSection>
}

export type TurnReminderSelector = PolicySelector | CardSelector

interface TurnReminderProfile {
  extends?: string
  selectors: TurnReminderSelector[]
}

export interface TurnReminderRegistry {
  schema_version: 1
  byte_budget: number
  state: {
    max_age_days: number
    max_entries: number
  }
  profiles: Record<string, TurnReminderProfile>
  roles: Record<TurnReminderRole, string | null>
}

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

interface ActiveCard {
  path: string
  sha256: string
}

export interface PromptContextResponse {
  continue: true
  additional_context?: string
}

export interface ResolvedReminderLine {
  selector_id: string
  source: string
  content: string
}

export interface RenderedTurnReminder {
  role: Exclude<TurnReminderRole, 'none'>
  profile: string
  lines: ResolvedReminderLine[]
  card: ActiveCard
  content: string
  byte_length: number
}

const ROLE_SET = new Set<string>(TURN_REMINDER_ROLES)
const SHA256_PATTERN = /^[a-f0-9]{64}$/u
const SELECTOR_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/u
const POLICY_ID_PATTERN = /^[A-Z][A-Z0-9-]*$/u
const PROFILE_ID_PATTERN = SELECTOR_ID_PATTERN
const CARD_HEADING_PATTERN = /^#{1,6} /u
const HOOK_EVENTS = new Set(['beforeSubmitPrompt', 'UserPromptSubmit'])
const HORIZON_SESSION_ROOT = 'runtime/logs/horizon'
const STANDALONE_SESSION_ROOT = 'runtime/logs/sessions'
const CARD_PATH = 'AGENTS.md'

/**
 * The card template an installer writes for each target mode. Validating them
 * alongside the live card proves an install before it can fail on a selector
 * the installed card does not carry.
 */
const CARD_MODE_TEMPLATES: Partial<Record<TurnReminderCardMode, string>> = {
  embedded: 'library/templates/embedded-AGENTS.md',
  detached: 'library/templates/detached-AGENTS.md',
}

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

function invalid(message: string): never {
  throw new Error(`turn reminder registry: ${message}`)
}

function positiveInteger(value: unknown, source: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    invalid(`${source} MUST be a positive integer.`)
  }

  return value as number
}

function nonEmptyString(value: unknown, source: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    invalid(`${source} MUST be a non-empty string.`)
  }

  return value
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  source: string,
): void {
  const allowedSet = new Set(allowed)
  const extra = Object.keys(value).filter((key) => !allowedSet.has(key))

  if (extra.length > 0) {
    invalid(`${source} contains unknown key '${extra[0]}'.`)
  }
}

function parseSelector(value: unknown, source: string): TurnReminderSelector {
  if (!isRecord(value)) {
    invalid(`${source} MUST be an object.`)
  }

  const id = nonEmptyString(value.id, `${source}.id`)

  if (!SELECTOR_ID_PATTERN.test(id)) {
    invalid(`${source}.id MUST be a lowercase selector id.`)
  }

  if (value.type === 'policy') {
    assertOnlyKeys(
      value,
      ['id', 'type', 'policy_id', 'instruction_sha256'],
      source,
    )
    const policyId = nonEmptyString(value.policy_id, `${source}.policy_id`)
    const digest = nonEmptyString(
      value.instruction_sha256,
      `${source}.instruction_sha256`,
    )

    if (!POLICY_ID_PATTERN.test(policyId)) {
      invalid(`${source}.policy_id MUST be a policy id.`)
    }

    if (!SHA256_PATTERN.test(digest)) {
      invalid(`${source}.instruction_sha256 MUST be a SHA-256 digest.`)
    }

    return {
      id,
      type: 'policy',
      policy_id: policyId,
      instruction_sha256: digest,
    }
  }

  if (value.type === 'card') {
    assertOnlyKeys(value, ['id', 'type', 'sections'], source)

    if (!isRecord(value.sections)) {
      invalid(`${source}.sections MUST be an object.`)
    }

    assertOnlyKeys(
      value.sections,
      TURN_REMINDER_CARD_MODES,
      `${source}.sections`,
    )
    const sections = {} as Record<TurnReminderCardMode, CardSection>

    for (const mode of TURN_REMINDER_CARD_MODES) {
      const section = value.sections[mode]

      if (!isRecord(section)) {
        invalid(`${source}.sections.${mode} MUST be an object.`)
      }

      assertOnlyKeys(
        section,
        ['heading', 'content_sha256'],
        `${source}.sections.${mode}`,
      )
      const heading = nonEmptyString(
        section.heading,
        `${source}.sections.${mode}.heading`,
      )
      const digest = nonEmptyString(
        section.content_sha256,
        `${source}.sections.${mode}.content_sha256`,
      )

      if (!CARD_HEADING_PATTERN.test(heading)) {
        invalid(
          `${source}.sections.${mode}.heading MUST be a Markdown heading.`,
        )
      }

      if (!SHA256_PATTERN.test(digest)) {
        invalid(
          `${source}.sections.${mode}.content_sha256 MUST be a SHA-256 digest.`,
        )
      }

      sections[mode] = { heading, content_sha256: digest }
    }

    return { id, type: 'card', sections }
  }

  invalid(`${source}.type MUST be 'policy' or 'card'.`)
}

export function parseTurnReminderRegistry(
  value: unknown,
  source = TURN_REMINDER_REGISTRY_PATH,
): TurnReminderRegistry {
  if (!isRecord(value)) {
    invalid(`${source} MUST contain an object.`)
  }

  assertOnlyKeys(
    value,
    ['schema_version', 'byte_budget', 'state', 'profiles', 'roles'],
    source,
  )

  if (value.schema_version !== 1) {
    invalid(`${source}.schema_version MUST equal 1.`)
  }

  if (!isRecord(value.state)) {
    invalid(`${source}.state MUST be an object.`)
  }

  assertOnlyKeys(
    value.state,
    ['max_age_days', 'max_entries'],
    `${source}.state`,
  )

  if (!isRecord(value.profiles)) {
    invalid(`${source}.profiles MUST be an object.`)
  }

  const profiles: Record<string, TurnReminderProfile> = {}

  for (const [profileId, candidate] of Object.entries(value.profiles)) {
    if (!PROFILE_ID_PATTERN.test(profileId)) {
      invalid(`${source}.profiles.${profileId} MUST use a lowercase id.`)
    }

    if (!isRecord(candidate)) {
      invalid(`${source}.profiles.${profileId} MUST be an object.`)
    }

    assertOnlyKeys(
      candidate,
      ['extends', 'selectors'],
      `${source}.profiles.${profileId}`,
    )

    if (!Array.isArray(candidate.selectors)) {
      invalid(`${source}.profiles.${profileId}.selectors MUST be an array.`)
    }

    const selectors = candidate.selectors.map((selector, index) =>
      parseSelector(
        selector,
        `${source}.profiles.${profileId}.selectors[${index}]`,
      ),
    )
    const selectorIds = selectors.map((selector) => selector.id)

    if (new Set(selectorIds).size !== selectorIds.length) {
      invalid(
        `${source}.profiles.${profileId} contains a duplicate selector id.`,
      )
    }

    const parent =
      candidate.extends === undefined
        ? null
        : nonEmptyString(
            candidate.extends,
            `${source}.profiles.${profileId}.extends`,
          )

    if (parent !== null && !PROFILE_ID_PATTERN.test(parent)) {
      invalid(`${source}.profiles.${profileId}.extends MUST name a profile.`)
    }

    profiles[profileId] = {
      ...(parent === null ? {} : { extends: parent }),
      selectors,
    }
  }

  if (Object.keys(profiles).length === 0) {
    invalid(`${source}.profiles MUST NOT be empty.`)
  }

  if (!isRecord(value.roles)) {
    invalid(`${source}.roles MUST be an object.`)
  }

  assertOnlyKeys(value.roles, TURN_REMINDER_ROLES, `${source}.roles`)
  const roles = {} as Record<TurnReminderRole, string | null>

  for (const role of TURN_REMINDER_ROLES) {
    const profile = value.roles[role]

    if (role === 'none') {
      if (profile !== null) {
        invalid(`${source}.roles.none MUST be null.`)
      }
      roles[role] = null
      continue
    }

    const profileId = nonEmptyString(profile, `${source}.roles.${role}`)

    if (!profiles[profileId]) {
      invalid(
        `${source}.roles.${role} references unknown profile '${profileId}'.`,
      )
    }

    roles[role] = profileId
  }

  const registry: TurnReminderRegistry = {
    schema_version: 1,
    byte_budget: positiveInteger(value.byte_budget, `${source}.byte_budget`),
    state: {
      max_age_days: positiveInteger(
        value.state.max_age_days,
        `${source}.state.max_age_days`,
      ),
      max_entries: positiveInteger(
        value.state.max_entries,
        `${source}.state.max_entries`,
      ),
    },
    profiles,
    roles,
  }

  for (const profileId of Object.keys(profiles)) {
    resolveProfileSelectors(registry, profileId)
  }

  return registry
}

export function loadTurnReminderRegistry(root: string): TurnReminderRegistry {
  return parseTurnReminderRegistry(
    readJson(path.join(root, TURN_REMINDER_REGISTRY_PATH)),
  )
}

export function resolveProfileSelectors(
  registry: TurnReminderRegistry,
  profileId: string,
  stack: string[] = [],
): TurnReminderSelector[] {
  const profile = registry.profiles[profileId]

  if (!profile) {
    invalid(`unknown profile '${profileId}'.`)
  }

  if (stack.includes(profileId)) {
    invalid(`profile inheritance cycle: ${[...stack, profileId].join(' -> ')}.`)
  }

  const inherited = profile.extends
    ? resolveProfileSelectors(registry, profile.extends, [...stack, profileId])
    : []
  const selectors = [...inherited, ...profile.selectors]
  const ids = selectors.map((selector) => selector.id)

  if (new Set(ids).size !== ids.length) {
    invalid(`profile '${profileId}' resolves a duplicate selector id.`)
  }

  return selectors
}

function cardSection(root: string, cardPath: string, heading: string): string {
  const lines = readText(path.join(root, cardPath)).trim().split('\n')
  const start = lines.findIndex((line) => line.trimEnd() === heading)

  if (start < 0) {
    invalid(`card selector heading '${heading}' was not found in ${cardPath}.`)
  }

  const depth = heading.match(/^#+/u)?.[0].length ?? 0
  let end = lines.length

  for (let index = start + 1; index < lines.length; index += 1) {
    const match = /^(#{1,6}) /u.exec(lines[index] ?? '')

    if (match && match[1].length <= depth) {
      end = index
      break
    }
  }

  return lines.slice(start, end).join('\n').trim()
}

function resolveCardSelector(
  root: string,
  cardPath: string,
  selector: CardSelector,
  cardMode: TurnReminderCardMode,
): ResolvedReminderLine {
  const section = selector.sections[cardMode]
  const content = cardSection(root, cardPath, section.heading)
  const digest = sha256(content)

  if (digest !== section.content_sha256) {
    invalid(
      `card selector '${selector.id}' for '${section.heading}' in ` +
        `${cardPath} is stale: expected ${section.content_sha256}, ` +
        `received ${digest}.`,
    )
  }

  return {
    selector_id: selector.id,
    source: `${cardPath} · ${section.heading}`,
    content,
  }
}

function resolveSelector(
  root: string,
  catalog: Map<string, Policy>,
  selector: TurnReminderSelector,
  cardMode: TurnReminderCardMode,
): ResolvedReminderLine {
  if (selector.type === 'card') {
    return resolveCardSelector(root, CARD_PATH, selector, cardMode)
  }

  const policy = catalog.get(selector.policy_id)

  if (!policy) {
    invalid(
      `policy selector '${selector.id}' references missing policy ` +
        `'${selector.policy_id}'.`,
    )
  }

  const instruction = policy.instructions.find(
    (candidate) => sha256(candidate.text) === selector.instruction_sha256,
  )

  if (!instruction) {
    invalid(
      `policy selector '${selector.id}' for '${selector.policy_id}' is stale: ` +
        `no instruction has digest ${selector.instruction_sha256}.`,
    )
  }

  return {
    selector_id: selector.id,
    source: selector.policy_id,
    content: instruction.text,
  }
}

export function installationCardMode(root: string): TurnReminderCardMode {
  const mode = loadProjectConfig(root).installation_mode

  return mode === 'embedded' || mode === 'detached' ? mode : 'self_development'
}

export function resolveTurnReminderLines(
  root: string,
  profileId: string,
  registry = loadTurnReminderRegistry(root),
  cardMode = installationCardMode(root),
): ResolvedReminderLine[] {
  const catalog = loadPolicyCatalog(root)

  return resolveProfileSelectors(registry, profileId).map((selector) =>
    resolveSelector(root, catalog, selector, cardMode),
  )
}

function renderReminderContent(
  role: Exclude<TurnReminderRole, 'none'>,
  profile: string,
  lines: ResolvedReminderLine[],
  card: ActiveCard,
): string {
  const groups = new Map<string, string[]>()

  for (const line of lines) {
    const group = groups.get(line.source) ?? []
    group.push(line.content)
    groups.set(line.source, group)
  }

  const sections = [...groups.entries()].flatMap(([source, contents]) => [
    `[${source}]`,
    ...contents,
    '',
  ])

  return [
    'Pancreator governance reminder',
    `Role: ${role}`,
    `Profile: ${profile}`,
    '',
    ...sections,
    `Active card: ${card.path} (sha256:${card.sha256})`,
  ].join('\n')
}

export function renderTurnReminder(
  root: string,
  role: Exclude<TurnReminderRole, 'none'>,
  options: {
    mode?: string | null
    card?: ActiveCard
    registry?: TurnReminderRegistry
    liveRuns?: RunState[]
  } = {},
): RenderedTurnReminder {
  const registry = options.registry ?? loadTurnReminderRegistry(root)
  const profile = registry.roles[role]

  if (profile === null) {
    invalid(`role '${role}' does not declare a reminder profile.`)
  }

  const lines = resolveTurnReminderLines(root, profile, registry)
  const card =
    options.card ??
    activeCard(
      root,
      role,
      options.mode ?? null,
      options.liveRuns ?? liveRuns(root),
    )
  const content = renderReminderContent(role, profile, lines, card)
  const byteLength = Buffer.byteLength(content, 'utf8')

  if (byteLength > registry.byte_budget) {
    invalid(
      `profile '${profile}' for role '${role}' renders ${byteLength} bytes, ` +
        `over the ${registry.byte_budget}-byte budget.`,
    )
  }

  return {
    role,
    profile,
    lines,
    card,
    content,
    byte_length: byteLength,
  }
}

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

function liveRuns(root: string): RunState[] {
  return listRunStates(root)
    .filter(runIsLive)
    .sort(
      (left, right) =>
        Date.parse(right.updated_at) - Date.parse(left.updated_at),
    )
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

function fallbackCard(root: string): ActiveCard {
  return {
    path: CARD_PATH,
    sha256: sha256(readText(path.join(root, CARD_PATH))),
  }
}

function supervisorCard(runs: RunState[]): ActiveCard | null {
  for (const run of runs) {
    const card = run.supervisor_card

    if (card) {
      return { path: card.path, sha256: card.sha256 }
    }
  }

  return null
}

function latestStandaloneCard(root: string, mode: string): ActiveCard | null {
  const sessions = path.join(root, STANDALONE_SESSION_ROOT)
  const filename = `${mode}-card.md`
  let latest: { path: string; mtimeMs: number } | null = null

  try {
    for (const entry of readdirSync(sessions, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue
      }

      const absolute = path.join(sessions, entry.name, filename)

      if (!fileExists(absolute)) {
        continue
      }

      const mtimeMs = statSync(absolute).mtimeMs

      if (!latest || mtimeMs > latest.mtimeMs) {
        latest = {
          path: path.posix.join(STANDALONE_SESSION_ROOT, entry.name, filename),
          mtimeMs,
        }
      }
    }
  } catch {
    return null
  }

  if (!latest) {
    return null
  }

  return {
    path: latest.path,
    sha256: sha256(readText(path.join(root, latest.path))),
  }
}

/**
 * Cursor runs the hook from the target workspace, so an installed harness
 * cites its card by the path an agent there can open: under `.pancreator/`
 * for an embedded harness, and under the absolute harness root for a
 * detached one. Self-development already runs at the harness root.
 */
function workspaceCard(root: string, card: ActiveCard): ActiveCard {
  if (!isTargetInstallation(root)) {
    return card
  }

  return {
    path: path.join(harnessPathPrefix(root), card.path),
    sha256: card.sha256,
  }
}

function activeCard(
  root: string,
  role: Exclude<TurnReminderRole, 'none'>,
  mode: string | null,
  runs: RunState[],
): ActiveCard {
  const card =
    role === 'regular-supervisor' ||
    role === 'cohort-supervisor' ||
    role === 'long-horizon-supervisor'
      ? (supervisorCard(runs) ?? fallbackCard(root))
      : ((mode ? latestStandaloneCard(root, mode) : null) ?? fallbackCard(root))

  return workspaceCard(root, card)
}

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

function validateCardModeTemplates(
  root: string,
  registry: TurnReminderRegistry,
): string[] {
  const errors: string[] = []
  const selectors = new Map<string, CardSelector>()

  for (const profile of Object.values(registry.profiles)) {
    for (const selector of profile.selectors) {
      if (selector.type === 'card') {
        selectors.set(selector.id, selector)
      }
    }
  }

  for (const selector of selectors.values()) {
    for (const [mode, cardPath] of Object.entries(CARD_MODE_TEMPLATES) as Array<
      [TurnReminderCardMode, string]
    >) {
      if (!fileExists(path.join(root, cardPath))) {
        continue
      }

      try {
        resolveCardSelector(root, cardPath, selector, mode)
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
  }

  return errors
}

export function validateTurnReminderProfiles(root: string): string[] {
  try {
    const registry = loadTurnReminderRegistry(root)
    const errors: string[] = []
    const card = fallbackCard(root)

    for (const role of TURN_REMINDER_ROLES) {
      if (role === 'none') {
        continue
      }

      try {
        renderTurnReminder(root, role, {
          card,
          registry,
          liveRuns: [],
        })
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }

    errors.push(...validateCardModeTemplates(root, registry))

    return [...new Set(errors)]
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)]
  }
}

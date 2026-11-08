/**
 * Hook route for deferred policy clauses. A tool hook decides which triggers
 * a call fires, collects the deferred clauses those triggers name that the
 * scope has no receipt for, delivers them once, and records a receipt. The
 * pull route (`pan governance clause`) writes the same receipts.
 */

import path from 'node:path'

import { fileExists, isRecord, readJson } from '../../io.js'
import {
  clauseReceiptPath,
  hasClauseReceipt,
  readClauseReceipts,
  recordClauseFired,
  recordClauseReceipt,
  SESSION_RECEIPT_SCOPE,
  type ClauseReceipt,
} from '../../policy-clause.js'
import {
  deferredClauseGroups,
  type DeferredClauseGroup,
} from '../../policy-deferred.js'
import { loadPolicyCatalog } from '../../policies.js'
import { isInvocationContext } from '../../policy-delivery.js'
import { listRunStatesWhere, runIsLive } from '../../state.js'
import type {
  Invocation,
  Policy,
  PolicyCapabilities,
  PolicyLoad,
} from '../../types.js'
import { liveRuns } from './cards.js'

/** Tool classes whose first use is held back until its clauses are delivered. */
export const PRE_TOOL_DENY_CLASSES: readonly string[] = [
  'browser',
  'delegation',
  'edit',
  'git-remote',
  'question',
]

const EDIT_TOOLS = new Set([
  'Write',
  'StrReplace',
  'Delete',
  'EditNotebook',
  'ApplyPatch',
  'Edit',
  'MultiEdit',
])
const DELEGATION_TOOLS = new Set(['Task', 'Subagent'])
const BROWSER_TOOL =
  /(?:^|[:_/-])(?:browser_[a-z_]+|new_page|navigate_page|take_snapshot|take_screenshot|list_pages|select_page|close_page|chrome-devtools|playwright)(?:$|[:_/-])/iu
const GIT_REMOTE =
  /\b(?:git\s+(?:push|pull|fetch|remote|clone)|gh\s+(?:pr|release|repo|api))\b/u

/** What a hook call fires. Triggers derive from it; nothing else reads the payload. */
export interface FiredContext {
  classes: string[]
  events: string[]
  /** Workspace-relative POSIX paths the call touches. */
  paths: string[]
}

function recordInput(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value

  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)

      return isRecord(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  return {}
}

function relativePath(root: string, candidate: string): string {
  const resolved = path.isAbsolute(candidate)
    ? path.relative(root, candidate)
    : path.normalize(candidate)

  return resolved.split(path.sep).join('/')
}

/** Tool classes a call belongs to. A call can belong to several. */
export function toolClasses(
  toolName: string | null,
  toolInput: Record<string, unknown>,
): string[] {
  if (!toolName) return []

  const classes: string[] = []
  const command = typeof toolInput.command === 'string' ? toolInput.command : ''

  if (toolName === 'Shell' || toolName === 'Bash' || toolName === 'bash') {
    classes.push('shell')
    if (GIT_REMOTE.test(command)) classes.push('git-remote')
  } else if (DELEGATION_TOOLS.has(toolName)) {
    classes.push('delegation')
  } else if (EDIT_TOOLS.has(toolName)) {
    classes.push('edit')
  } else if (toolName === 'AskQuestion') {
    classes.push('question')
  } else if (BROWSER_TOOL.test(toolName)) {
    classes.push('browser')
  }

  if (toolName.startsWith('MCP:')) {
    classes.push(`mcp:${toolName.slice(4).split(':')[0]}`)
  }

  return classes
}

/** Workspace-relative paths an edit call touches. */
export function touchedPaths(
  root: string,
  toolInput: Record<string, unknown>,
): string[] {
  const keys = ['path', 'file_path', 'target_file', 'notebook_path']
  const found = keys.flatMap((key) => {
    const value = toolInput[key]

    return typeof value === 'string' && value.length > 0 ? [value] : []
  })

  return [...new Set(found.map((entry) => relativePath(root, entry)))]
}

/** Convert a `path:` glob to a matcher: `**`, `*`, `?`, and `{a,b}`. */
export function globMatcher(glob: string): RegExp {
  let source = ''
  let braceDepth = 0

  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]

    if (char === '*') {
      if (glob[index + 1] === '*') {
        index += 1
        if (glob[index + 1] === '/') {
          index += 1
          source += '(?:.*/)?'
        } else {
          source += '.*'
        }
      } else {
        source += '[^/]*'
      }
    } else if (char === '?') {
      source += '[^/]'
    } else if (char === '{') {
      braceDepth += 1
      source += '(?:'
    } else if (char === '}') {
      if (braceDepth > 0) braceDepth -= 1
      source += ')'
    } else if (char === ',') {
      source += braceDepth > 0 ? '|' : ','
    } else {
      source += char.replaceAll(/[.+^$()|[\]\\]/gu, '\\$&')
    }
  }

  return new RegExp(`^${source}$`, 'u')
}

/** True when the fired context satisfies a deferred clause's trigger. */
export function triggerFires(
  trigger: PolicyLoad,
  fired: FiredContext,
): boolean {
  if (trigger.startsWith('tool:')) {
    return fired.classes.includes(trigger.slice('tool:'.length))
  }

  if (trigger.startsWith('event:')) {
    return fired.events.includes(trigger.slice('event:'.length))
  }

  if (trigger.startsWith('path:')) {
    const matcher = globMatcher(trigger.slice('path:'.length))

    return fired.paths.some((entry) => matcher.test(entry))
  }

  return false
}

export interface DeliveryScope {
  scope: string
  policies: Policy[]
  capabilities: PolicyCapabilities
  audiences: ('agent' | 'supervisor')[]
}

const FULL_CAPABILITIES: PolicyCapabilities = { shell: true, delegation: true }

function safeScope(value: string | null): string {
  return value && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)
    ? value
    : SESSION_RECEIPT_SCOPE
}

/**
 * The scope a hook call delivers into. A live invocation worker uses its own
 * invocation id and the policies its snapshot pins; any other agent shares a
 * per-conversation ledger and sees the whole catalog.
 */
export function deliveryScope(
  root: string,
  conversationId: string | null,
): DeliveryScope {
  const indexPath = path.join(root, 'runtime/logs/agents/index.json')

  if (conversationId && fileExists(indexPath)) {
    const index = readJson(indexPath)

    if (isRecord(index) && Array.isArray(index.agents)) {
      const aliases = isRecord(index.aliases) ? index.aliases : {}
      const identity = aliases[conversationId] ?? conversationId
      const worker = index.agents.find(
        (entry: unknown) =>
          isRecord(entry) &&
          entry.agent_id === identity &&
          typeof entry.run_id === 'string' &&
          typeof entry.invocation_id === 'string',
      )

      if (isRecord(worker)) {
        const active = liveRuns(root).find(
          (run) => run.run_id === worker.run_id,
        )?.current_invocation

        if (active && active.id === worker.invocation_id) {
          const snapshot: unknown = readJson(
            path.resolve(root, active.json_path),
          )

          if (isInvocationContext(snapshot)) {
            const invocation: Invocation = snapshot

            return {
              scope: safeScope(invocation.invocation_id),
              policies: invocation.policies,
              capabilities: invocation.capabilities ?? FULL_CAPABILITIES,
              audiences: ['agent'],
            }
          }
        }
      }
    }
  }

  return {
    scope: safeScope(conversationId),
    policies: [...loadPolicyCatalog(root).values()],
    capabilities: FULL_CAPABILITIES,
    audiences: ['agent', 'supervisor'],
  }
}

/**
 * Receipts that count for this delivery. A conversation hook also reads the
 * session ledger, because `pan governance clause` with no invocation writes
 * there. An invocation scope does not: a session pull must not stand in for
 * a worker who never received the clause.
 */
function receiptsFor(
  root: string,
  delivery: DeliveryScope,
): readonly ClauseReceipt[] {
  const own = readClauseReceipts(root, delivery.scope)

  if (
    delivery.scope === SESSION_RECEIPT_SCOPE ||
    !delivery.audiences.includes('supervisor')
  ) {
    return own
  }

  return [...own, ...readClauseReceipts(root, SESSION_RECEIPT_SCOPE)]
}

/** Deferred groups the fired context triggers and the scope has no receipt for. */
export function pendingDeferredGroups(
  delivery: DeliveryScope,
  fired: FiredContext,
  receipts: readonly ClauseReceipt[],
): { group: DeferredClauseGroup; title: string }[] {
  const pending = new Map<
    string,
    { group: DeferredClauseGroup; title: string }
  >()

  for (const policy of delivery.policies) {
    for (const audience of delivery.audiences) {
      for (const group of deferredClauseGroups(
        policy,
        audience,
        delivery.capabilities,
      )) {
        const key = `${group.policy_id}\u0000${group.trigger}`

        if (
          !pending.has(key) &&
          triggerFires(group.trigger, fired) &&
          !hasClauseReceipt(receipts, group.policy_id, group.trigger)
        ) {
          pending.set(key, { group, title: policy.title })
        }
      }
    }
  }

  return [...pending.values()]
}

/** Render pending groups as one block, in the card's clause text. */
export function renderDeferredDelivery(
  pending: readonly { group: DeferredClauseGroup; title: string }[],
): string {
  return [
    '# Deferred policy clauses',
    '',
    ...pending.flatMap(({ group, title }) => [
      `**${group.policy_id} · ${title}** · \`${group.trigger}\``,
      '',
      ...group.texts.map((text) => `- ${text}`),
      '',
    ]),
  ]
    .join('\n')
    .trimEnd()
}

/**
 * Deliver once. Returns the text to inject, or null when nothing is pending.
 * A receipt lands for every delivered group, so a later call stays silent.
 */
export function deliverDeferredClauses(
  root: string,
  conversationId: string | null,
  fired: FiredContext,
  now: Date = new Date(),
  delivery: DeliveryScope = deliveryScope(root, conversationId),
): string | null {
  const pending = pendingDeferredGroups(
    delivery,
    fired,
    receiptsFor(root, delivery),
  )

  if (pending.length === 0) return null

  for (const { group } of pending) {
    recordClauseReceipt(root, delivery.scope, group, 'hook', now)
  }

  return renderDeferredDelivery(pending)
}

/**
 * True when the operator prompt opens with the slash command or the `pan`
 * command. A mention later in the prompt does not fire the event.
 */
function promptOpens(prompt: string, command: string): boolean {
  return new RegExp(
    `^\\s*(?:\\/pan-${command}\\b|(?:\\.\\/bin\\/)?pan\\s+${command}\\b)`,
    'u',
  ).test(prompt)
}

/**
 * Build the fired context from a tool-hook payload. `away` and `pause` are
 * also state events: `away` fires on every hook call while a live run
 * snapshots away mode as enabled, and `pause` while a run is paused, because
 * operators pause from the CLI and the resuming session sees only `resume`.
 */
export function firedContext(
  root: string,
  input: {
    hookEvent: string | null
    toolName: string | null
    toolInput: unknown
    prompt: string
  },
): FiredContext {
  const toolInput = recordInput(input.toolInput)
  const classes = toolClasses(input.toolName, toolInput)
  const events: string[] = []
  const failed =
    input.hookEvent === 'postToolUseFailure' ||
    input.hookEvent === 'PostToolUseFailure'

  if (failed) events.push('tool_failure')
  if (promptOpens(input.prompt, 'resume')) events.push('resume')
  const watched = listRunStatesWhere(
    root,
    (run) => run.away_mode?.enabled === true || run.status === 'paused',
  ).filter(runIsLive)

  if (
    promptOpens(input.prompt, 'pause') ||
    watched.some((run) => run.status === 'paused')
  ) {
    events.push('pause')
  }
  if (watched.some((run) => run.away_mode?.enabled === true)) {
    events.push('away')
  }

  return {
    classes,
    events,
    paths: classes.includes('edit') ? touchedPaths(root, toolInput) : [],
  }
}

export interface PreToolDecision {
  permission: 'allow' | 'deny'
  user_message?: string
  agent_message?: string
}

/**
 * Deny a first call once so the agent reads the clauses before it acts. The
 * receipt lands with the denial, so the retry passes. Only the classes in
 * `PRE_TOOL_DENY_CLASSES` are held; other classes receive clauses after use.
 */
export function preToolDecision(
  root: string,
  conversationId: string | null,
  fired: FiredContext,
  now: Date = new Date(),
  suppliedDelivery?: DeliveryScope,
): PreToolDecision {
  const delivery = suppliedDelivery ?? deliveryScope(root, conversationId)

  // Every trigger this call fires is recorded, so a clause that never
  // reaches the agent shows up at submit as fired without a receipt.
  for (const { group } of pendingDeferredGroups(
    delivery,
    { ...fired, events: [] },
    receiptsFor(root, delivery),
  )) {
    recordClauseFired(root, delivery.scope, group, now)
  }

  const held: FiredContext = {
    ...fired,
    classes: fired.classes.filter((entry) =>
      PRE_TOOL_DENY_CLASSES.includes(entry),
    ),
    events: [],
  }

  if (held.classes.length === 0 && held.paths.length === 0) {
    return { permission: 'allow' }
  }

  const text = deliverDeferredClauses(root, conversationId, held, now, delivery)

  return text === null
    ? { permission: 'allow' }
    : {
        permission: 'deny',
        user_message:
          'Pancreator loaded deferred policy clauses for this call. The agent retries once.',
        agent_message: `${text}\n\nRead the clauses above, then repeat the same call. It will pass.`,
      }
}

export { clauseReceiptPath }

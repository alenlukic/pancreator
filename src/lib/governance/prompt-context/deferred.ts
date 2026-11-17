/**
 * Hook route for deferred policy clauses. A tool hook decides which triggers
 * a call fires, collects the deferred clauses those triggers name that the
 * scope has no receipt for, delivers them once, and records a receipt. The
 * pull route (`pan governance clause`) writes the same receipts.
 */

import path from 'node:path'

import { readJson } from '../../io.js'
import {
  normalizeToolPaths,
  policyToolEvidence,
  recordInput,
} from '../../policy-tool-evidence.js'
export { toolClasses } from '../../policy-tool-evidence.js'
import {
  workerDelivery,
  findInvocationWorker,
} from '../../policy-worker-scope.js'
import {
  clauseReceiptPath,
  hasClauseReceipt,
  readClauseReceipts,
  readClauseFired,
  recordClauseFired,
  recordClauseReceipt,
  SESSION_RECEIPT_SCOPE,
  type ClauseReceipt,
} from '../../policy-clause.js'
import {
  deferredClauseGroups,
  deferredClauseCommand,
  type DeferredClauseGroup,
} from '../../policy-deferred.js'
import { loadPolicyCatalog } from '../../policies.js'
import { isInvocationContext } from '../../policy-delivery.js'
import { readInstallationIdentity } from '../../project-config.js'
import { listRunStatesWhere, runIsLive } from '../../state.js'
import type {
  Policy,
  PolicyCapabilities,
  PolicyLoad,
  RunState,
} from '../../types.js'
import { liveRuns } from './cards.js'
import { loadTurnReminderRegistry } from './registry.js'

/** Tool classes whose first use is held back until its clauses are delivered. */
export const PRE_TOOL_DENY_CLASSES: readonly string[] = [
  'browser',
  'delegation',
  'shell',
  'edit',
  'git-remote',
  'question',
]

const SAME_REASON_PAUSE =
  /^Stage '[^']+' failed twice consecutively for the same deterministic reason \(.*\)\.$/u

function isSameReasonPause(run: RunState): boolean {
  // Trackers survive ordinary pauses and resumes and are created after the
  // first failure. Only the circuit breaker's pause reason identifies this
  // event; an operator/supervisor pause is not a gate failure.
  return (
    run.status === 'paused' &&
    run.operator_pause == null &&
    typeof run.pause_reason === 'string' &&
    SAME_REASON_PAUSE.test(run.pause_reason)
  )
}

/** What a hook call fires. Triggers derive from it; nothing else reads the payload. */
export interface FiredContext {
  classes: string[]
  events: string[]
  /** Workspace-relative POSIX paths the call touches. */
  paths: string[]
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

    return fired.paths.some(
      (entry) =>
        matcher.test(entry) ||
        (trigger.endsWith('/**') && matcher.test(`${entry}/`)),
    )
  }

  return false
}

export interface DeliveryScope {
  scope: string
  policies: Policy[]
  capabilities: PolicyCapabilities
  audiences: ('agent' | 'supervisor')[]
  /** Pinned workspace for a registered invocation, independent of host cwd. */
  workspaceRoot?: string
  invocationId?: string
  workerId?: string
}

const FULL_CAPABILITIES: PolicyCapabilities = { shell: true, delegation: true }

function safeScope(value: string | null): string {
  return value && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)
    ? value
    : SESSION_RECEIPT_SCOPE
}

/**
 * The scope a hook call delivers into. A live invocation worker uses its own
 * invocation-and-agent scope and the policies its snapshot pins; any other agent shares a
 * per-conversation ledger and sees the whole catalog.
 */
export function deliveryScope(
  root: string,
  conversationId: string | null,
  parentToolCallId?: string | null,
): DeliveryScope {
  const worker = findInvocationWorker(root, conversationId, parentToolCallId)
  if (worker) {
    const active = liveRuns(root).find(
      (run) => run.run_id === worker.run_id,
    )?.current_invocation
    if (active && active.id === worker.invocation_id) {
      const snapshot: unknown = readJson(path.resolve(root, active.json_path))
      if (isInvocationContext(snapshot))
        return workerDelivery(root, snapshot, worker)
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
  outstanding: ReturnType<typeof readClauseFired> = [],
): { group: DeferredClauseGroup; title: string }[] {
  const pending = new Map<
    string,
    { group: DeferredClauseGroup; title: string }
  >()

  const audience = delivery.audiences.includes('supervisor')
    ? 'supervisor'
    : 'agent'
  for (const policy of delivery.policies) {
    for (const group of deferredClauseGroups(
      policy,
      audience,
      delivery.capabilities,
    )) {
      const key = `${group.policy_id}\u0000${group.trigger}`
      if (
        (triggerFires(group.trigger, fired) ||
          outstanding.some(
            (entry) =>
              entry.policy_id === group.policy_id &&
              entry.trigger === group.trigger &&
              entry.sha256 === group.sha256,
          )) &&
        !hasClauseReceipt(
          receipts,
          group.policy_id,
          group.trigger,
          group.sha256,
        )
      ) {
        pending.set(key, { group, title: policy.title })
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

/** The configured budget applies to the entire host text, not each group. */
export function hookByteBudget(root: string): number {
  try {
    return loadTurnReminderRegistry(root).byte_budget
  } catch {
    // Older installations and minimal fixtures may have no registry.
    return 10240
  }
}

const bytes = (text: string) => Buffer.byteLength(text, 'utf8')
const REMINDER_FALLBACK =
  'Read the complete active governance card, its pinned reminder, and AGENTS.md operating principles before proceeding.'

/** Never slice a normative reminder or a UTF-8 codepoint to fit the host. */
export function boundedReminder(text: string, budget: number): string {
  if (bytes(text) <= budget) return text
  return bytes(REMINDER_FALLBACK) <= budget ? REMINDER_FALLBACK : ''
}

function shellWord(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}

/** Use the actual harness root even when the worker is in another worktree. */
function recoveryCommand(
  root: string,
  delivery: DeliveryScope,
  group: DeferredClauseGroup,
): string {
  const command = deferredClauseCommand(
    group.policy_id,
    group.trigger,
    shellWord(path.resolve(root, 'bin/pan')),
  )
  return `${shellWord(path.resolve(root, 'bin/pan-run'))} --stream -- ${command}${group.pullArgs ? ` ${group.pullArgs}` : ''}${delivery.invocationId ? ` --invocation ${shellWord(delivery.invocationId)}` : ''}${delivery.workerId ? ` --worker ${shellWord(delivery.workerId)}` : ''}`
}

interface DeliveryOptions {
  base?: string
  suffix?: string
  budget?: number
  includeOutstanding?: boolean
}

/**
 * Fit complete groups or their pull commands. Plan the entire text before
 * writing receipts. Keep the eager reminder whenever the recovery notice fits;
 * otherwise explicitly direct the agent to its complete pinned reminder.
 */
export function deliverDeferredClauses(
  root: string,
  conversationId: string | null,
  fired: FiredContext,
  now: Date = new Date(),
  delivery: DeliveryScope = deliveryScope(root, conversationId),
  options: DeliveryOptions = {},
): string | null {
  const pending = pendingDeferredGroups(
    delivery,
    fired,
    receiptsFor(root, delivery),
    options.includeOutstanding ? readClauseFired(root, delivery.scope) : [],
  )
  if (pending.length === 0) return null

  for (const { group } of pending) {
    recordClauseFired(root, delivery.scope, group, now)
  }

  const budget = options.budget ?? hookByteBudget(root)
  let base = boundedReminder(options.base ?? '', budget)
  const suffix = options.suffix ?? ''
  const pullInstruction = delivery.capabilities.shell
    ? 'Read the complete pull output (or its full pan-run log if the host truncates it).'
    : 'Ask the supervisor to execute the scoped pull and relay the complete text; you have no shell.'
  const heading = '# Deferred policy clauses'
  const notice =
    'Pending clauses: retrieve the applicable groups from the active card’s Deferred policy index before proceeding. Unresolved groups remain pending.'
  const compose = (parts: string[], pulls = false) =>
    [base, heading, ...parts, pulls ? pullInstruction : '', suffix]
      .filter(Boolean)
      .join('\n\n')
  const full = pending.map(({ group, title }) =>
    [
      `**${group.policy_id} · ${title}** · \`${group.trigger}\``,
      '',
      ...group.texts.map((text) => `- ${text}`),
    ].join('\n'),
  )
  const commands = pending.map(
    ({ group }) =>
      `Retrieve ${group.policy_id} (\`${group.trigger}\`):\n\`${recoveryCommand(root, delivery, group)}\``,
  )
  if (bytes(compose(full)) <= budget) {
    pending.forEach(({ group }) =>
      recordClauseReceipt(root, delivery.scope, group, 'hook', now),
    )
    return compose(full)
  }

  // Reserve recovery instructions for *every* group before fitting bodies.
  // If even the commands cannot fit, the compact notice plus as many complete
  // commands as fit provides a recovery path. Future hooks re-offer outstanding
  // groups, including one-off events, rather than forgetting them.
  let parts = [...commands]
  if (bytes(compose(parts, true)) > budget) {
    // Keep the base unless it prevents even one usable pull command.
    if (base && bytes(compose([notice, commands[0]], true)) > budget)
      base = REMINDER_FALLBACK
    parts = [notice]
    if (bytes(compose(parts, true)) > budget) {
      // A pathological budget may not even hold the notice. Fail closed for
      // pre-tool calls and leave every obligation outstanding.
      return boundedReminder(
        [base, notice].filter(Boolean).join('\n\n'),
        budget,
      )
    }
    for (const command of commands) {
      if (bytes(compose([...parts, command], true)) <= budget)
        parts.push(command)
    }
    return compose(parts, true)
  }

  // A small group can be delivered alongside a large group's pull fallback.
  const delivered = []
  for (let index = 0; index < pending.length; index += 1) {
    const candidate = parts.map((part, i) => (i === index ? full[index] : part))
    if (bytes(compose(candidate, true)) <= budget) {
      parts = candidate
      delivered.push(pending[index].group)
    }
  }
  const text = compose(parts, true)
  delivered.forEach((group) =>
    recordClauseReceipt(root, delivery.scope, group, 'hook', now),
  )
  return text
}

/**
 * A pull must not be blocked by the very shell clause it retrieves. Exempt
 * only an exact, generated, single wrapped command for an outstanding group
 * in this scope; arbitrary commands, chaining and sibling pulls stay guarded.
 */
export function isDeferredRecoveryPull(
  root: string,
  delivery: DeliveryScope,
  fired: FiredContext,
  input: unknown,
): boolean {
  if (
    !delivery.capabilities.shell ||
    fired.classes.length !== 1 ||
    fired.classes[0] !== 'shell' ||
    fired.paths.length
  )
    return false
  const command = recordInput(input).command
  if (typeof command !== 'string') return false
  return pendingDeferredGroups(
    delivery,
    fired,
    receiptsFor(root, delivery),
    readClauseFired(root, delivery.scope),
  ).some(
    ({ group }) => command.trim() === recoveryCommand(root, delivery, group),
  )
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
 * Build the fired context from a tool-hook payload. `away`, `pause`, and
 * `gate_failure` are also state events: `away` fires on every hook call while
 * a live run snapshots away mode as enabled, `pause` while a run is paused,
 * and `gate_failure` while a live run is paused for a repeated hard-failure
 * signature, because operators resume from the CLI and the session sees only
 * `resume`.
 */
export function firedContext(
  root: string,
  input: {
    hookEvent: string | null
    toolName: string | null
    toolInput: unknown
    toolOutput?: unknown
    workspaceRoots?: string[]
    workspaceRoot?: string
    prompt: string
  },
): FiredContext {
  const failed =
    input.hookEvent === 'postToolUseFailure' ||
    input.hookEvent === 'PostToolUseFailure'
  const { classes, events, paths } = policyToolEvidence(
    input.toolName,
    input.toolInput,
    input.toolOutput,
    failed,
  )
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
  if (watched.some(isSameReasonPause)) {
    events.push('gate_failure')
  }

  const pathTool = paths.length > 0
  // The hook's root is the harness, not necessarily the active workspace.
  // Host roots also identify worktrees whose absolute paths lie outside it.
  const workspaceRoots =
    input.workspaceRoots?.filter((entry) => path.isAbsolute(entry)) ?? []
  const workspaces = !pathTool
    ? []
    : input.workspaceRoot
      ? [input.workspaceRoot]
      : workspaceRoots.length > 0
        ? workspaceRoots
        : [
            path.resolve(
              root,
              readInstallationIdentity(root)?.workspace_root ?? '.',
            ),
          ]

  return {
    classes,
    events,
    paths: pathTool
      ? [
          ...new Set(
            workspaces.flatMap((workspace) =>
              normalizeToolPaths(workspace, paths),
            ),
          ),
        ]
      : [],
  }
}

export interface PreToolDecision {
  permission: 'allow' | 'deny'
  user_message?: string
  agent_message?: string
}

/**
 * Deny a first call once so the agent reads the clauses before it acts. The
 * receipt lands only for a complete body; a pull fallback holds the retry
 * until retrieval. Only the classes in
 * `PRE_TOOL_DENY_CLASSES` are held; other classes receive clauses after use.
 */
export function preToolDecision(
  root: string,
  conversationId: string | null,
  fired: FiredContext,
  now: Date = new Date(),
  suppliedDelivery?: DeliveryScope,
  toolInput?: unknown,
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

  if (isDeferredRecoveryPull(root, delivery, held, toolInput)) {
    return { permission: 'allow' }
  }

  const text = deliverDeferredClauses(
    root,
    conversationId,
    held,
    now,
    delivery,
    {
      suffix:
        'Read the clauses above, retrieve any listed clauses, then repeat the original call.',
    },
  )

  return text === null
    ? { permission: 'allow' }
    : {
        permission: 'deny',
        user_message:
          'Pancreator requires deferred policy clauses before this call.',
        agent_message: text,
      }
}

export { clauseReceiptPath }

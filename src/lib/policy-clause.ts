/**
 * Pull route for deferred policy clauses. `pan governance clause` resolves one
 * policy's clauses for a trigger, prints them in the card's text, and records
 * a receipt. The hook route and the submit check read the same receipts.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { PanError } from './errors.js'
import { appendJsonLine, isRecord, readJson, resolveInside } from './io.js'
import {
  DEFAULT_PAN_COMMAND,
  deferredClauseGroups,
  type DeferredClauseGroup,
} from './policy-deferred.js'
import { isInvocationContext } from './policy-delivery.js'
import {
  findInvocationWorker,
  invocationWorkers,
  workerDelivery,
} from './policy-worker-scope.js'
import { isPolicyLoad } from './policy-instructions.js'
import { loadPolicyCatalog } from './policies.js'
import { listRunStatesWhere } from './state.js'
import type { PolicyCapabilities, PolicyLoad } from './types.js'

/** Receipt scope used when no invocation names one (operator and standalone sessions). */
export const SESSION_RECEIPT_SCOPE = 'session'

/** How a deferred clause reached the agent. */
export type ClauseDeliveryRoute = 'pull' | 'hook' | 'inline'

export interface ClauseReceipt {
  scope: string
  policy_id: string
  trigger: PolicyLoad
  sha256: string
  route: ClauseDeliveryRoute
  delivered_at: string
}

export interface ResolvedClause {
  group: DeferredClauseGroup
  /** The text a card would render for these clauses. */
  text: string
  scope?: string
}

const ALL_CAPABILITIES: PolicyCapabilities = { shell: true, delegation: true }

function receiptScope(scope: string | undefined): string {
  const value = (scope ?? SESSION_RECEIPT_SCOPE).trim()

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)) {
    throw new PanError(
      `Receipt scope '${value}' MUST be an invocation id or a plain name.`,
      { code: 'INVALID_ARGUMENT' },
    )
  }

  return value
}

/** Absolute path of one scope's receipt ledger. */
export function clauseReceiptPath(
  root: string,
  scope: string | undefined,
): string {
  return path.join(
    root,
    'runtime',
    'policy-clauses',
    `${receiptScope(scope)}.jsonl`,
  )
}

/** Parse the capability list a pull call carries, e.g. `shell,delegation`. */
export function parseClauseCapabilities(
  value: string | undefined,
): PolicyCapabilities {
  if (value === undefined) return { ...ALL_CAPABILITIES }

  const names = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  const unknown = names.filter((name) => !(name in ALL_CAPABILITIES))

  if (unknown.length > 0) {
    throw new PanError(
      `Unknown capability: ${unknown.join(', ')}. Accepted: shell, delegation.`,
      { code: 'INVALID_ARGUMENT' },
    )
  }

  return {
    shell: names.includes('shell'),
    delegation: names.includes('delegation'),
  }
}

/** Resolve one policy's deferred clauses for one trigger. */
export function resolveDeferredClause(
  root: string,
  request: {
    policyId: string
    trigger: string
    audience?: 'agent' | 'supervisor'
    capabilities?: PolicyCapabilities
    invocationId?: string
    workerId?: string
  },
): ResolvedClause {
  if (!isPolicyLoad(request.trigger) || request.trigger === 'invocation') {
    throw new PanError(
      `Trigger '${request.trigger}' MUST be tool:<class>, event:<id>, or path:<glob>.`,
      { code: 'INVALID_ARGUMENT' },
    )
  }

  // A worker's hook and card use its prepared snapshot, not a policy edited
  // after launch. Resolve a scoped pull from the same bytes.
  const worker = request.workerId
    ? findInvocationWorker(root, request.workerId)
    : undefined
  if (request.workerId && !worker)
    throw new PanError(`Unknown invocation worker: ${request.workerId}`, {
      code: 'INVALID_ARGUMENT',
    })
  const invocationId =
    request.invocationId ?? worker?.invocation_id ?? undefined
  if (worker && worker.invocation_id !== invocationId)
    throw new PanError('Worker belongs to another invocation.', {
      code: 'INVALID_ARGUMENT',
    })
  const active = invocationId
    ? listRunStatesWhere(
        root,
        (run) => run.current_invocation?.id === invocationId,
      ).find((run) => run.current_invocation?.id === invocationId)
        ?.current_invocation
    : undefined
  const snapshot = active
    ? readJson(resolveInside(root, active.json_path))
    : undefined

  if (
    active &&
    (!isInvocationContext(snapshot) || snapshot.invocation_id !== active.id)
  ) {
    throw new PanError(`Invalid invocation snapshot: ${active.id}`, {
      code: 'INVALID_ARGUMENT',
    })
  }

  const invocation = isInvocationContext(snapshot) ? snapshot : undefined
  if (worker && (!invocation || invocation.run_id !== worker.run_id))
    throw new PanError('Worker has no matching active invocation.', {
      code: 'INVALID_ARGUMENT',
    })
  // A legacy firing with no applicable registered worker still needs a
  // recoverable invocation-wide pull. It can never satisfy a worker scope.
  if (
    invocation &&
    !worker &&
    invocationWorkers(root, invocation).length > 0 &&
    !undeliveredClauses(root, invocation.invocation_id).some(
      (entry) =>
        entry.policy_id === request.policyId &&
        entry.trigger === request.trigger,
    )
  )
    throw new PanError(
      'Name the receiving worker with --worker <agent-id>; an invocation-wide receipt cannot satisfy an individual worker.',
      { code: 'INVALID_ARGUMENT' },
    )
  const delivery =
    invocation && worker ? workerDelivery(root, invocation, worker) : undefined
  const policy = invocation
    ? (delivery?.policies ?? invocation.policies).find(
        (entry) => entry.id === request.policyId,
      )
    : loadPolicyCatalog(root).get(request.policyId)

  if (!policy) {
    throw new PanError(`Unknown policy: ${request.policyId}`, {
      code: 'UNKNOWN_POLICY',
    })
  }

  const groups = deferredClauseGroups(
    policy,
    delivery ? 'agent' : (request.audience ?? 'agent'),
    delivery?.capabilities ??
      invocation?.capabilities ??
      request.capabilities ??
      ALL_CAPABILITIES,
  )
  const group = groups.find((entry) => entry.trigger === request.trigger)

  if (!group) {
    const offered = groups.map((entry) => entry.trigger)

    throw new PanError(
      `Policy ${policy.id} defers no clause for ${request.trigger}.` +
        (offered.length > 0
          ? ` Deferred triggers: ${offered.join(', ')}.`
          : ' It defers no clauses.'),
      { code: 'UNKNOWN_TRIGGER' },
    )
  }

  return {
    group,
    scope: delivery?.scope ?? invocationId,
    text: [
      `**${policy.id} · ${policy.title}** · \`${group.trigger}\``,
      '',
      ...group.texts.map((text) => `- ${text}`),
    ].join('\n'),
  }
}

/** Append one receipt to a scope's ledger and return it. */
export function recordClauseReceipt(
  root: string,
  scope: string | undefined,
  clause: Pick<DeferredClauseGroup, 'policy_id' | 'trigger' | 'sha256'>,
  route: ClauseDeliveryRoute,
  now: Date = new Date(),
): ClauseReceipt {
  const receipt: ClauseReceipt = {
    scope: receiptScope(scope),
    policy_id: clause.policy_id,
    trigger: clause.trigger,
    sha256: clause.sha256,
    route,
    delivered_at: now.toISOString(),
  }

  appendJsonLine(clauseReceiptPath(root, scope), receipt)

  return receipt
}

/** Read a scope's receipts, oldest first. A malformed line is skipped. */
export function readClauseReceipts(
  root: string,
  scope: string | undefined,
): ClauseReceipt[] {
  const file = clauseReceiptPath(root, scope)

  if (!existsSync(file)) return []

  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line): ClauseReceipt[] => {
      try {
        const value: unknown = JSON.parse(line)

        return isRecord(value) &&
          value.scope === receiptScope(scope) &&
          typeof value.policy_id === 'string' &&
          typeof value.trigger === 'string' &&
          isPolicyLoad(value.trigger) &&
          typeof value.sha256 === 'string' &&
          typeof value.delivered_at === 'string'
          ? [value as unknown as ClauseReceipt]
          : []
      } catch {
        return []
      }
    })
}

/** True when the scope holds a receipt for the policy and trigger. */
export function hasClauseReceipt(
  receipts: readonly ClauseReceipt[],
  policyId: string,
  trigger: PolicyLoad,
  sha256?: string,
): boolean {
  return receipts.some(
    (receipt) =>
      receipt.policy_id === policyId &&
      receipt.trigger === trigger &&
      (sha256 === undefined || receipt.sha256 === sha256),
  )
}

/** Absolute path of one scope's fired-trigger ledger. */
export function clauseFiredPath(
  root: string,
  scope: string | undefined,
): string {
  return path.join(
    root,
    'runtime',
    'policy-clauses',
    `${receiptScope(scope)}.fired.jsonl`,
  )
}

/** A trigger the harness saw fire, whether or not its clauses arrived. */
export interface ClauseFired {
  scope: string
  policy_id: string
  trigger: PolicyLoad
  fired_at: string
  sha256?: string
}

/** Record that a trigger fired, once per policy and trigger. */
export function recordClauseFired(
  root: string,
  scope: string | undefined,
  group: Pick<DeferredClauseGroup, 'policy_id' | 'trigger'> &
    Partial<Pick<DeferredClauseGroup, 'sha256'>>,
  now: Date = new Date(),
): ClauseFired | null {
  const existing = readClauseFired(root, scope)

  if (
    existing.some(
      (entry) =>
        entry.policy_id === group.policy_id &&
        entry.trigger === group.trigger &&
        entry.sha256 === group.sha256,
    )
  ) {
    return null
  }

  const entry: ClauseFired = {
    scope: receiptScope(scope),
    policy_id: group.policy_id,
    trigger: group.trigger,
    fired_at: now.toISOString(),
    ...(group.sha256 ? { sha256: group.sha256 } : {}),
  }

  appendJsonLine(clauseFiredPath(root, scope), entry)

  return entry
}

/** Read a scope's fired triggers, oldest first. A malformed line is skipped. */
export function readClauseFired(
  root: string,
  scope: string | undefined,
): ClauseFired[] {
  const file = clauseFiredPath(root, scope)

  if (!existsSync(file)) return []

  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line): ClauseFired[] => {
      try {
        const value: unknown = JSON.parse(line)

        return isRecord(value) &&
          value.scope === receiptScope(scope) &&
          typeof value.policy_id === 'string' &&
          typeof value.trigger === 'string' &&
          isPolicyLoad(value.trigger) &&
          typeof value.fired_at === 'string'
          ? [value as unknown as ClauseFired]
          : []
      } catch {
        return []
      }
    })
}

/** Fired triggers of a scope that hold no receipt. */
export function undeliveredClauses(
  root: string,
  scope: string | undefined,
): ClauseFired[] {
  const receipts = readClauseReceipts(root, scope)

  return readClauseFired(root, scope).filter(
    (entry) =>
      !hasClauseReceipt(receipts, entry.policy_id, entry.trigger, entry.sha256),
  )
}

export { DEFAULT_PAN_COMMAND }

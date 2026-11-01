/**
 * Pull route for deferred policy clauses. `pan governance clause` resolves one
 * policy's clauses for a trigger, prints them in the card's text, and records
 * a receipt. The hook route and the submit check read the same receipts.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { PanError } from './errors.js'
import { appendJsonLine, isRecord } from './io.js'
import {
  DEFAULT_PAN_COMMAND,
  deferredClauseGroups,
  type DeferredClauseGroup,
} from './policy-deferred.js'
import { isPolicyLoad } from './policy-instructions.js'
import { loadPolicyCatalog } from './policies.js'
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
  },
): ResolvedClause {
  if (!isPolicyLoad(request.trigger) || request.trigger === 'invocation') {
    throw new PanError(
      `Trigger '${request.trigger}' MUST be tool:<class>, event:<id>, or path:<glob>.`,
      { code: 'INVALID_ARGUMENT' },
    )
  }

  const policy = loadPolicyCatalog(root).get(request.policyId)

  if (!policy) {
    throw new PanError(`Unknown policy: ${request.policyId}`, {
      code: 'UNKNOWN_POLICY',
    })
  }

  const groups = deferredClauseGroups(
    policy,
    request.audience ?? 'agent',
    request.capabilities ?? ALL_CAPABILITIES,
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
): boolean {
  return receipts.some(
    (receipt) => receipt.policy_id === policyId && receipt.trigger === trigger,
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
}

/** Record that a trigger fired, once per policy and trigger. */
export function recordClauseFired(
  root: string,
  scope: string | undefined,
  group: Pick<DeferredClauseGroup, 'policy_id' | 'trigger'>,
  now: Date = new Date(),
): ClauseFired | null {
  const existing = readClauseFired(root, scope)

  if (
    existing.some(
      (entry) =>
        entry.policy_id === group.policy_id && entry.trigger === group.trigger,
    )
  ) {
    return null
  }

  const entry: ClauseFired = {
    scope: receiptScope(scope),
    policy_id: group.policy_id,
    trigger: group.trigger,
    fired_at: now.toISOString(),
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
    (entry) => !hasClauseReceipt(receipts, entry.policy_id, entry.trigger),
  )
}

export { DEFAULT_PAN_COMMAND }

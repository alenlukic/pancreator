/** Canonical, locally recoverable reminders for the VS Code OpenAI path. */

import path from 'node:path'

import { PanError } from '../../errors.js'
import { canonicalize, readText, resolveInside, sha256 } from '../../io.js'
import { loadPolicyCatalog } from '../../policies.js'
import { deferredClauseGroups } from '../../policy-deferred.js'
import {
  initialPolicyReminder,
  isInvocationContext,
} from '../../policy-delivery.js'
import type { Policy, PolicyCapabilities } from '../../types.js'
import { activeCard, type ActiveCard } from './cards.js'
import { renderDeferredDelivery } from './deferred.js'
import { ROLE_SET, type TurnReminderRole } from './registry.js'
import { principlesReminder, renderTurnReminder } from './reminders.js'

export interface CanonicalReminderOptions {
  host: string
  provider: string
  session: string
  role: string
  card?: string
  invocation?: string
  expectedIdentity?: string
}

export interface CanonicalReminder {
  schema_version: 1
  scope: {
    host: 'vscode'
    provider: 'openai'
    workspace: string
    session: string
    role: string
    invocation: string | null
    persona: string | null
  }
  card: ActiveCard
  content: string
  deferred_content: string
  content_sha256: string
  policy_sha256: string
  identity: string
}

interface ReminderSources {
  card: ActiveCard
  content: string
  policies: Policy[]
  capabilities: PolicyCapabilities
  audiences: ('agent' | 'supervisor')[]
  invocation: string | null
  persona: string | null
}

function reminderSources(
  root: string,
  options: CanonicalReminderOptions,
): ReminderSources {
  if (options.invocation !== undefined) {
    if (options.role !== 'worker' || options.card !== undefined) {
      throw new PanError('--invocation requires --role worker and no --card.', {
        code: 'INVALID_CANONICAL_REMINDER',
      })
    }

    const source = resolveInside(root, options.invocation)
    const snapshotText = readText(source)
    const invocation: unknown = JSON.parse(snapshotText)

    if (
      !isInvocationContext(invocation) ||
      invocation.context_contract_version !== 1
    ) {
      throw new PanError('A current invocation context is required.', {
        code: 'INVALID_CANONICAL_REMINDER',
      })
    }

    const relative = path.relative(root, source)

    return {
      card: { path: relative, sha256: sha256(snapshotText) },
      content: initialPolicyReminder(invocation, relative).reminder.content,
      policies: invocation.policies,
      capabilities: invocation.capabilities ?? {
        shell: true,
        delegation: true,
      },
      audiences: ['agent'],
      invocation: invocation.invocation_id,
      persona: invocation.stage.persona,
    }
  }

  if (!ROLE_SET.has(options.role) || options.role === 'none') {
    throw new PanError(`Unsupported reminder role: ${options.role}`, {
      code: 'INVALID_CANONICAL_REMINDER',
    })
  }

  const card =
    options.card === undefined
      ? activeCard(root)
      : {
          path: path.relative(root, resolveInside(root, options.card)),
          sha256: sha256(readText(resolveInside(root, options.card))),
        }
  const reminder = renderTurnReminder(
    root,
    options.role as Exclude<TurnReminderRole, 'none'>,
    { card },
  )

  return {
    card,
    content: reminder.content,
    policies: [...loadPolicyCatalog(root).values()],
    capabilities: { shell: true, delegation: true },
    audiences: ['agent', 'supervisor'],
    invocation: null,
    persona: null,
  }
}

function canonicalDeferredContent(sources: ReminderSources): string {
  const groups = new Map<
    string,
    ReturnType<typeof deferredClauseGroups>[number]
  >()

  for (const policy of sources.policies) {
    for (const audience of sources.audiences) {
      for (const group of deferredClauseGroups(
        policy,
        audience,
        sources.capabilities,
      )) {
        const key = `${group.policy_id}\u0000${group.trigger}`
        const existing = groups.get(key)

        groups.set(
          key,
          existing
            ? {
                ...group,
                texts: [...new Set([...existing.texts, ...group.texts])],
              }
            : group,
        )
      }
    }
  }

  if (groups.size === 0) {
    return ''
  }

  return renderDeferredDelivery(
    [...groups.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([, group]) => ({
        group,
        title:
          sources.policies.find((policy) => policy.id === group.policy_id)
            ?.title ?? group.policy_id,
      })),
  )
}

/**
 * Read the full reminder and applicable deferred clauses without delivery
 * receipts, live run selection, or cache-presence claims. Identity covers the
 * complete content and its workspace, session, role, and pinned contract.
 */
export function canonicalReminder(
  root: string,
  options: CanonicalReminderOptions,
): CanonicalReminder {
  if (
    options.host !== 'vscode' ||
    options.provider !== 'openai' ||
    options.session.trim().length === 0
  ) {
    throw new PanError(
      'Canonical reminders require VS Code, OpenAI, and a nonempty session.',
      {
        code: 'INVALID_CANONICAL_REMINDER',
      },
    )
  }

  const sources = reminderSources(root, options)
  const content = `${sources.content}\n\n${principlesReminder(root)}`
  const deferred = canonicalDeferredContent(sources)
  const scope: CanonicalReminder['scope'] = {
    host: 'vscode',
    provider: 'openai',
    workspace: canonicalize(root),
    session: options.session,
    role: options.role,
    invocation: sources.invocation,
    persona: sources.persona,
  }
  const body = {
    schema_version: 1 as const,
    scope,
    card: sources.card,
    content,
    deferred_content: deferred,
    content_sha256: sha256({ content, deferred_content: deferred }),
    policy_sha256: sha256(sources.policies),
  }
  const identity = sha256(body)

  if (
    options.expectedIdentity !== undefined &&
    options.expectedIdentity !== identity
  ) {
    throw new PanError(
      'Canonical reminder identity changed; reread without --expect to recover the current reminder.',
      {
        code: 'STALE_CANONICAL_REMINDER',
      },
    )
  }

  return { ...body, identity }
}

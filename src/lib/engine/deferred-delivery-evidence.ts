/** Reconcile delivery against execution records written outside the delivery hooks. */
import path from 'node:path'
import { loadEventsForEntry } from '../agent-index/activity.js'
import { readAgentShellRecords } from '../agent-index/shell-records.js'
import type { AgentEntry, AgentEvent } from '../agent-index/store.js'
import { isRecord, readJson, resolveInside } from '../io.js'
import {
  pendingDeferredGroups,
  type FiredContext,
} from '../governance/prompt-context/deferred.js'
import {
  readClauseReceipts,
  readClauseFired,
  hasClauseReceipt,
  type ClauseFired,
} from '../policy-clause.js'
import { deferredClauseGroups } from '../policy-deferred.js'
import {
  normalizeToolPaths,
  policyToolEvidence,
} from '../policy-tool-evidence.js'
import {
  invocationWorkers,
  workerDelivery,
  workerHasInlineDelivery,
} from '../policy-worker-scope.js'
import type { Invocation } from '../types.js'

export interface MissingWorkerClause extends ClauseFired {
  worker_id?: string
}

/** Historical tool events kept the tool name and a redacted input summary. */
function eventContext(event: AgentEvent): FiredContext {
  if (event.policy_context) return event.policy_context
  const summary = event.summary ?? ''
  return policyToolEvidence(
    event.tool_name ?? null,
    { command: summary, path: summary },
    undefined,
    event.kind === 'call_failed',
  )
}

function workerEvidence(
  root: string,
  invocation: Invocation,
  agent: AgentEntry,
): FiredContext {
  const classes = new Set<string>()
  const events = new Set<string>()
  const paths = new Set<string>()
  const workspace = path.resolve(root, invocation.workspace_root ?? '.')
  const ids = new Set([agent.agent_id, ...agent.aliases])
  // A background worker can start before its launch record or subagentStart
  // arrives. The prepared invocation, not the registration timestamp, is
  // the earliest boundary for evidence owned by its canonical identity.
  const since = Date.parse(invocation.created_at)
  const add = (context: FiredContext) => {
    context.classes.forEach((value) => classes.add(value))
    context.events.forEach((value) => events.add(value))
    normalizeToolPaths(workspace, context.paths).forEach((value) =>
      paths.add(value),
    )
  }
  for (const event of loadEventsForEntry(root, agent)) {
    if (
      !ids.has(event.agent_id) ||
      Date.parse(event.timestamp) < since ||
      (event.invocation_id &&
        event.invocation_id !== invocation.invocation_id) ||
      (event.run_id && event.run_id !== invocation.run_id)
    )
      continue
    if (
      event.kind === 'call_started' ||
      event.kind === 'call_finished' ||
      event.kind === 'call_failed'
    )
      add(eventContext(event))
  }
  // A pan-run record can prove shell use even if neither tool hook ran. Do not
  // attribute unbound or supervisor commands, or a previous invocation's calls.
  if (Number.isFinite(since)) {
    for (const record of readAgentShellRecords(
      root,
      ids,
      since,
      Date.now(),
      null,
    )) {
      if (!record.started_at || Date.parse(record.started_at) < since) continue
      classes.add('shell')
      const raw = readJson(resolveInside(root, record.record_path))
      if (isRecord(raw) && Array.isArray(raw.command)) {
        add(
          policyToolEvidence(
            'Shell',
            { command: raw.command.join(' ') },
            undefined,
            false,
          ),
        )
      }
    }
  }
  return { classes: [...classes], events: [...events], paths: [...paths] }
}

/** The invocation ledger is retained for unbound/legacy and inline delivery;
 * registered workers must satisfy their own obligations, including evidence
 * that never reached the deferred-policy hook. */
export function missingDeferredDelivery(
  root: string,
  invocation: Invocation,
): MissingWorkerClause[] {
  const workers = invocationWorkers(root, invocation)
  const legacy = readClauseFired(root, invocation.invocation_id)
  const mapped = new Set<ClauseFired>()
  const missing: MissingWorkerClause[] = []
  for (const worker of workers) {
    const delivery = workerDelivery(root, invocation, worker)
    const receipts = readClauseReceipts(root, delivery.scope)
    if (workerHasInlineDelivery(root, invocation, worker)) {
      receipts.push(
        ...readClauseReceipts(root, invocation.invocation_id).filter(
          (receipt) => receipt.route === 'inline',
        ),
      )
    }
    // Match exact bytes from the pinned worker policy set, not a live catalog.
    const pending = pendingDeferredGroups(
      delivery,
      workerEvidence(root, invocation, worker),
      receipts,
    )
    const byClause = new Map<string, MissingWorkerClause>()
    // An old invocation-wide firing cannot identify which sibling used a
    // tool. Conservatively require each applicable worker's pinned group.
    // A stage-wide receipt, even if already present, is not worker delivery.
    for (const entry of legacy) {
      const policy = delivery.policies.find(
        (item) => item.id === entry.policy_id,
      )
      const group =
        policy &&
        deferredClauseGroups(policy, 'agent', delivery.capabilities).find(
          (item) => item.trigger === entry.trigger,
        )
      if (!group) continue
      mapped.add(entry)
      if (
        hasClauseReceipt(receipts, group.policy_id, group.trigger, group.sha256)
      )
        continue
      byClause.set(`${group.policy_id}:${group.trigger}:${group.sha256}`, {
        ...entry,
        scope: delivery.scope,
        sha256: group.sha256,
        worker_id: worker.agent_id,
      })
    }
    for (const entry of readClauseFired(root, delivery.scope)) {
      if (
        hasClauseReceipt(receipts, entry.policy_id, entry.trigger, entry.sha256)
      )
        continue
      byClause.set(`${entry.policy_id}:${entry.trigger}:${entry.sha256}`, {
        ...entry,
        worker_id: worker.agent_id,
      })
    }
    for (const { group } of pending) {
      byClause.set(`${group.policy_id}:${group.trigger}:${group.sha256}`, {
        scope: delivery.scope,
        policy_id: group.policy_id,
        trigger: group.trigger,
        sha256: group.sha256,
        fired_at: new Date().toISOString(),
        worker_id: worker.agent_id,
      })
    }
    missing.push(...byClause.values())
  }
  // Keep the old scope for obligations that cannot be attributed to a
  // registered worker (including historical and unbound invocations).
  const legacyReceipts = readClauseReceipts(root, invocation.invocation_id)
  missing.push(
    ...legacy.filter(
      (entry) =>
        !mapped.has(entry) &&
        !hasClauseReceipt(
          legacyReceipts,
          entry.policy_id,
          entry.trigger,
          entry.sha256,
        ),
    ),
  )
  return missing
}

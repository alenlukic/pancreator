/** Resolve a worker's policy delivery identity independently of its stage. */
import path from 'node:path'
import {
  findAgent,
  newAgentEntry,
  readIndex,
  resolveCanonicalId,
  type AgentEntry,
} from './agent-index/store.js'
import { sha256 } from './io.js'
import { listRunStatesWhere, loadState } from './state.js'
import type { Invocation, InvocationEvidenceWorker } from './types.js'
import type { DeliveryScope } from './governance/prompt-context/deferred.js'

export function findInvocationWorker(
  root: string,
  identity: string | null,
  parentToolCallId?: string | null,
): AgentEntry | undefined {
  const index = readIndex(root)
  const canonical =
    (identity ? resolveCanonicalId(index, identity) : null) ??
    (parentToolCallId ? resolveCanonicalId(index, parentToolCallId) : null)
  const worker = canonical ? findAgent(index, canonical) : null
  if (worker?.run_id && worker.invocation_id) return worker
  // A supervisor launch record is independent of subagentStart. If the host
  // omitted that hook, a known handle still identifies the worker.
  const identities = new Set(
    [identity, parentToolCallId, canonical].filter(Boolean),
  )
  if (!identities.size) return undefined
  for (const run of listRunStatesWhere(root, (run) =>
    (run.delegated_workers ?? []).some((record) =>
      identities.has(record.handle),
    ),
  )) {
    const record = (run.delegated_workers ?? []).find(
      (record) =>
        record.invocation_id === run.current_invocation?.id &&
        identities.has(record.handle),
    )
    if (record)
      return {
        ...(worker ?? newAgentEntry(record.handle, record.launched_at)),
        run_id: run.run_id,
        invocation_id: record.invocation_id,
        worker_role: record.role,
      }
  }
  return undefined
}

export function invocationWorkers(
  root: string,
  invocation: Invocation,
): AgentEntry[] {
  const index = readIndex(root)
  const workers = index.agents.filter(
    (worker) =>
      worker.run_id === invocation.run_id &&
      worker.invocation_id === invocation.invocation_id,
  )
  if (!invocation.run_id) return workers // older minimal test fixtures
  for (const record of loadState(root, invocation.run_id).delegated_workers ??
    []) {
    if (record.invocation_id !== invocation.invocation_id) continue
    const id = resolveCanonicalId(index, record.handle) ?? record.handle
    if (workers.some((worker) => worker.agent_id === id)) continue
    const indexed = findAgent(index, id)
    if (
      indexed?.invocation_id &&
      indexed.invocation_id !== invocation.invocation_id
    )
      continue
    workers.push({
      ...(indexed ?? newAgentEntry(id, record.launched_at)),
      run_id: invocation.run_id,
      invocation_id: invocation.invocation_id,
      worker_role: record.role,
    })
  }
  return workers
}

/** Hash the canonical identity, not an alias or a shared persona/role name. */
export function workerReceiptScope(
  invocationId: string,
  agentId: string,
  runId: string,
): string {
  return `${invocationId}.worker-${sha256(JSON.stringify([runId, agentId]))}`
}

function evidenceRole(
  root: string,
  invocation: Invocation,
  agent: AgentEntry,
): InvocationEvidenceWorker | undefined {
  const workers = invocation.evidence_workers ?? []
  if (!workers.length) return undefined
  const ids = new Set([agent.agent_id, ...agent.aliases])
  const record = (
    loadState(root, invocation.run_id).delegated_workers ?? []
  ).find(
    (entry) =>
      entry.invocation_id === invocation.invocation_id && ids.has(entry.handle),
  )
  if (record) return workers.find((worker) => worker.role === record.role)
  if (agent.worker_role)
    return workers.find((worker) => worker.role === agent.worker_role)
  // A persona distinct from the stage worker can also identify an older brief.
  if (
    agent.subagent_type === invocation.stage.persona ||
    agent.subagent_type === `pan-${invocation.stage.persona}`
  )
    return undefined
  const matches = workers.filter(
    (worker) =>
      worker.agent === agent.subagent_type ||
      worker.persona === agent.subagent_type,
  )
  return matches.length === 1 ? matches[0] : undefined
}

export function workerDelivery(
  root: string,
  invocation: Invocation,
  agent: AgentEntry,
): DeliveryScope {
  const evidence = evidenceRole(root, invocation, agent)
  return {
    scope: workerReceiptScope(
      invocation.invocation_id,
      agent.agent_id,
      invocation.run_id,
    ),
    policies: evidence?.policies ?? invocation.policies,
    capabilities: evidence
      ? { shell: false, delegation: false }
      : (invocation.capabilities ?? { shell: true, delegation: true }),
    audiences: ['agent'],
    invocationId: invocation.invocation_id,
    workerId: agent.agent_id,
    ...(typeof invocation.workspace_root === 'string'
      ? { workspaceRoot: path.resolve(root, invocation.workspace_root) }
      : {}),
  }
}

/** Inline delivery was recorded for the stage executor, never its siblings. */
export function workerHasInlineDelivery(
  root: string,
  invocation: Invocation,
  agent: AgentEntry,
): boolean {
  return Boolean(
    invocation.stage.persona_executor &&
    invocation.stage.persona_executor !== 'cursor' &&
    !evidenceRole(root, invocation, agent),
  )
}

import { isRecord, sha256 } from './io.js'
import { filterPolicyInstructionsForCard } from './policy-instructions.js'
import type { Invocation, Policy, PolicyDeliveryCoverage } from './types.js'

export function isInvocationContext(value: unknown): value is Invocation {
  return (
    isRecord(value) &&
    value.schema_version === 1 &&
    typeof value.invocation_id === 'string' &&
    typeof value.run_id === 'string' &&
    isRecord(value.stage) &&
    typeof value.stage.persona === 'string' &&
    isRecord(value.output) &&
    typeof value.output.path === 'string' &&
    Array.isArray(value.policies) &&
    value.policies.every(
      (policy: unknown) =>
        isRecord(policy) &&
        typeof policy.id === 'string' &&
        Array.isArray(policy.instructions) &&
        policy.instructions.every(
          (instruction: unknown) =>
            isRecord(instruction) &&
            typeof instruction.text === 'string' &&
            Array.isArray(instruction.audience),
        ),
    ) &&
    (value.evidence_workers === undefined ||
      (Array.isArray(value.evidence_workers) &&
        value.evidence_workers.every(
          (worker: unknown) =>
            isRecord(worker) &&
            typeof worker.evidence_path === 'string' &&
            typeof worker.persona === 'string' &&
            typeof worker.role === 'string' &&
            (worker.attempts === undefined ||
              (Array.isArray(worker.attempts) &&
                worker.attempts.every(
                  (attempt: unknown) =>
                    isRecord(attempt) &&
                    typeof attempt.evidence_path === 'string',
                ))),
        ))) &&
    (value.capabilities === undefined ||
      (isRecord(value.capabilities) &&
        typeof value.capabilities.shell === 'boolean' &&
        typeof value.capabilities.delegation === 'boolean'))
  )
}

/** Snapshot only the worker's actual duties, not a supervisor reminder. */
export function initialPolicyReminder(
  invocation: Invocation,
  source: string,
): {
  reminder: NonNullable<Invocation['initial_policy_reminder']>
  coverage: Record<string, PolicyDeliveryCoverage>
} {
  const policy = invocation.policies.find(
    (entry) => entry.id === 'DELEGATE-001',
  )
  const instructions = policy
    ? filterPolicyInstructionsForCard(
        policy.instructions,
        'agent',
        invocation.capabilities,
      )
    : []
  const content = [
    '# Initial worker reminder',
    '',
    ...instructions.map((entry) => `- ${entry.text}`),
  ].join('\n')
  const digest = sha256(content)
  return {
    reminder: { source, content, sha256: digest },
    coverage:
      policy && instructions.length
        ? {
            [policy.id]: {
              invocation_id: invocation.invocation_id,
              role: 'worker',
              executor: invocation.stage.persona_executor ?? 'cursor',
              host: invocation.stage.persona_executor ? null : 'cursor',
              route: 'initial_reminder',
              status: 'verified',
              source,
              content,
              content_sha256: digest,
              instruction_sha256: instructions.map((entry) =>
                sha256(entry.text),
              ),
            },
          }
        : {},
  }
}

/** Exact snapshotted bytes accompany the launch; this is not recurring delivery. */
export function withInitialPolicyReminder(
  invocation: Invocation,
  prompt: string,
): string {
  const reminder = invocation.initial_policy_reminder
  if (!reminder) return prompt
  if (sha256(reminder.content) !== reminder.sha256)
    throw new Error(
      'Initial policy reminder digest does not match its snapshot.',
    )
  return `${reminder.content}\n\n${prompt}`
}

/** A receipt proves exact instruction bytes, never the rest of a policy. */
export function resolvePolicyCoverage(
  policy: Policy,
  coverage: PolicyDeliveryCoverage | undefined,
  expected: {
    invocationId: string
    executor: string
    host: 'cursor' | 'vscode' | null
  },
): { diagnostic: string | null; covered: string[] } {
  const invalid = (diagnostic: string) => ({ diagnostic, covered: [] })
  if (!coverage) return invalid('missing_delivery_evidence')
  if (coverage.invocation_id !== expected.invocationId)
    return invalid('wrong_invocation')
  if (coverage.role !== 'worker') return invalid('wrong_role')
  if (
    coverage.executor !== expected.executor ||
    coverage.host !== expected.host
  )
    return invalid('misrouted_delivery')
  if (coverage.status !== 'verified')
    return invalid('unsupported_or_unverified_delivery')
  if (
    !['projection', 'initial_reminder', 'verified_reminder'].includes(
      coverage.route,
    ) ||
    (coverage.route !== 'initial_reminder' &&
      (coverage.executor !== 'cursor' || !coverage.host))
  )
    return invalid('unsupported_route')
  if (
    !coverage.source.trim() ||
    coverage.content_sha256 !== sha256(coverage.content)
  )
    return invalid('stale_delivery')
  if (
    new Set(coverage.instruction_sha256).size !==
    coverage.instruction_sha256.length
  )
    return invalid('duplicate_coverage')
  const covered = coverage.instruction_sha256.filter((digest) =>
    policy.instructions.some(
      (instruction) =>
        sha256(instruction.text) === digest &&
        coverage.content.includes(instruction.text),
    ),
  )
  if (!covered.length) return invalid('empty_coverage')
  if (covered.length !== coverage.instruction_sha256.length)
    return invalid('unknown_or_stale_instruction')
  return { diagnostic: null, covered }
}

import type { Policy as PolicyDefinition } from './types.js'
import { deferredClauseGroups } from './policy-deferred.js'
import {
  policyInstructionLoad,
  policyInstructionText,
} from './policy-instructions.js'

export interface PolicyContextMeasurement {
  readonly policyId: string
  readonly eagerBytes: number
  readonly deferredBytes: number
  readonly deferredTriggers: readonly string[]
}

export interface PolicyContextTotals {
  readonly eagerBytes: number
  readonly deferredBytes: number
  readonly policies: readonly PolicyContextMeasurement[]
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

/**
 * Splits one policy's instruction text into bytes delivered with the
 * invocation card and bytes held back behind a load trigger.
 */
export function measurePolicyContext(
  policy: PolicyDefinition,
): PolicyContextMeasurement {
  let eagerBytes = 0

  for (const instruction of policy.instructions ?? []) {
    if (policyInstructionLoad(instruction) === 'invocation') {
      eagerBytes += byteLength(policyInstructionText(instruction))
    }
  }

  const groups = deferredClauseGroups(policy, 'agent')
  const deferredBytes = groups.reduce(
    (sum, group) =>
      sum + group.texts.reduce((inner, text) => inner + byteLength(text), 0),
    0,
  )

  return {
    policyId: policy.id,
    eagerBytes,
    deferredBytes,
    deferredTriggers: groups.map((group) => group.trigger),
  }
}

export function measurePoliciesContext(
  policies: readonly PolicyDefinition[],
): PolicyContextTotals {
  const measured = policies.map(measurePolicyContext)

  return {
    eagerBytes: measured.reduce((sum, item) => sum + item.eagerBytes, 0),
    deferredBytes: measured.reduce((sum, item) => sum + item.deferredBytes, 0),
    policies: measured,
  }
}

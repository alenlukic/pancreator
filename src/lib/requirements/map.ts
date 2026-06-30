import { readPolicyLookupTable, loadPolicyCatalog } from '../policies.js'
import { loadRegistry } from './registry.js'

export interface ValidationMapEntry {
  persona: string
  workflow: string
  stage: string
  policy_id: string
  requirement_id: string
  registry_id: string
  registry_version: string
  phase: string
  executor: string
  enforcement: string
  failure_route: string
}

/** Build a deterministic validation map from policy lookup, requirements, and registry. */
export function buildValidationMap(root: string): ValidationMapEntry[] {
  const lookup = readPolicyLookupTable(root)
  const catalog = loadPolicyCatalog(root)
  const registry = loadRegistry(root)
  const entries: ValidationMapEntry[] = []

  for (const row of lookup.rows) {
    for (const policyId of row.policies) {
      const policy = catalog.get(policyId)

      if (!policy?.requirements) {
        continue
      }

      for (const requirement of policy.requirements) {
        const registryEntry = registry.entries.get(requirement.registry_id)

        entries.push({
          persona: row.persona,
          workflow: row.workflow,
          stage: row.stage,
          policy_id: policy.id,
          requirement_id: requirement.id,
          registry_id: requirement.registry_id,
          registry_version: registryEntry?.version ?? '0',
          phase: requirement.phase,
          executor: requirement.executor,
          enforcement: requirement.enforcement,
          failure_route: requirement.failure_route,
        })
      }
    }
  }

  return entries.sort((left, right) =>
    `${left.persona}:${left.workflow}:${left.stage}:${left.policy_id}:${left.requirement_id}`.localeCompare(
      `${right.persona}:${right.workflow}:${right.stage}:${right.policy_id}:${right.requirement_id}`,
    ),
  )
}

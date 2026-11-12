/**
 * Stage output field contracts, kept outside the engine so repository
 * validation can check them without pulling the engine into the shared test
 * helper.
 */

import path from 'node:path'

import {
  composeDesignWorkflow,
  workflowSupportsDesignComposition,
} from '../design-composition.js'
import { errorMessage, invariant } from '../errors.js'
import { isRecord, readJson } from '../io.js'
import { RUN_CONTRACT_IDS } from '../policies.js'
import { loadRegistry } from '../requirements/registry.js'
import { resolveRequirements } from '../requirements/resolve.js'
import { registryAppliesToStage } from '../requirements/run.js'
import type { Invocation, RunContract, StageDefinition } from '../types.js'
import { listWorkflowSlugs, loadWorkflow } from '../workflow.js'

/**
 * Builds the output field contract of one stage from
 * `library/schemas/stage-output-requirements.json`: the criterion result
 * vocabulary, the stage's validators with their enforcement, and its required
 * fields. A workflow-qualified entry wins over the bare stage slug, and the
 * PR-description validator is dropped when operator artifacts were not
 * requested. Returns undefined when the stage has no entry. Throws
 * `INVALID_STAGE_OUTPUT_REQUIREMENTS` when the file is malformed, a validator
 * is not resolved for the stage, or its declared enforcement disagrees with the
 * resolved registry.
 */
export function stageFieldContract(
  root: string,
  workflowSlug: string,
  stageSlug: string,
  requirements: NonNullable<
    Invocation['requirements']
  >['validation_requirements'],
): Invocation['output']['field_contract'] {
  const source = readJson(
    path.join(root, 'library', 'schemas', 'stage-output-requirements.json'),
  )

  invariant(
    isRecord(source) &&
      source.schema_version === 1 &&
      isRecord(source.criterion_results) &&
      Object.values(source.criterion_results).every(
        (value) => typeof value === 'string',
      ) &&
      isRecord(source.stages),
    'stage-output-requirements.json MUST contain a schema_version 1 stage map.',
    { code: 'INVALID_STAGE_OUTPUT_REQUIREMENTS' },
  )

  // The design and prototype workflows both run a stage called `intake`, and
  // a different validator owns each one. A workflow-qualified key selects the
  // owning entry; every slug only one workflow uses stays unqualified.
  const contractKey =
    source.stages[`${workflowSlug}:${stageSlug}`] === undefined
      ? stageSlug
      : `${workflowSlug}:${stageSlug}`
  const stage = source.stages[contractKey]

  if (stage === undefined) {
    return undefined
  }

  invariant(
    isRecord(stage) &&
      Array.isArray(stage.validators) &&
      Array.isArray(stage.fields),
    `stage-output-requirements.json stages.${contractKey} MUST declare validators and fields.`,
    { code: 'INVALID_STAGE_OUTPUT_REQUIREMENTS' },
  )

  const requirementByRegistryId = new Map(
    requirements.map((requirement) => [requirement.registry_id, requirement]),
  )
  const registry = loadRegistry(root)
  const validators = stage.validators.flatMap((validator) => {
    invariant(
      isRecord(validator) &&
        typeof validator.registry_id === 'string' &&
        (validator.enforcement === 'blocks' ||
          validator.enforcement === 'advises'),
      `stage-output-requirements.json stages.${contractKey} contains an invalid validator.`,
      { code: 'INVALID_STAGE_OUTPUT_REQUIREMENTS' },
    )

    const requirement = requirementByRegistryId.get(validator.registry_id)

    invariant(
      requirement,
      `Stage ${stageSlug} does not resolve ${validator.registry_id}.`,
      { code: 'INVALID_STAGE_OUTPUT_REQUIREMENTS' },
    )

    invariant(
      requirement.executor !== 'agent' &&
        requirement.phase !== 'before_operation' &&
        requirement.target === 'invocation.output.path' &&
        registryAppliesToStage(requirement.registry_id, stageSlug) &&
        registry.entries
          .get(requirement.registry_id)
          ?.target_types.includes('stage-output-json'),
      `Stage ${stageSlug} does not resolve ${validator.registry_id} as a harness submission validator for its stage output.`,
      { code: 'INVALID_STAGE_OUTPUT_REQUIREMENTS' },
    )

    const enforcement =
      requirement.enforcement === 'advisory'
        ? ('advises' as const)
        : ('blocks' as const)

    invariant(
      validator.enforcement === enforcement,
      `Stage ${stageSlug} declares ${validator.registry_id} as ` +
        `${validator.enforcement}, but resolved registry metadata says ${enforcement}.`,
      { code: 'INVALID_STAGE_OUTPUT_REQUIREMENTS' },
    )

    return [{ registry_id: validator.registry_id, enforcement }]
  })

  return {
    criterion_results: source.criterion_results as Record<string, string>,
    validators,
    fields: stage.fields as NonNullable<
      Invocation['output']['field_contract']
    >['fields'],
  }
}

function preparePersonas(stage: StageDefinition): string[] {
  return [
    ...new Set([
      stage.persona,
      ...Object.values(stage.persona_by_verdict?.map ?? {}),
    ]),
  ]
}

/**
 * Prepare resolves a field contract for every stage persona it can launch.
 * A contract validator missing from that persona's requirements fails the
 * invocation before the worker starts.
 */
export function workflowStageFieldContractErrors(root: string): string[] {
  const errors: string[] = []
  const checked = new Set<string>()
  const reported = new Set<string>()
  const contractSets: RunContract[][] = [[]]

  for (const contract of RUN_CONTRACT_IDS) {
    contractSets.push(...contractSets.map((set) => [...set, contract]))
  }

  for (const slug of listWorkflowSlugs(root)) {
    try {
      const base = loadWorkflow(root, slug)
      const workflows = workflowSupportsDesignComposition(base)
        ? [base, composeDesignWorkflow(root, base)]
        : [base]

      for (const workflow of workflows) {
        for (const stage of workflow.stages) {
          for (const persona of preparePersonas(stage)) {
            for (const operatorArtifacts of [
              'requested',
              'suppressed',
            ] as const) {
              const context = `${workflow.slug}/${stage.slug}/${persona}`

              for (const contracts of contractSets) {
                const contractLabel = contracts.join(',')
                const key = `${context}/${stage.workspace_policy}/${operatorArtifacts}/${contractLabel}`

                if (checked.has(key)) continue
                checked.add(key)

                try {
                  const requirements = resolveRequirements(root, {
                    persona,
                    workflow: workflow.slug,
                    stage: stage.slug,
                    workspace_policy: stage.workspace_policy,
                    operator_artifacts: operatorArtifacts,
                    contracts,
                  })

                  stageFieldContract(
                    root,
                    workflow.slug,
                    stage.slug,
                    requirements.validation_requirements,
                  )
                } catch (error) {
                  const message = errorMessage(error)
                  const diagnosticKey = `${context}/${operatorArtifacts}/${message}`

                  if (reported.has(diagnosticKey)) continue
                  reported.add(diagnosticKey)
                  errors.push(
                    `${context} (${operatorArtifacts} artifacts${contractLabel ? `; contracts: ${contractLabel}` : ''}): ${message}`,
                  )
                }
              }
            }
          }
        }
      }
    } catch (error) {
      errors.push(`${slug}: ${errorMessage(error)}`)
    }
  }

  return errors
}

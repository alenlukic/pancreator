import path from 'node:path'

import { invariant } from './errors.js'
import { fileExists, readJson, resolveInside } from './io.js'
import type { StageDefinition, WorkflowDefinition } from './types.js'
import { parseStage, validateWorkflow } from './workflow.js'

/** True when the workflow declares an optional design augmentation. */
export function workflowSupportsDesignComposition(
  workflow: WorkflowDefinition,
): boolean {
  return workflow.design_composition !== undefined
}

/** Apply a workflow's declared design augmentation without mutating its base graph. */
export function composeDesignWorkflow(
  root: string,
  workflow: WorkflowDefinition,
): WorkflowDefinition {
  const composition = workflow.design_composition

  invariant(
    composition,
    `Workflow '${workflow.slug}' does not declare design composition.`,
    { code: 'DESIGN_COMPOSITION_UNSUPPORTED' },
  )

  const composed = structuredClone(workflow)
  const added: StageDefinition[] = []

  for (const slug of composition.stages ?? []) {
    const relative = path.join(
      'library',
      'workflows',
      workflow.slug,
      'stages',
      `${slug}.json`,
    )
    const stagePath = resolveInside(root, relative)

    invariant(
      fileExists(stagePath),
      `${relative}: stage file does not exist.`,
      {
        code: 'INVALID_WORKFLOW',
      },
    )

    const stage = parseStage(readJson(stagePath), relative)

    invariant(
      stage.slug === slug,
      `${relative}: stage slug MUST equal '${slug}'.`,
      { code: 'INVALID_WORKFLOW' },
    )
    added.push(stage)
  }

  if (composition.start_stage) {
    composed.start_stage = composition.start_stage
  }

  // `stages` is a load set, but `resetAttemptsFrom` in the engine still reads
  // it as pipeline order. A composition that moves `start_stage` into its own
  // stages runs them before the base graph, so they belong at the front of the
  // array; otherwise they extend it.
  const composedStagesRunFirst = added.some(
    (stage) => stage.slug === composed.start_stage,
  )

  composed.stages = composedStagesRunFirst
    ? [...added, ...composed.stages]
    : [...composed.stages, ...added]

  if (composition.limits) {
    composed.limits = { ...composed.limits, ...composition.limits }
  }

  for (const [slug, override] of Object.entries(
    composition.stage_overrides ?? {},
  )) {
    const stage = composed.stages.find((candidate) => candidate.slug === slug)

    invariant(
      stage,
      `Design composition for '${workflow.slug}' overrides unknown stage '${slug}'.`,
      { code: 'INVALID_WORKFLOW' },
    )

    if (override.required_stage_outputs) {
      stage.context.required_stage_outputs = [
        ...(stage.context.required_stage_outputs ?? []),
        ...override.required_stage_outputs,
      ]
    }

    if (override.required_data) {
      stage.required_data = {
        ...(stage.required_data ?? {}),
        ...override.required_data,
      }
    }

    if (override.evidence_workers) {
      const workers = [
        ...(stage.evidence_workers ?? []),
        ...override.evidence_workers,
      ]
      const roles = new Set<string>()

      for (const worker of workers) {
        invariant(
          !roles.has(worker.role),
          `Design composition for '${workflow.slug}' gives stage '${slug}' duplicate evidence-worker role '${worker.role}'.`,
          { code: 'INVALID_WORKFLOW' },
        )
        roles.add(worker.role)
      }
      stage.evidence_workers = workers
    }
  }

  return validateWorkflow(
    root,
    composed,
    `design composition for '${workflow.slug}'`,
  )
}

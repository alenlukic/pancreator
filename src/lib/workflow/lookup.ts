/** Stage, persona, and prompt lookups against one workflow definition. */

import { invariant } from '../errors.js'
import { readText, resolveInside } from '../io.js'
import type { StageDefinition, WorkflowDefinition } from '../types.js'

/**
 * Every persona one stage can run under: its default persona plus every
 * verdict-mapped alternative.
 */
export function stagePersonaCandidates(stage: StageDefinition): string[] {
  return [
    ...new Set([
      stage.persona,
      ...Object.values(stage.persona_by_verdict?.map ?? {}),
      ...(stage.evidence_workers ?? []).map((worker) => worker.persona),
    ]),
  ]
}

/** Every stage-worker persona a run of this workflow delegates to. */
export function workflowPersonaNames(workflow: WorkflowDefinition): string[] {
  return [
    ...new Set(
      workflow.stages.flatMap((stage) => stagePersonaCandidates(stage)),
    ),
  ].sort()
}

export function stageBySlug(
  workflow: WorkflowDefinition,
  slug: string | null,
): StageDefinition {
  invariant(slug, `Workflow ${workflow.slug} has no active stage.`, {
    code: 'STAGE_NOT_FOUND',
  })

  const stage = workflow.stages.find((candidate) => candidate.slug === slug)

  invariant(stage, `Workflow ${workflow.slug} has no stage '${slug}'.`, {
    code: 'STAGE_NOT_FOUND',
  })

  return stage
}

export function loadStagePrompt(root: string, stage: StageDefinition): string {
  if (typeof stage.prompt === 'string') {
    return stage.prompt.trim()
  }

  invariant(
    stage.prompt_path,
    `Stage '${stage.slug}' MUST define prompt_path.`,
    {
      code: 'INVALID_WORKFLOW',
    },
  )

  return readText(resolveInside(root, stage.prompt_path)).trim()
}

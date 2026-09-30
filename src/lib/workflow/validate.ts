/** The imperative workflow validator `./bin/pan validate` runs. */

import { invariant } from '../errors.js'
import { fileExists, resolveInside } from '../io.js'
import type { WorkflowDefinition, StageCheckpoint } from '../types.js'
import { TERMINALS } from './stage.js'
import { stageBySlug } from './lookup.js'

export function validateWorkflow(
  root: string,
  workflow: WorkflowDefinition,
  source = 'workflow',
): WorkflowDefinition {
  invariant(
    workflow.schema_version === 1,
    `${source}: schema_version MUST be 1.`,
    {
      code: 'INVALID_WORKFLOW',
    },
  )
  invariant(workflow.slug.length > 0, `${source}: slug MUST be non-empty.`, {
    code: 'INVALID_WORKFLOW',
  })
  invariant(
    workflow.stages.length > 0,
    `${source}: stages MUST be a non-empty array.`,
    { code: 'INVALID_WORKFLOW' },
  )

  const slugs = new Set<string>()
  const checkpoints = new Map<StageCheckpoint, string>()

  for (const stage of workflow.stages) {
    invariant(
      !slugs.has(stage.slug),
      `${source}: duplicate stage '${stage.slug}'.`,
      { code: 'INVALID_WORKFLOW' },
    )
    slugs.add(stage.slug)

    // A run contract escalates gates by checkpoint role. Two stages claiming
    // the same role would make that escalation ambiguous.
    if (stage.checkpoint) {
      const owner = checkpoints.get(stage.checkpoint)

      invariant(
        !owner,
        `${source}: stages '${owner}' and '${stage.slug}' both declare ` +
          `checkpoint '${stage.checkpoint}'.`,
        { code: 'INVALID_WORKFLOW' },
      )
      checkpoints.set(stage.checkpoint, stage.slug)
    }

    if (stage.prompt_path && !stage.prompt) {
      invariant(
        fileExists(resolveInside(root, stage.prompt_path)),
        `${source}: missing prompt '${stage.prompt_path}'.`,
        { code: 'INVALID_WORKFLOW' },
      )
    }

    const criterionIds = new Set<string>()

    for (const criterion of stage.criteria) {
      invariant(
        !criterionIds.has(criterion.id),
        `${source}: duplicate criterion '${criterion.id}' in '${stage.slug}'.`,
        { code: 'INVALID_WORKFLOW' },
      )
      criterionIds.add(criterion.id)
    }
  }

  for (const stage of workflow.stages) {
    if (stage.entry_gate) {
      const gated = stage.criteria.find(
        (criterion) => criterion.id === stage.entry_gate?.criterion,
      )

      invariant(
        gated !== undefined && gated.type === 'shell',
        `${source}: entry_gate on '${stage.slug}' MUST name a shell ` +
          `criterion of the stage; '${stage.entry_gate.criterion}' is not one.`,
        { code: 'INVALID_WORKFLOW' },
      )
      invariant(
        slugs.has(stage.entry_gate.failure) &&
          stage.entry_gate.failure !== stage.slug,
        `${source}: entry_gate on '${stage.slug}' MUST route failure to ` +
          `another stage; '${stage.entry_gate.failure}' is not one.`,
        { code: 'INVALID_WORKFLOW' },
      )
    }

    const selectors = [
      ...(stage.context.required_stage_outputs ?? []),
      ...(stage.context.conditional_stage_outputs ?? []),
    ]

    for (const selector of selectors) {
      invariant(
        slugs.has(selector.stage),
        `${source}: context selector '${stage.slug}' targets unknown stage '${selector.stage}'.`,
        { code: 'INVALID_WORKFLOW' },
      )
    }

    if (stage.persona_by_verdict) {
      invariant(
        slugs.has(stage.persona_by_verdict.source_stage),
        `${source}: persona_by_verdict on '${stage.slug}' targets unknown ` +
          `stage '${stage.persona_by_verdict.source_stage}'.`,
        { code: 'INVALID_WORKFLOW' },
      )
      invariant(
        stage.persona_by_verdict.source_stage !== stage.slug,
        `${source}: persona_by_verdict on '${stage.slug}' MUST NOT target ` +
          'the stage itself.',
        { code: 'INVALID_WORKFLOW' },
      )
    }
  }

  invariant(
    slugs.has(workflow.start_stage),
    `${source}: start_stage MUST reference an existing stage.`,
    { code: 'INVALID_WORKFLOW' },
  )

  for (const stage of workflow.stages) {
    for (const [outcome, target] of Object.entries(stage.transitions)) {
      invariant(
        outcome === 'success' || outcome === 'failure' || outcome === 'blocked',
        `${source}: unsupported transition outcome '${outcome}'.`,
        { code: 'INVALID_WORKFLOW' },
      )
      invariant(
        TERMINALS.has(target) || slugs.has(target),
        `${source}: transition '${stage.slug}.${outcome}' targets unknown '${target}'.`,
        { code: 'INVALID_WORKFLOW' },
      )
    }
  }

  const reachable = new Set<string>()
  const queue = [workflow.start_stage]

  while (queue.length > 0) {
    const slug = queue.shift()

    invariant(slug, `${source}: reachability queue MUST contain a stage.`, {
      code: 'INVALID_WORKFLOW',
    })

    if (reachable.has(slug)) {
      continue
    }

    reachable.add(slug)

    const stage = stageBySlug(workflow, slug)

    for (const target of Object.values(stage.transitions)) {
      if (!TERMINALS.has(target)) {
        queue.push(target)
      }
    }
  }

  const unreachable = [...slugs].filter((slug) => !reachable.has(slug))

  invariant(
    unreachable.length === 0,
    `${source}: unreachable stages: ${unreachable.join(', ')}`,
    { code: 'INVALID_WORKFLOW' },
  )

  return workflow
}

/**
 * Workflow assembly from its index, definition, and stage files, the load
 * entry points that validate what they assemble, and the slug listing.
 */

import { readdirSync } from 'node:fs'
import path from 'node:path'

import { invariant } from '../errors.js'
import { isRecord, fileExists, readJson } from '../io.js'
import type {
  DesignComposition,
  WorkflowIndex,
  WorkflowDefinition,
} from '../types.js'
import {
  parseContextSelectors,
  parseEvidenceWorkers,
  parseRequiredData,
  parseStage,
} from './stage.js'
import { validateWorkflow } from './validate.js'

function parseDesignComposition(
  value: unknown,
  source: string,
): DesignComposition | undefined {
  if (value === undefined) {
    return undefined
  }

  invariant(isRecord(value), `${source} MUST be an object when present.`, {
    code: 'INVALID_WORKFLOW',
  })

  const allowedKeys = new Set([
    'stages',
    'start_stage',
    'limits',
    'stage_overrides',
  ])

  invariant(Object.keys(value).length > 0, `${source} MUST NOT be empty.`, {
    code: 'INVALID_WORKFLOW',
  })

  for (const key of Object.keys(value)) {
    invariant(allowedKeys.has(key), `${source}.${key} is not supported.`, {
      code: 'INVALID_WORKFLOW',
    })
  }

  const composition: DesignComposition = {}

  if (value.stages !== undefined) {
    invariant(
      Array.isArray(value.stages) &&
        value.stages.length > 0 &&
        value.stages.every(
          (slug) => typeof slug === 'string' && /^[a-z0-9-]+$/u.test(slug),
        ) &&
        new Set(value.stages).size === value.stages.length,
      `${source}.stages MUST be a non-empty array of unique stage slugs.`,
      { code: 'INVALID_WORKFLOW' },
    )
    composition.stages = value.stages as string[]
  }

  if (value.start_stage !== undefined) {
    invariant(
      typeof value.start_stage === 'string' &&
        /^[a-z0-9-]+$/u.test(value.start_stage),
      `${source}.start_stage MUST be a stage slug when present.`,
      { code: 'INVALID_WORKFLOW' },
    )
    composition.start_stage = value.start_stage
  }

  if (value.limits !== undefined) {
    invariant(
      isRecord(value.limits) && Object.keys(value.limits).length > 0,
      `${source}.limits MUST be a non-empty object when present.`,
      { code: 'INVALID_WORKFLOW' },
    )
    const limits: NonNullable<DesignComposition['limits']> = {}
    const limitKeys = new Set([
      'max_total_transitions',
      'max_stage_attempts',
      'max_consecutive_failures',
    ])

    for (const [key, limit] of Object.entries(value.limits)) {
      invariant(
        limitKeys.has(key) && Number.isInteger(limit) && Number(limit) > 0,
        `${source}.limits.${key} MUST be a supported positive integer.`,
        { code: 'INVALID_WORKFLOW' },
      )
      limits[key as keyof typeof limits] = limit as number
    }
    composition.limits = limits
  }

  if (value.stage_overrides !== undefined) {
    invariant(
      isRecord(value.stage_overrides) &&
        Object.keys(value.stage_overrides).length > 0,
      `${source}.stage_overrides MUST be a non-empty object when present.`,
      { code: 'INVALID_WORKFLOW' },
    )
    const overrides: NonNullable<DesignComposition['stage_overrides']> = {}

    for (const [slug, rawOverride] of Object.entries(value.stage_overrides)) {
      const overrideSource = `${source}.stage_overrides.${slug}`

      invariant(
        /^[a-z0-9-]+$/u.test(slug) &&
          isRecord(rawOverride) &&
          Object.keys(rawOverride).length > 0,
        `${overrideSource} MUST be a non-empty stage override.`,
        { code: 'INVALID_WORKFLOW' },
      )

      const allowedOverrideKeys = new Set([
        'required_stage_outputs',
        'required_data',
        'evidence_workers',
      ])

      for (const key of Object.keys(rawOverride)) {
        invariant(
          allowedOverrideKeys.has(key),
          `${overrideSource}.${key} is not supported.`,
          { code: 'INVALID_WORKFLOW' },
        )
      }

      overrides[slug] = {
        ...(rawOverride.required_stage_outputs !== undefined
          ? {
              required_stage_outputs: parseContextSelectors(
                rawOverride.required_stage_outputs,
                `${overrideSource}.required_stage_outputs`,
              ),
            }
          : {}),
        ...(rawOverride.required_data !== undefined
          ? {
              required_data: parseRequiredData(
                rawOverride.required_data,
                `${overrideSource}.required_data`,
              ),
            }
          : {}),
        ...(rawOverride.evidence_workers !== undefined
          ? {
              evidence_workers: parseEvidenceWorkers(
                rawOverride.evidence_workers,
                `${overrideSource}.evidence_workers`,
              ),
            }
          : {}),
      }
    }
    composition.stage_overrides = overrides
  }

  return composition
}

function parseWorkflowIndex(value: unknown, source: string): WorkflowIndex {
  invariant(isRecord(value), `${source} MUST contain an object.`, {
    code: 'INVALID_WORKFLOW',
  })
  invariant(value.schema_version === 1, `${source}.schema_version MUST be 1.`, {
    code: 'INVALID_WORKFLOW',
  })

  for (const key of ['slug', 'title', 'start_stage'] as const) {
    invariant(
      typeof value[key] === 'string' && value[key].length > 0,
      `${source}.${key} MUST be a non-empty string.`,
      { code: 'INVALID_WORKFLOW' },
    )
  }

  invariant(isRecord(value.limits), `${source}.limits MUST be an object.`, {
    code: 'INVALID_WORKFLOW',
  })

  for (const key of [
    'max_total_transitions',
    'max_stage_attempts',
    'max_consecutive_failures',
  ] as const) {
    invariant(
      Number.isInteger(value.limits[key]) && Number(value.limits[key]) > 0,
      `${source}.limits.${key} MUST be a positive integer.`,
      { code: 'INVALID_WORKFLOW' },
    )
  }

  invariant(
    Array.isArray(value.stages) &&
      value.stages.length > 0 &&
      value.stages.every((slug) => typeof slug === 'string' && slug.length > 0),
    `${source}.stages MUST be a non-empty string array.`,
    { code: 'INVALID_WORKFLOW' },
  )

  const workflow: WorkflowIndex = {
    schema_version: 1,
    slug: value.slug as string,
    title: value.title as string,
    start_stage: value.start_stage as string,
    limits: {
      max_total_transitions: value.limits.max_total_transitions as number,
      max_stage_attempts: value.limits.max_stage_attempts as number,
      max_consecutive_failures: value.limits.max_consecutive_failures as number,
    },
    stages: value.stages as string[],
  }

  if (typeof value.description === 'string') {
    workflow.description = value.description
  }

  const designComposition = parseDesignComposition(
    value.design_composition,
    `${source}.design_composition`,
  )

  if (designComposition) {
    workflow.design_composition = designComposition
  }

  return workflow
}

function parseWorkflowDefinition(
  value: unknown,
  source: string,
): WorkflowDefinition {
  invariant(isRecord(value), `${source} MUST contain an object.`, {
    code: 'INVALID_WORKFLOW',
  })
  invariant(Array.isArray(value.stages), `${source}.stages MUST be an array.`, {
    code: 'INVALID_WORKFLOW',
  })

  const stages = value.stages.map((stage, indexValue) =>
    parseStage(stage, `${source}.stages[${indexValue}]`, true),
  )
  const index = parseWorkflowIndex(
    { ...value, stages: stages.map((stage) => stage.slug) },
    source,
  )

  return { ...index, stages }
}

function assembleWorkflow(
  dir: string,
  index: WorkflowIndex,
  source: string,
): WorkflowDefinition {
  const stages = index.stages.map((slug) => {
    const stagePath = path.join(dir, 'stages', `${slug}.json`)

    invariant(
      fileExists(stagePath),
      `${source}: missing stage file stages/${slug}.json.`,
      { code: 'INVALID_WORKFLOW' },
    )

    const stage = parseStage(readJson(stagePath), `stages/${slug}.json`)

    invariant(
      stage.slug === slug,
      `stages/${slug}.json: stage slug MUST equal '${slug}'.`,
      { code: 'INVALID_WORKFLOW' },
    )

    return stage
  })

  return { ...index, stages }
}

/** Load and validate a workflow index plus its ordered stage files. */
export function loadWorkflow(root: string, slug: string): WorkflowDefinition {
  const dir = path.join(root, 'library', 'workflows', slug)
  const indexPath = path.join(dir, 'workflow.json')

  invariant(fileExists(indexPath), `Unknown workflow: ${slug}`, {
    code: 'WORKFLOW_NOT_FOUND',
  })

  const index = parseWorkflowIndex(readJson(indexPath), indexPath)
  const workflow = assembleWorkflow(dir, index, indexPath)

  return validateWorkflow(root, workflow, indexPath)
}

/** Load and validate one self-contained workflow snapshot. */
export function loadWorkflowFile(
  root: string,
  filePath: string,
): WorkflowDefinition {
  const workflow = parseWorkflowDefinition(readJson(filePath), filePath)

  return validateWorkflow(root, workflow, filePath)
}

/** List every workflow slug under library/workflows. */
export function listWorkflowSlugs(root: string): string[] {
  const base = path.join(root, 'library', 'workflows')

  if (!fileExists(base)) {
    return []
  }

  return readdirSync(base, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fileExists(path.join(base, entry.name, 'workflow.json')),
    )
    .map((entry) => entry.name)
    .sort()
}

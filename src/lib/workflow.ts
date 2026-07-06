import { readdirSync } from 'node:fs'
import path from 'node:path'

import { invariant } from './errors.js'
import {
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
} from './io.js'
import type {
  Criterion,
  CriterionType,
  JsonTypeName,
  StageContextDefinition,
  StageContextRequest,
  StageContextSelection,
  StageContextStageSelector,
  StageExecutor,
  StageDefinition,
  StageGate,
  StageTransitions,
  WorkflowDefinition,
  WorkflowIndex,
  WorkspacePolicy,
} from './types.js'

const TERMINALS = new Set(['succeeded', 'failed', 'canceled', 'paused'])
const GATES = new Set<StageGate>([
  'operator',
  'supervisor',
  'next_stage',
  'stage_verdict',
])
const EXECUTORS = new Set<StageExecutor>(['agent', 'harness'])
const WORKSPACE_POLICIES = new Set<WorkspacePolicy>([
  'source_allowed',
  'release_metadata_only',
  'runtime_only',
  'read_only',
])
const CRITERION_TYPES = new Set<CriterionType>(['judgment', 'shell', 'state'])
const CONTEXT_REQUESTS = new Set<StageContextRequest>([
  'required',
  'conditional',
  'omit',
])
const CONTEXT_SELECTIONS = new Set<StageContextSelection>([
  'latest',
  'latest_success',
])
const JSON_TYPE_NAMES = new Set<JsonTypeName>([
  'object',
  'array',
  'string',
  'number',
  'boolean',
])

function parseCriterion(value: unknown, source: string): Criterion {
  invariant(isRecord(value), `${source} MUST be an object.`, {
    code: 'INVALID_WORKFLOW',
  })
  invariant(
    typeof value.id === 'string' && value.id.length > 0,
    `${source}.id MUST be a non-empty string.`,
    { code: 'INVALID_WORKFLOW' },
  )
  invariant(
    typeof value.type === 'string' &&
      CRITERION_TYPES.has(value.type as CriterionType),
    `${source}.type MUST be judgment, shell, or state.`,
    { code: 'INVALID_WORKFLOW' },
  )
  invariant(
    typeof value.statement === 'string' && value.statement.length > 0,
    `${source}.statement MUST be a non-empty string.`,
    { code: 'INVALID_WORKFLOW' },
  )

  if (value.hard !== undefined) {
    invariant(
      typeof value.hard === 'boolean',
      `${source}.hard MUST be a boolean when present.`,
      { code: 'INVALID_WORKFLOW' },
    )
  }

  if (value.type === 'shell') {
    invariant(
      typeof value.command === 'string' && value.command.length > 0,
      `${source}.command MUST be a non-empty string for shell criteria.`,
      { code: 'INVALID_WORKFLOW' },
    )
  }

  if (value.timeout_ms !== undefined) {
    invariant(
      Number.isInteger(value.timeout_ms) && Number(value.timeout_ms) > 0,
      `${source}.timeout_ms MUST be a positive integer when present.`,
      { code: 'INVALID_WORKFLOW' },
    )
  }

  return value as unknown as Criterion
}

function parseTransitions(value: unknown, source: string): StageTransitions {
  invariant(isRecord(value), `${source} MUST be an object.`, {
    code: 'INVALID_WORKFLOW',
  })

  for (const outcome of ['success', 'failure', 'blocked'] as const) {
    invariant(
      typeof value[outcome] === 'string' && value[outcome].length > 0,
      `${source}.${outcome} MUST be a non-empty string.`,
      { code: 'INVALID_WORKFLOW' },
    )
  }

  return value as unknown as StageTransitions
}

function parseContextSelectors(
  value: unknown,
  source: string,
): StageContextStageSelector[] | undefined {
  if (value === undefined) {
    return undefined
  }

  invariant(Array.isArray(value), `${source} MUST be an array when present.`, {
    code: 'INVALID_WORKFLOW',
  })

  return value.map((item, index) => {
    const itemSource = `${source}[${index}]`

    invariant(isRecord(item), `${itemSource} MUST be an object.`, {
      code: 'INVALID_WORKFLOW',
    })
    invariant(
      typeof item.stage === 'string' && item.stage.length > 0,
      `${itemSource}.stage MUST be a non-empty string.`,
      { code: 'INVALID_WORKFLOW' },
    )
    invariant(
      typeof item.selection === 'string' &&
        CONTEXT_SELECTIONS.has(item.selection as StageContextSelection),
      `${itemSource}.selection MUST be latest or latest_success.`,
      { code: 'INVALID_WORKFLOW' },
    )

    return {
      stage: item.stage as string,
      selection: item.selection as StageContextSelection,
    }
  })
}

function parseContext(
  value: unknown,
  source: string,
  allowLegacyContext: boolean,
): StageContextDefinition {
  if (value === undefined) {
    invariant(allowLegacyContext, `${source} MUST be defined.`, {
      code: 'INVALID_WORKFLOW',
    })

    return { request: 'required', legacy_full_history: true }
  }

  invariant(isRecord(value), `${source} MUST be an object.`, {
    code: 'INVALID_WORKFLOW',
  })
  invariant(
    typeof value.request === 'string' &&
      CONTEXT_REQUESTS.has(value.request as StageContextRequest),
    `${source}.request MUST be required, conditional, or omit.`,
    { code: 'INVALID_WORKFLOW' },
  )

  for (const key of ['prior_attempts', 'operator_feedback'] as const) {
    if (value[key] === undefined) {
      continue
    }

    invariant(
      Number.isInteger(value[key]) && Number(value[key]) >= 0,
      `${source}.${key} MUST be a non-negative integer when present.`,
      { code: 'INVALID_WORKFLOW' },
    )
  }

  for (const key of [
    'include_active_waivers',
    'include_workspace_ratifications',
  ] as const) {
    if (value[key] === undefined) {
      continue
    }

    invariant(
      typeof value[key] === 'boolean',
      `${source}.${key} MUST be a boolean when present.`,
      { code: 'INVALID_WORKFLOW' },
    )
  }

  const requiredStageOutputs = parseContextSelectors(
    value.required_stage_outputs,
    `${source}.required_stage_outputs`,
  )
  const conditionalStageOutputs = parseContextSelectors(
    value.conditional_stage_outputs,
    `${source}.conditional_stage_outputs`,
  )

  return {
    request: value.request as StageContextRequest,
    ...(requiredStageOutputs
      ? { required_stage_outputs: requiredStageOutputs }
      : {}),
    ...(conditionalStageOutputs
      ? { conditional_stage_outputs: conditionalStageOutputs }
      : {}),
    ...(value.prior_attempts !== undefined
      ? { prior_attempts: value.prior_attempts as number }
      : {}),
    ...(value.operator_feedback !== undefined
      ? { operator_feedback: value.operator_feedback as number }
      : {}),
    ...(value.include_active_waivers !== undefined
      ? { include_active_waivers: value.include_active_waivers as boolean }
      : {}),
    ...(value.include_workspace_ratifications !== undefined
      ? {
          include_workspace_ratifications:
            value.include_workspace_ratifications as boolean,
        }
      : {}),
  }
}

function parseRequiredData(
  value: unknown,
  source: string,
): Record<string, JsonTypeName> | undefined {
  if (value === undefined) {
    return undefined
  }

  invariant(isRecord(value), `${source} MUST be an object when present.`, {
    code: 'INVALID_WORKFLOW',
  })

  const requiredData: Record<string, JsonTypeName> = {}

  for (const [key, typeName] of Object.entries(value)) {
    invariant(
      typeof typeName === 'string' &&
        JSON_TYPE_NAMES.has(typeName as JsonTypeName),
      `${source}.${key} MUST name a supported JSON type.`,
      { code: 'INVALID_WORKFLOW' },
    )

    requiredData[key] = typeName as JsonTypeName
  }

  return requiredData
}

function parseStage(
  value: unknown,
  source: string,
  allowLegacyContext = false,
): StageDefinition {
  invariant(isRecord(value), `${source} MUST contain an object.`, {
    code: 'INVALID_WORKFLOW',
  })

  for (const key of ['slug', 'title', 'persona'] as const) {
    invariant(
      typeof value[key] === 'string' && value[key].length > 0,
      `${source}.${key} MUST be a non-empty string.`,
      { code: 'INVALID_WORKFLOW' },
    )
  }

  invariant(
    typeof value.workspace_policy === 'string' &&
      WORKSPACE_POLICIES.has(value.workspace_policy as WorkspacePolicy),
    `${source}.workspace_policy MUST be source_allowed, release_metadata_only, runtime_only, or read_only.`,
    { code: 'INVALID_WORKFLOW' },
  )
  invariant(
    typeof value.gate === 'string' && GATES.has(value.gate as StageGate),
    `${source}.gate MUST name a supported gate.`,
    { code: 'INVALID_WORKFLOW' },
  )
  if (value.executor !== undefined) {
    invariant(
      typeof value.executor === 'string' &&
        EXECUTORS.has(value.executor as StageExecutor),
      `${source}.executor MUST be agent or harness when present.`,
      { code: 'INVALID_WORKFLOW' },
    )
  }
  invariant(
    typeof value.prompt === 'string' || typeof value.prompt_path === 'string',
    `${source} MUST define prompt or prompt_path.`,
    { code: 'INVALID_WORKFLOW' },
  )
  invariant(
    Array.isArray(value.criteria),
    `${source}.criteria MUST be an array.`,
    {
      code: 'INVALID_WORKFLOW',
    },
  )

  const stage: StageDefinition = {
    slug: value.slug as string,
    title: value.title as string,
    persona: value.persona as string,
    workspace_policy: value.workspace_policy as WorkspacePolicy,
    gate: value.gate as StageGate,
    context: parseContext(
      value.context,
      `${source}.context`,
      allowLegacyContext,
    ),
    criteria: value.criteria.map((criterion, index) =>
      parseCriterion(criterion, `${source}.criteria[${index}]`),
    ),
    transitions: parseTransitions(value.transitions, `${source}.transitions`),
  }

  if (typeof value.prompt === 'string') {
    stage.prompt = value.prompt
  }

  if (typeof value.prompt_path === 'string') {
    stage.prompt_path = value.prompt_path
  }

  if (typeof value.prompt_sha256 === 'string') {
    stage.prompt_sha256 = value.prompt_sha256
  }

  if (typeof value.executor === 'string') {
    stage.executor = value.executor as StageExecutor
  }

  const requiredData = parseRequiredData(
    value.required_data,
    `${source}.required_data`,
  )

  if (requiredData) {
    stage.required_data = requiredData
  }

  return stage
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

  for (const stage of workflow.stages) {
    invariant(
      !slugs.has(stage.slug),
      `${source}: duplicate stage '${stage.slug}'.`,
      { code: 'INVALID_WORKFLOW' },
    )
    slugs.add(stage.slug)

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

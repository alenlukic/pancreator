/**
 * Strict parsing of one stage definition: its criteria, transitions, context
 * requests, evidence workers, scoped return, entry gate, and required data.
 */

import { invariant } from '../errors.js'
import { isRecord } from '../io.js'
import type {
  StageGate,
  StageExecutor,
  StageCheckpoint,
  WorkspacePolicy,
  CriterionType,
  StageContextRequest,
  StageContextSelection,
  JsonTypeName,
  EvidenceWorkerRunCondition,
  Criterion,
  StageTransitions,
  StageContextStageSelector,
  StageContextDefinition,
  StagePersonaByVerdict,
  StageEvidenceWorkerDefinition,
  StageScopedReturn,
  StageEntryGate,
  StageDefinition,
} from '../types.js'

export const TERMINALS = new Set(['succeeded', 'failed', 'canceled', 'paused'])
const GATES = new Set<StageGate>([
  'operator',
  'supervisor',
  'next_stage',
  'stage_verdict',
])
const EXECUTORS = new Set<StageExecutor>(['agent', 'harness'])
const CHECKPOINTS = new Set<StageCheckpoint>([
  'technical_plan',
  'independent_review',
])
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
const RESERVED_EVIDENCE_WORKER_ROLES = new Set(['worker', 'supervisor'])
const EVIDENCE_WORKER_RUN_CONDITIONS: ReadonlySet<string> =
  new Set<EvidenceWorkerRunCondition>(['live_criteria'])

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

export function parseContextSelectors(
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
    'include_workspace_ratifications',
    'gate_evidence',
    'suite_profile',
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
    ...(value.include_workspace_ratifications !== undefined
      ? {
          include_workspace_ratifications:
            value.include_workspace_ratifications as boolean,
        }
      : {}),
    ...(value.gate_evidence !== undefined
      ? { gate_evidence: value.gate_evidence as boolean }
      : {}),
    ...(value.suite_profile !== undefined
      ? { suite_profile: value.suite_profile as boolean }
      : {}),
  }
}

function parsePersonaByVerdict(
  value: unknown,
  source: string,
): StagePersonaByVerdict | undefined {
  if (value === undefined) {
    return undefined
  }

  invariant(isRecord(value), `${source} MUST be an object when present.`, {
    code: 'INVALID_WORKFLOW',
  })

  for (const key of ['source_stage', 'path'] as const) {
    invariant(
      typeof value[key] === 'string' && value[key].length > 0,
      `${source}.${key} MUST be a non-empty string.`,
      { code: 'INVALID_WORKFLOW' },
    )
  }

  invariant(
    isRecord(value.map) && Object.keys(value.map).length > 0,
    `${source}.map MUST be a non-empty object.`,
    { code: 'INVALID_WORKFLOW' },
  )

  for (const [verdict, persona] of Object.entries(value.map)) {
    invariant(
      typeof persona === 'string' && persona.length > 0,
      `${source}.map.${verdict} MUST name a persona.`,
      { code: 'INVALID_WORKFLOW' },
    )
  }

  return {
    source_stage: value.source_stage as string,
    path: value.path as string,
    map: value.map as Record<string, string>,
  }
}

export function parseEvidenceWorkers(
  value: unknown,
  source: string,
): StageEvidenceWorkerDefinition[] | undefined {
  if (value === undefined) {
    return undefined
  }

  invariant(
    Array.isArray(value) && value.length > 0,
    `${source} MUST be a non-empty array when present.`,
    { code: 'INVALID_WORKFLOW' },
  )

  const roles = new Set<string>()
  const workers = value.map((entry, index) => {
    const entrySource = `${source}[${index}]`

    invariant(isRecord(entry), `${entrySource} MUST be an object.`, {
      code: 'INVALID_WORKFLOW',
    })

    for (const key of ['persona', 'role', 'scope'] as const) {
      invariant(
        typeof entry[key] === 'string' && entry[key].length > 0,
        `${entrySource}.${key} MUST be a non-empty string.`,
        { code: 'INVALID_WORKFLOW' },
      )
    }

    const role = entry.role as string

    invariant(
      /^[a-z][a-z0-9-]*$/u.test(role),
      `${entrySource}.role MUST be a lowercase slug.`,
      { code: 'INVALID_WORKFLOW' },
    )
    invariant(
      !RESERVED_EVIDENCE_WORKER_ROLES.has(role),
      `${entrySource}.role '${role}' is reserved for CLI model evidence.`,
      { code: 'INVALID_WORKFLOW' },
    )
    invariant(!roles.has(role), `${source} roles MUST be unique.`, {
      code: 'INVALID_WORKFLOW',
    })
    roles.add(role)

    invariant(
      entry.return_scope === undefined ||
        (typeof entry.return_scope === 'string' &&
          entry.return_scope.length > 0),
      `${entrySource}.return_scope MUST be a non-empty string when present.`,
      { code: 'INVALID_WORKFLOW' },
    )
    invariant(
      entry.run_when === undefined ||
        EVIDENCE_WORKER_RUN_CONDITIONS.has(entry.run_when as string),
      `${entrySource}.run_when MUST be one of: ` +
        `${[...EVIDENCE_WORKER_RUN_CONDITIONS].join(', ')}.`,
      { code: 'INVALID_WORKFLOW' },
    )

    return {
      persona: entry.persona as string,
      role,
      scope: entry.scope as string,
      ...(typeof entry.return_scope === 'string'
        ? { return_scope: entry.return_scope }
        : {}),
      ...(entry.run_when !== undefined
        ? { run_when: entry.run_when as EvidenceWorkerRunCondition }
        : {}),
    }
  })

  return workers
}

function parseScopedReturn(
  value: unknown,
  source: string,
  workers: StageEvidenceWorkerDefinition[] | undefined,
): StageScopedReturn | undefined {
  if (value === undefined) {
    return undefined
  }

  invariant(isRecord(value), `${source} MUST be an object.`, {
    code: 'INVALID_WORKFLOW',
  })

  for (const key of ['max_paths', 'max_findings'] as const) {
    invariant(
      Number.isInteger(value[key]) && (value[key] as number) >= 1,
      `${source}.${key} MUST be a positive integer.`,
      { code: 'INVALID_WORKFLOW' },
    )
  }

  const globs = value.excluded_path_globs ?? []

  invariant(
    Array.isArray(globs) &&
      globs.every((glob) => typeof glob === 'string' && glob.length > 0),
    `${source}.excluded_path_globs MUST be an array of non-empty strings.`,
    { code: 'INVALID_WORKFLOW' },
  )

  const dimensions = value.dimensions
  const declared = new Set((workers ?? []).map((worker) => worker.role))

  invariant(
    Array.isArray(dimensions) &&
      dimensions.length > 0 &&
      dimensions.every(
        (role) => typeof role === 'string' && declared.has(role),
      ),
    `${source}.dimensions MUST be a non-empty array of evidence roles the ` +
      'stage declares.',
    { code: 'INVALID_WORKFLOW' },
  )

  return {
    max_paths: value.max_paths as number,
    max_findings: value.max_findings as number,
    excluded_path_globs: globs as string[],
    dimensions: dimensions as string[],
  }
}

function parseEntryGate(
  value: unknown,
  source: string,
): StageEntryGate | undefined {
  if (value === undefined) {
    return undefined
  }

  invariant(isRecord(value), `${source} MUST be an object when present.`, {
    code: 'INVALID_WORKFLOW',
  })

  for (const key of ['criterion', 'failure'] as const) {
    invariant(
      typeof value[key] === 'string' && value[key].length > 0,
      `${source}.${key} MUST be a non-empty string.`,
      { code: 'INVALID_WORKFLOW' },
    )
  }

  invariant(
    typeof value.max_loops === 'number' &&
      Number.isInteger(value.max_loops) &&
      value.max_loops >= 0,
    `${source}.max_loops MUST be a non-negative integer.`,
    { code: 'INVALID_WORKFLOW' },
  )

  return {
    criterion: value.criterion as string,
    failure: value.failure as string,
    max_loops: value.max_loops,
  }
}

export function parseRequiredData(
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

export function parseStage(
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

  if (value.gate_relaxable !== undefined) {
    invariant(
      typeof value.gate_relaxable === 'boolean',
      `${source}.gate_relaxable MUST be a boolean when present.`,
      { code: 'INVALID_WORKFLOW' },
    )
  }

  if (value.checkpoint !== undefined) {
    invariant(
      typeof value.checkpoint === 'string' &&
        CHECKPOINTS.has(value.checkpoint as StageCheckpoint),
      `${source}.checkpoint MUST be technical_plan or independent_review when present.`,
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

  if (typeof value.gate_relaxable === 'boolean') {
    stage.gate_relaxable = value.gate_relaxable
  }

  if (typeof value.checkpoint === 'string') {
    stage.checkpoint = value.checkpoint as StageCheckpoint
  }

  const requiredData = parseRequiredData(
    value.required_data,
    `${source}.required_data`,
  )

  if (requiredData) {
    stage.required_data = requiredData
  }

  const blockedRequiredData = parseRequiredData(
    value.blocked_required_data,
    `${source}.blocked_required_data`,
  )

  if (blockedRequiredData) {
    stage.blocked_required_data = blockedRequiredData
  }

  const personaByVerdict = parsePersonaByVerdict(
    value.persona_by_verdict,
    `${source}.persona_by_verdict`,
  )

  if (personaByVerdict) {
    stage.persona_by_verdict = personaByVerdict
  }

  const evidenceWorkers = parseEvidenceWorkers(
    value.evidence_workers,
    `${source}.evidence_workers`,
  )

  if (evidenceWorkers) {
    stage.evidence_workers = evidenceWorkers
  }

  const scopedReturn = parseScopedReturn(
    value.scoped_return,
    `${source}.scoped_return`,
    evidenceWorkers,
  )

  if (scopedReturn) {
    stage.scoped_return = scopedReturn
  }

  const entryGate = parseEntryGate(value.entry_gate, `${source}.entry_gate`)

  if (entryGate) {
    stage.entry_gate = entryGate
  }

  return stage
}

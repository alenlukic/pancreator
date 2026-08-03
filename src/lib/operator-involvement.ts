import path from 'node:path'

import { invariant } from './errors.js'
import { fileExists, isRecord, readJson } from './io.js'
import { harnessConfigName } from './project-config.js'
import type {
  OperatorInvolvementFile,
  OperatorInvolvementProfile,
  ResolvedOperatorInvolvement,
  RunContract,
  StageCheckpoint,
  StageGate,
  WorkflowDefinition,
} from './types.js'

const CONFIG_PATH = 'config.json'
const CONFIG_KEY = 'operator_involvement'

/** Profile assumed when `config.json` declares no involvement block at all. */
export const DEFAULT_INVOLVEMENT_PROFILE = 'standard'

const GATES = new Set<StageGate>([
  'operator',
  'supervisor',
  'next_stage',
  'stage_verdict',
])

const RUN_CONTRACTS = new Set<RunContract>(['technical_director'])

/**
 * How much operator attention each gate costs, ascending. Used only to tell a
 * relaxation from an escalation so `gate_relaxable: false` can be enforced.
 */
const GATE_INVOLVEMENT: Record<StageGate, number> = {
  next_stage: 0,
  stage_verdict: 1,
  supervisor: 2,
  operator: 3,
}

/**
 * Checkpoint roles the technical-director contract escalates to an operator
 * gate: the operator refines the technical plan with its author before
 * implementation, and reviews the independent review's result afterwards.
 */
const TECHNICAL_DIRECTOR_CHECKPOINTS = new Set<StageCheckpoint>([
  'technical_plan',
  'independent_review',
])

const STANDARD_PROFILE: OperatorInvolvementProfile = {
  summary:
    'Workflow-declared gates, unchanged. The operator ratifies intake and ' +
    'approves release preparation.',
}

function parseGateMap(
  value: unknown,
  source: string,
): Record<string, StageGate> {
  invariant(isRecord(value), `${source} MUST be an object when present.`, {
    code: 'INVALID_OPERATOR_INVOLVEMENT',
  })

  const gates: Record<string, StageGate> = {}

  for (const [stage, gate] of Object.entries(value)) {
    invariant(
      stage === '*' || /^[a-z0-9-]+$/u.test(stage),
      `${source}.${stage} MUST key '*' or a stage slug.`,
      { code: 'INVALID_OPERATOR_INVOLVEMENT' },
    )
    invariant(
      typeof gate === 'string' && GATES.has(gate as StageGate),
      `${source}.${stage} MUST name a supported gate.`,
      { code: 'INVALID_OPERATOR_INVOLVEMENT' },
    )

    gates[stage] = gate as StageGate
  }

  return gates
}

function parseProfile(
  value: unknown,
  source: string,
): OperatorInvolvementProfile {
  invariant(isRecord(value), `${source} MUST be an object.`, {
    code: 'INVALID_OPERATOR_INVOLVEMENT',
  })
  invariant(
    typeof value.summary === 'string' && value.summary.length > 0,
    `${source}.summary MUST be a non-empty string.`,
    { code: 'INVALID_OPERATOR_INVOLVEMENT' },
  )

  const contracts: RunContract[] = []

  if (value.contracts !== undefined) {
    invariant(
      Array.isArray(value.contracts),
      `${source}.contracts MUST be an array when present.`,
      { code: 'INVALID_OPERATOR_INVOLVEMENT' },
    )

    for (const contract of value.contracts) {
      invariant(
        typeof contract === 'string' &&
          RUN_CONTRACTS.has(contract as RunContract),
        `${source}.contracts MUST name supported run contracts.`,
        { code: 'INVALID_OPERATOR_INVOLVEMENT' },
      )
      contracts.push(contract as RunContract)
    }
  }

  return {
    summary: value.summary,
    ...(value.gates !== undefined
      ? { gates: parseGateMap(value.gates, `${source}.gates`) }
      : {}),
    ...(contracts.length > 0 ? { contracts } : {}),
  }
}

export function parseOperatorInvolvement(
  value: unknown,
  source = CONFIG_PATH,
): OperatorInvolvementFile {
  invariant(isRecord(value), `${source} MUST contain an object.`, {
    code: 'INVALID_OPERATOR_INVOLVEMENT',
  })

  // The block is optional: an installation that never customizes involvement
  // behaves exactly as it did before profiles existed.
  if (value[CONFIG_KEY] === undefined) {
    return {
      active: DEFAULT_INVOLVEMENT_PROFILE,
      profiles: { [DEFAULT_INVOLVEMENT_PROFILE]: STANDARD_PROFILE },
    }
  }

  const block = value[CONFIG_KEY]

  invariant(isRecord(block), `${source}.${CONFIG_KEY} MUST be an object.`, {
    code: 'INVALID_OPERATOR_INVOLVEMENT',
  })
  invariant(
    typeof block.active === 'string' && block.active.length > 0,
    `${source}.${CONFIG_KEY}.active MUST be a non-empty string.`,
    { code: 'INVALID_OPERATOR_INVOLVEMENT' },
  )
  invariant(
    isRecord(block.profiles),
    `${source}.${CONFIG_KEY}.profiles MUST be an object.`,
    { code: 'INVALID_OPERATOR_INVOLVEMENT' },
  )

  const profiles: Record<string, OperatorInvolvementProfile> = {}

  for (const [name, profile] of Object.entries(block.profiles)) {
    profiles[name] = parseProfile(
      profile,
      `${source}.${CONFIG_KEY}.profiles.${name}`,
    )
  }

  invariant(
    profiles[block.active] !== undefined,
    `${source}.${CONFIG_KEY}.active '${block.active}' is not defined.`,
    { code: 'INVALID_OPERATOR_INVOLVEMENT' },
  )

  return { active: block.active, profiles }
}

export function loadOperatorInvolvementFile(
  root: string,
): OperatorInvolvementFile {
  const configName = harnessConfigName(root) ?? CONFIG_PATH
  const filePath = path.join(root, configName)

  invariant(fileExists(filePath), `Missing required file: ${CONFIG_PATH}`, {
    code: 'INVALID_OPERATOR_INVOLVEMENT',
  })

  return parseOperatorInvolvement(readJson(filePath), configName)
}

export function selectInvolvementProfile(
  file: OperatorInvolvementFile,
  name?: string | null,
): { name: string; profile: OperatorInvolvementProfile } {
  const resolved = name ?? file.active
  const profile = file.profiles[resolved]

  invariant(
    profile !== undefined,
    `Operator-involvement profile '${resolved}' is not defined in ` +
      `${CONFIG_PATH}. Available: ${Object.keys(file.profiles).sort().join(', ')}.`,
    { code: 'INVALID_OPERATOR_INVOLVEMENT' },
  )

  return { name: resolved, profile }
}

/**
 * Apply an involvement profile to a workflow snapshot in place and return the
 * audit record of what changed.
 *
 * Gates resolve by ascending specificity so a blunt default cannot silently
 * cancel a targeted one:
 *
 * 1. the gate the workflow declares,
 * 2. the profile's `*` gate,
 * 3. run-contract escalations keyed by stage checkpoint,
 * 4. the profile's explicit per-stage gate.
 *
 * A stage with `gate_relaxable: false` MUST NOT end up with less operator
 * involvement than the workflow declared; that is a configuration defect rather
 * than an operator decision, because a stored profile is not an explicit
 * directive for the run in front of the operator.
 */
export function applyOperatorInvolvement(
  workflow: WorkflowDefinition,
  selection: { name: string; profile: OperatorInvolvementProfile },
): ResolvedOperatorInvolvement {
  const { name, profile } = selection
  const gates = profile.gates ?? {}
  const contracts = profile.contracts ?? []
  const wildcard = gates['*']
  const applied: ResolvedOperatorInvolvement['applied_gates'] = {}
  const stageSlugs = new Set(workflow.stages.map((stage) => stage.slug))

  for (const key of Object.keys(gates)) {
    invariant(
      key === '*' || stageSlugs.has(key),
      `Operator-involvement profile '${name}' targets stage '${key}', ` +
        `which workflow '${workflow.slug}' does not define.`,
      { code: 'INVALID_OPERATOR_INVOLVEMENT' },
    )
  }

  for (const stage of workflow.stages) {
    const workflowGate = stage.gate
    let runGate = workflowGate
    let source = 'workflow'

    if (wildcard !== undefined) {
      runGate = wildcard
      source = `profile '${name}' wildcard`
    }

    if (
      stage.checkpoint &&
      contracts.includes('technical_director') &&
      TECHNICAL_DIRECTOR_CHECKPOINTS.has(stage.checkpoint)
    ) {
      runGate = 'operator'
      source = `technical_director contract at ${stage.checkpoint} checkpoint`
    }

    const explicit = gates[stage.slug]

    if (explicit !== undefined) {
      runGate = explicit
      source = `profile '${name}' stage override`
    }

    if (runGate === workflowGate) {
      continue
    }

    invariant(
      stage.gate_relaxable !== false ||
        GATE_INVOLVEMENT[runGate] >= GATE_INVOLVEMENT[workflowGate],
      `Stage '${workflow.slug}/${stage.slug}' declares gate_relaxable: false, ` +
        `so involvement profile '${name}' MUST NOT lower its '${workflowGate}' ` +
        `gate to '${runGate}'.`,
      { code: 'INVALID_OPERATOR_INVOLVEMENT' },
    )

    stage.gate = runGate
    applied[stage.slug] = {
      workflow_gate: workflowGate,
      run_gate: runGate,
      source,
    }
  }

  return {
    profile: name,
    summary: profile.summary,
    contracts,
    applied_gates: applied,
  }
}

export function runHasContract(
  involvement: ResolvedOperatorInvolvement | undefined,
  contract: RunContract,
): boolean {
  return (involvement?.contracts ?? []).includes(contract)
}

import type {
  PolicyRequirement,
  RequirementExecutor,
  RequirementPhase,
} from '../types.js'

export interface RegistryEntry {
  id: string
  kind: 'automation' | 'validator'
  version: string
  handler: string
  input_contract: string
  result_schema: string
  target_types: string[]
  default_timeout_ms: number
  deterministic: boolean
  side_effect_free: boolean
}

export type InvocationKind =
  | 'workflow'
  | 'assessment'
  | 'spotfix'
  | 'investigation'
  | 'repair'
  | 'decomposition'
  | 'documentation'

export interface RequirementContext {
  persona: string
  workflow: string
  stage: string
  invocation_kind?: InvocationKind
  invocation?: {
    output_path?: string
    artifact_paths?: string[]
  }
}

export interface HandlerInput {
  root: string
  targetPath: string
  requirement: {
    policy_id: string
    requirement_id: string
    registry_id: string
    arguments: Record<string, string>
  }
  catalog?: import('./registry.js').RegistryCatalog
  context?: RequirementContext
  invocation?: Record<string, unknown>
  stage?: Record<string, unknown>
  runState?: Record<string, unknown>
}

const VALID_HANDLER_STATUSES = new Set([
  'passed',
  'failed',
  'blocked',
  'invalid',
])

export function isValidHandlerStatus(
  value: unknown,
): value is HandlerResult['status'] {
  return typeof value === 'string' && VALID_HANDLER_STATUSES.has(value)
}

export interface HandlerResult {
  status: 'passed' | 'failed' | 'blocked' | 'invalid'
  issues: Array<{
    code: string
    message: string
    pointer?: string
    line?: number
  }>
  evidence_paths?: string[]
}

export type ValidatorHandler = (input: HandlerInput) => HandlerResult

export const VALID_PHASES = new Set<RequirementPhase>([
  'before_operation',
  'pre_submit',
  'submit',
  'gate',
])

export const VALID_EXECUTORS = new Set<RequirementExecutor>([
  'agent',
  'harness',
  'both',
])

export const VALID_FAILURE_ROUTES = new Set([
  'retry',
  'stage_failure',
  'blocked',
  'operator_decision',
])

export function isValidPolicyRequirement(
  value: unknown,
): value is PolicyRequirement {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>

  if (
    record.applicability !== undefined &&
    (!isRecord(record.applicability) ||
      Object.values(record.applicability).some(
        (value) => typeof value !== 'string',
      ))
  ) {
    return false
  }

  return (
    typeof record.id === 'string' &&
    typeof record.registry_id === 'string' &&
    VALID_PHASES.has(record.phase as RequirementPhase) &&
    VALID_EXECUTORS.has(record.executor as RequirementExecutor) &&
    typeof record.target === 'string' &&
    (record.enforcement === 'advisory' ||
      record.enforcement === 'required' ||
      record.enforcement === 'authoritative') &&
    typeof record.failure_route === 'string' &&
    typeof record.evidence_class === 'string'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

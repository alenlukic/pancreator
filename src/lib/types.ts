export type StageOutcome = 'success' | 'failure' | 'blocked'

export type RunStatus =
  | 'running'
  | 'awaiting_supervisor'
  | 'awaiting_operator'
  | 'paused'
  | 'succeeded'
  | 'failed'
  | 'canceled'

export type WorkspacePolicy = 'source_allowed' | 'runtime_only' | 'read_only'

export type StageGate =
  | 'operator'
  | 'supervisor'
  | 'next_stage'
  | 'stage_verdict'

export type CriterionType = 'judgment' | 'shell' | 'state'

export type CriterionResultValue = 'pass' | 'fail' | 'not_applicable'

export type JsonTypeName = 'object' | 'array' | 'string' | 'number' | 'boolean'

export interface WorkflowLimits {
  maxTotalTransitions: number
  maxStageAttempts: number
  maxConsecutiveFailures: number
}

export interface SerializedWorkflowLimits {
  max_total_transitions: number
  max_stage_attempts: number
  max_consecutive_failures: number
}

export interface Criterion {
  id: string
  type: CriterionType
  hard?: boolean
  statement: string
  command?: string
  timeout_ms?: number
}

export interface StageTransitions {
  success: string
  failure: string
  blocked: string
}

export interface StageDefinition {
  slug: string
  title: string
  persona: string
  model_hint?: string
  prompt?: string
  prompt_path?: string
  prompt_sha256?: string
  workspace_policy: WorkspacePolicy
  gate: StageGate
  required_data?: Record<string, JsonTypeName>
  criteria: Criterion[]
  transitions: StageTransitions
}

export interface WorkflowIndex {
  schema_version: 1
  slug: string
  title: string
  description?: string
  start_stage: string
  limits: SerializedWorkflowLimits
  stages: string[]
}

export interface WorkflowDefinition extends Omit<WorkflowIndex, 'stages'> {
  stages: StageDefinition[]
}

export interface Policy {
  id: string
  title: string
  severity: 'hard' | 'soft'
  summary: string
  instructions: string[]
}

export interface PolicyLookupRow {
  persona: string
  workflow: string
  stage: string
  policies: string[]
}

export interface PolicyLookupTable {
  schema_version: 1
  rows: PolicyLookupRow[]
}

export interface WorkspaceSnapshot {
  kind: 'git' | 'filesystem'
  fingerprint: string
  entries: string[]
  head?: string | null
}

export interface WorkspaceDelta {
  added: string[]
  removed: string[]
}

export interface ArtifactReference {
  path: string
  description: string
}

export interface CriterionEvaluation {
  id: string
  result: CriterionResultValue
  evidence: string[]
  explanation: string
}

export interface StageOutput {
  $operator?: {
    headline: string
    status: string
    next_action: string
  }
  schema_version: 1
  invocation_id: string
  result: StageOutcome
  summary: string
  artifacts: ArtifactReference[]
  criteria: CriterionEvaluation[]
  risks: string[]
  unknowns: string[]
  data: Record<string, unknown>
}

export interface InvocationReference {
  path: string
  description: string
}

export interface Invocation {
  $operator: {
    headline: string
    summary: string
    next_action: string
  }
  schema_version: 1
  invocation_id: string
  run_id: string
  attempt: number
  created_at: string
  workflow: {
    slug: string
    snapshot_path: string
    snapshot_sha256: string
  }
  stage: {
    slug: string
    title: string
    persona: string
    model_hint?: string
    workspace_policy: WorkspacePolicy
    gate: StageGate
  }
  prompt: string
  inputs: {
    references: InvocationReference[]
  }
  policies: Policy[]
  rubric: Criterion[]
  output: {
    path: string
    template: string
    schema: string
    required_data: Record<string, JsonTypeName>
  }
  boundaries: string[]
  workspace_before: WorkspaceSnapshot
}

export interface DeterministicResult {
  id: string
  type: 'shell' | 'state'
  hard: boolean
  passed: boolean
  explanation?: string
  command?: string
  exit_code?: number | null
  timed_out?: boolean
  evidence_path?: string
  workspace_fingerprint: string
  delta?: WorkspaceDelta
}

export interface StageHistoryItem {
  stage: string
  attempt: number
  invocation_id: string
  output_path: string
  outcome: StageOutcome
  submitted_at: string
  workspace_fingerprint: string
  validation_errors: string[]
  deterministic: DeterministicResult[]
  record_path?: string
}

export type PendingAction =
  | { type: 'none' }
  | { type: 'prepare_invocation' }
  | { type: 'invoke_agent'; persona: string; path: string }
  | { type: 'supervisor_assessment'; path: string; output_path: string }
  | {
      type: 'operator_approval'
      stage: string
      proposed_transition: string
    }
  | { type: 'operator_decision' }

export interface CurrentInvocationPointer {
  id: string
  json_path: string
  markdown_path: string
  output_path: string
}

export interface RunState {
  schema_version: 1
  run_id: string
  workflow_slug: string
  workflow_snapshot: {
    path: string
    sha256: string
  }
  title: string
  status: RunStatus
  current_stage: string | null
  pending_action: PendingAction
  current_invocation: CurrentInvocationPointer | null
  request: {
    source_path: string
    stored_path: string
    sha256: string
  }
  limits: SerializedWorkflowLimits
  attempts: Record<string, number>
  transition_count: number
  consecutive_failures: number
  stage_history: StageHistoryItem[]
  revision: number
  created_at: string
  updated_at: string
  pause_reason?: string | null
  last_decision_path?: string
}

export interface SupervisorAssessment {
  schema_version: 1
  assessment_id: string
  invocation_id: string
  verdict: 'pass' | 'fail' | 'escalate'
  criteria: CriterionEvaluation[]
  summary: string
  action_items?: string[]
}

export interface TaskRecord {
  schema_version: 1
  run_id: string
  invocation_id: string
  stage: {
    slug: string
    title: string
    persona: string
  }
  outcome: StageOutcome
  summary: string
  artifacts: ArtifactReference[]
  risks: string[]
  unknowns: string[]
  evaluation: {
    validation_errors: string[]
    deterministic: DeterministicResult[]
    self: CriterionEvaluation[]
  }
  workspace_fingerprint: string
  next_state: string | null
  timestamp: string
}

export interface RepositoryValidationResult {
  ok: boolean
  errors: string[]
  warnings: string[]
  fingerprint: string
}

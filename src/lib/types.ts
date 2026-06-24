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

export type StageExecutor = 'agent' | 'harness'

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
  executor?: StageExecutor
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

export type WorkspaceEntryKind = 'file' | 'symlink'

export interface WorkspaceIndexEntry {
  kind: WorkspaceEntryKind
  checksum: string
  size: number
  modified_at_ms: number
}

export interface WorkspaceIndex {
  schema_version: 1
  workspace_id: string
  workspace_root: string
  scope_hash: string
  updated_at_ms: number
  entries: Record<string, WorkspaceIndexEntry>
}

export interface ActiveWorkflowLease {
  schema_version: 1
  workspace_id: string
  workflow_id: string
  acquired_at_ms: number
  process_id?: number
}

export interface WorkflowBaseline {
  schema_version: 1
  workflow_id: string
  workspace_id: string
  workspace_root: string
  state_root: string
  installation_root: string
  created_at_ms: number
  configuration_hash: string
  scope_hash: string
  entries: Record<string, WorkspaceIndexEntry>
}

export interface FileLock {
  schema_version: 1
  lock_id: string
  path: string
  canonical_path: string
  workflow_id: string
  stage: string
  stage_attempt: number
  invocation_id: string
  acquired_at_ms: number
  expected_checksum: string | null
}

export type LedgerOperation = 'create' | 'modify' | 'delete'

export interface ModificationLedgerEntry {
  schema_version: 1
  sequence: number
  path: string
  operation: LedgerOperation
  before_checksum: string | null
  after_checksum: string | null
  workflow_id: string
  stage: string
  stage_attempt: number
  invocation_id: string
  modified_at_ms: number
  lock_id: string
}

export interface LedgerAnomaly {
  id: string
  code: string
  severity: 'hard'
  path?: string
  sequence?: number
  expected?: string | null
  observed?: string | null
  summary: string
  details: string
  suggested_actions: Array<'accept' | 'restart-stage' | 'spot-fix' | 'abort'>
}

export interface LedgerValidationResult {
  schema_version: 1
  workflow_id: string
  status: 'passed' | 'operator-review-required' | 'waived'
  validated_at_ms: number
  baseline_scope_hash: string
  current_scope_hash: string
  ledger_entry_count: number
  modified_path_count: number
  anomalies: LedgerAnomaly[]
}

export interface TrackingConfig {
  include?: string[]
  exclude?: string[]
}

export interface ProjectConfig {
  schema_version: 1
  workspace_id?: string
  workspace_root?: string
  state_root?: string
  tracking?: TrackingConfig
}

export interface ResolvedRoots {
  installation_root: string
  workspace_root: string
  state_root: string
  workspace_id: string
  include: string[]
  exclude: string[]
  scope_hash: string
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
  workspace_root: string
  gate_overrides?: Record<string, string | false>
  workflow: {
    slug: string
    snapshot_path: string
    snapshot_sha256: string
  }
  stage: {
    slug: string
    title: string
    persona: string
    executor?: StageExecutor
    model: string
    model_config: string
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
  overridden?: boolean
  disabled?: boolean
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

export interface OperatorFeedbackItem {
  decision: 'reject' | 'resume' | 'set-stage'
  from_stage: string
  to_stage: string
  attempt: number
  note: string
  path: string
  timestamp: string
}

export interface OperatorPauseContext {
  prior_status: 'running' | 'awaiting_supervisor' | 'awaiting_operator'
  prior_pending_action: PendingAction
}

export interface RunState {
  schema_version: 1
  run_id: string
  workflow_slug: string
  workflow_snapshot: {
    path: string
    sha256: string
  }
  pipeline_config?: {
    name: string
    path: string
    sha256: string
  }
  workspace_root: string
  workspace_id?: string
  installation_root?: string
  state_root?: string
  scope_hash?: string
  latest_ledger_validation?: LedgerValidationResult['status']
  latest_ledger_validation_path?: string
  gate_overrides?: Record<string, string | false>
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
  operator_feedback?: OperatorFeedbackItem[]
  revision: number
  created_at: string
  updated_at: string
  pause_reason?: string | null
  operator_pause?: OperatorPauseContext | null
  last_decision_path?: string
  accepted_workspace_fingerprint?: string | null
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
  report_hash: string
}

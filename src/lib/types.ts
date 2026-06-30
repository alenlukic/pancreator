export type StageOutcome = 'success' | 'failure' | 'blocked'

export type RunStatus =
  | 'running'
  | 'awaiting_supervisor'
  | 'awaiting_operator'
  | 'paused'
  | 'succeeded'
  | 'failed'
  | 'canceled'

export type WorkspacePolicy =
  | 'source_allowed'
  | 'release_metadata_only'
  | 'runtime_only'
  | 'read_only'

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

export type StageContextRequest = 'required' | 'conditional' | 'omit'

export type StageContextSelection = 'latest' | 'latest_success'

export interface StageContextStageSelector {
  stage: string
  selection: StageContextSelection
}

export interface StageContextDefinition {
  request: StageContextRequest
  required_stage_outputs?: StageContextStageSelector[]
  conditional_stage_outputs?: StageContextStageSelector[]
  prior_attempts?: number
  operator_feedback?: number
  include_active_waivers?: boolean
  include_workspace_ratifications?: boolean
  include_latest_ledger_validation?: boolean
  legacy_full_history?: boolean
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
  context: StageContextDefinition
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

export type RequirementPhase =
  | 'before_operation'
  | 'pre_submit'
  | 'submit'
  | 'gate'

export type RequirementExecutor = 'agent' | 'harness' | 'both'

export type RequirementEnforcement = 'advisory' | 'required' | 'authoritative'

export type RequirementFailureRoute =
  | 'retry'
  | 'stage_failure'
  | 'blocked'
  | 'operator_decision'
  | string

export interface PolicyRequirement {
  id: string
  registry_id: string
  phase: RequirementPhase
  executor: RequirementExecutor
  target: string
  arguments?: Record<string, string>
  enforcement: RequirementEnforcement
  failure_route: RequirementFailureRoute
  evidence_class: string
  applicability?: Record<string, string>
}

export interface Policy {
  id: string
  title: string
  severity: 'hard' | 'soft'
  summary: string
  instructions: string[]
  requirements?: PolicyRequirement[]
}

export interface ResolvedRequirement {
  policy_id: string
  requirement_id: string
  registry_id: string
  registry_version: string
  kind: 'automation' | 'validator'
  phase: RequirementPhase
  executor: RequirementExecutor
  target: string
  resolved_target?: string
  arguments: Record<string, string>
  enforcement: RequirementEnforcement
  failure_route: RequirementFailureRoute
  evidence_class: string
  success_condition: string
}

export interface RequirementManifest {
  schema_version: 1
  automation_requirements: ResolvedRequirement[]
  validation_requirements: ResolvedRequirement[]
  policy_versions: Record<string, string>
  registry_version: string
  registry_hash: string
  resolved_targets: Record<string, string>
  unresolved_bindings: string[]
  manifest_hash: string
}

export type RequirementResultStatus =
  | 'passed'
  | 'failed'
  | 'blocked'
  | 'invalid'

export interface RequirementIssue {
  code: string
  message: string
  pointer?: string
  line?: number
}

export interface RequirementValidationResult {
  schema_version: 1
  requirement_id: string
  policy_id: string
  registry_id: string
  registry_version: string
  handler: string
  command: string
  target_path: string
  target_checksum?: string
  started_at: string
  finished_at: string
  exit_code: number
  status: RequirementResultStatus
  executor: 'agent' | 'harness'
  issues: RequirementIssue[]
  evidence_paths: string[]
  workspace_fingerprint?: string
}

export interface PolicyLookupRow {
  persona: string
  workflow: string
  stage: string
  installation_scope?: 'all' | 'self_development'
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
  installation_mode?: 'self_development' | 'embedded'
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

export type InvocationReferenceRetrieval =
  | 'required'
  | 'conditional'
  | 'index_only'

export interface InvocationReference {
  path: string
  description: string
  retrieval?: InvocationReferenceRetrieval
  condition?: string
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
    missing_required?: string[]
  }
  policies: Policy[]
  requirements?: RequirementManifest
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
  workspace_before?: WorkspaceSnapshot
  workspace_index_path?: string
}

export interface OperatorWorkspaceRatification {
  ratification_id: string
  stage: string
  workspace_fingerprint: string
  changed_paths: string[]
  deleted_paths: string[]
  note: string
  artifact_path: string
  timestamp: string
}

export interface OperatorGateWaiver {
  waiver_id: string
  stage: string
  source_invocation_id: string
  source_attempt: number
  source_evidence_path: string
  criterion_ids: string[]
  workspace_fingerprint: string
  note: string
  artifact_path: string
  deferred_acceptance_criteria: string[]
  spotfix_case_path?: string
  timestamp: string
}

export interface StageFailureTracker {
  last_signature: string[]
  repeat_count: number
}

export type SameReasonFailureTrackers = Partial<
  Record<'review' | 'test', StageFailureTracker>
>

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
  operator_workspace_ratifications?: OperatorWorkspaceRatification[]
  operator_gate_waivers?: OperatorGateWaiver[]
  last_decision_path?: string
  accepted_workspace_fingerprint?: string | null
  same_reason_failures?: SameReasonFailureTrackers
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

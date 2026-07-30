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

/**
 * Role a stage plays for run contracts that must attach to equivalent stages
 * across different workflows. `dev/plan`, `prototype/approach`, and any future
 * planning stage share `technical_plan`, so a contract escalates gates by role
 * rather than by hard-coding slugs it cannot know in advance.
 */
export type StageCheckpoint = 'technical_plan' | 'independent_review'

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
  /**
   * Whether an operator-involvement profile may lower this stage's gate. Absent
   * means relaxable. `dev/ship` sets it false because SHIP-001 requires a pause
   * before commit, push, merge, publication, or deployment; a stored config
   * profile MUST NOT be able to remove that pause silently.
   */
  gate_relaxable?: boolean
  checkpoint?: StageCheckpoint
  context: StageContextDefinition
  required_data?: Record<string, JsonTypeName>
  criteria: Criterion[]
  transitions: StageTransitions
}

/**
 * Run contracts a workflow run abides by for its whole lifetime. A contract is
 * orthogonal to workflow choice: the same contract applies to `dev`,
 * `prototype`, or `design` by attaching to stage checkpoints and personas
 * rather than to stage slugs.
 */
export type RunContract = 'technical_director'

/** One named operator-involvement profile from `config.json`. */
export interface OperatorInvolvementProfile {
  summary: string
  /**
   * Stage-slug to gate assignment. The `*` key applies to every stage in the
   * run and explicit slugs override it. Values name the gate the operator wants
   * for that stage, whether that raises or lowers involvement.
   */
  gates?: Record<string, StageGate>
  contracts?: RunContract[]
}

export interface OperatorInvolvementFile {
  active: string
  profiles: Record<string, OperatorInvolvementProfile>
}

/** What a run actually resolved, snapshotted so later config edits cannot drift it. */
export interface ResolvedOperatorInvolvement {
  profile: string
  summary: string
  contracts: RunContract[]
  /** Stage slug to the gate the run uses, recorded only where it differs from the workflow default. */
  applied_gates: Record<
    string,
    { workflow_gate: StageGate; run_gate: StageGate; source: string }
  >
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

export interface PolicyGuidance {
  source_path: string
  content: string
}

export interface Policy {
  id: string
  title: string
  severity: 'hard' | 'soft'
  summary: string
  instructions: string[]
  guidance?: PolicyGuidance[]
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
  technology?: string
  /**
   * Activates the row only for runs abiding by this contract. Keeps run
   * contracts inside the single policy applicability map instead of a second
   * one that could drift from it, as CONTRACT-001 requires.
   */
  contract?: RunContract
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
  /**
   * Content hash per dirty path. A Git status entry only records *that* a path
   * is modified, so two snapshots of the same already-dirty file are
   * indistinguishable by `entries` alone. Change detection needs these hashes
   * to see an edit that leaves the status code untouched.
   */
  dirty_content?: Record<string, string>
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
  /**
   * `embedded` installs the harness at `<target>/.pancreator`; `detached`
   * places it outside the target tree entirely, with `workspace_root` holding
   * the target's absolute path.
   */
  installation_mode?: 'self_development' | 'embedded' | 'detached'
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

export interface WorkspaceChangeAttribution {
  attribution: 'internal' | 'external' | 'mixed' | 'unknown'
  paths: string[]
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
  workspace_changes?: WorkspaceChangeAttribution
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
  operator_involvement?: ResolvedOperatorInvolvement
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
  prior_failure?: PriorAttemptFailure
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
    operator_brief: {
      source_path: string
      rendered_path: string
      schema: string
      renderer: string
      profile:
        | 'intake'
        | 'plan'
        | 'implementation'
        | 'review'
        | 'qa'
        | 'release'
        | 'inspection'
        | 'design'
        | 'handoff'
        | 'prototype-brief'
        | 'prototype-approach'
        | 'spike'
        | 'prototype-evaluation'
      required_headings: string[]
      /**
       * Card types and section semantics the renderer accepts. The brief schema
       * types both as open strings, so without this a schema-valid brief can
       * still fail to render — and the worker is contractually barred from
       * running the renderer to find out.
       */
      allowed_card_types?: string[]
      allowed_section_semantics?: string[]
    }
  }
  boundaries: string[]
  /**
   * Delivery contract for the supervisor that must hand this card to a worker.
   * Present only for delegated stages. The supervisor holds no card of its own
   * during the continuation loop, so `INVOCATION-001` is unrolled here — on the
   * artifact the supervisor is already reading at the moment it delegates —
   * rather than left to ambient recall of `AGENTS.md`.
   */
  delegation?: InvocationDelegationContract
  workspace_before: WorkspaceSnapshot
}

export interface InvocationDelegationContract {
  persona: string
  cursor_agent_path: string
  canonical_markdown_path: string
  invocation_validation_path: string
  delegation_artifact_path: string
  submit_command: string
  policies: Policy[]
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
  baseline_evidence_path?: string
  preexisting_failure?: boolean
  workspace_fingerprint: string
  delta?: WorkspaceDelta
}

export interface GovernanceArtifactIssue {
  issue_id: string
  stage: string
  invocation_id: string
  source:
    | 'invocation'
    | 'delegation'
    | 'stage-output'
    | 'operator-brief'
    | 'validator'
  message: string
  artifact_path?: string
  recorded_at: string
}

export interface StageHistoryItem {
  stage: string
  attempt: number
  invocation_id: string
  output_path: string
  outcome: StageOutcome
  submitted_at: string
  workspace_fingerprint: string
  /**
   * Fingerprint captured when this attempt's invocation was prepared. Together
   * with `workspace_fingerprint` it bounds the window the attempt is
   * accountable for, which is what lets ship retries prove evidence currency
   * by continuity instead of by guessing which paths the stage would touch.
   */
  workspace_before_fingerprint?: string
  validation_errors: string[]
  governance_artifact_warnings?: string[]
  deterministic: DeterministicResult[]
  /**
   * The attempt's own criterion self-evaluations. Deterministic results are
   * already durable, but a stage can fail purely on a judgment criterion, and
   * without this the run record cannot say which one — leaving a retry to guess.
   */
  self_criteria?: CriterionEvaluation[]
  record_path?: string
}

/**
 * Why the immediately preceding attempt of this stage failed, rendered inline on
 * the retry card. A path reference to the prior output is not enough: the reason
 * is spread across validation errors, deterministic results, and self-evaluated
 * criteria, so a worker handed only a pointer tends to resubmit the same defect.
 */
export interface PriorAttemptFailure {
  stage: string
  attempt: number
  invocation_id: string
  outcome: StageOutcome
  output_path: string
  failed_hard_criteria: Array<{
    id: string
    type: CriterionType
    statement: string
    explanation: string
  }>
  failed_deterministic: Array<{
    id: string
    command?: string
    exit_code?: number | null
    timed_out?: boolean
    evidence_path?: string
  }>
  validation_errors: string[]
  governance_artifact_warnings: string[]
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
      /**
       * Set when this stop is a technical-director checkpoint rather than an
       * ordinary ratification, so the supervisor can present the refinement
       * options DIRECTOR-001 requires instead of a plain approve/reject.
       */
      checkpoint?: StageCheckpoint
    }
  | { type: 'operator_decision' }

export interface CurrentInvocationPointer {
  id: string
  json_path: string
  markdown_path: string
  output_path: string
}

export interface OperatorFeedbackItem {
  decision: 'reject' | 'resume' | 'set-stage' | 'revise'
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
  whole_stage_bypass?: boolean
  workspace_fingerprint: string
  source_workspace_fingerprint?: string
  directive_target?: string
  validation_errors?: string[]
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

export type SameReasonFailureTrackers = Record<
  string,
  StageFailureTracker | undefined
>

export interface RepositoryCheckBaselinePointer {
  profile: string
  status: 'passed' | 'failed' | 'not_configured'
  artifact_path: string
  workspace_fingerprint: string
  recorded_at: string
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
  gate_overrides?: Record<string, string | false>
  operator_involvement?: ResolvedOperatorInvolvement
  /**
   * Extra stage attempts granted by operator-directed revisions, per stage. A
   * refinement round at a director checkpoint is not a failed attempt, so it
   * raises the ceiling instead of consuming budget reserved for failures.
   */
  operator_revisions?: Record<string, number>
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
  governance_artifact_issues?: GovernanceArtifactIssue[]
  governance_artifact_issues_path?: string
  repository_check_baselines?: Record<
    string,
    RepositoryCheckBaselinePointer | undefined
  >
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
    governance_artifact_warnings?: string[]
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

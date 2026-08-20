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
 * Which harness runs a persona's worker process. `cursor` delegates to a
 * projected Cursor subagent; `claude-code` spawns the operator-installed
 * Claude Code CLI. Distinct from `StageExecutor`, which says whether a stage is
 * performed by an agent at all — this says which agent runtime performs it.
 */
export type PersonaExecutorKind = 'cursor' | 'claude-code'

/**
 * Executor session recorded after a successful external delegation, so an
 * operator revision round can resume the author's full context instead of
 * starting a fresh invocation.
 */
export interface ExternalExecutorSession {
  executor: Exclude<PersonaExecutorKind, 'cursor'>
  session_id: string
  invocation_id: string
  stage: string
  recorded_at: string
}

/**
 * Harness-authored audit of one external-executor delegation. The delegation
 * Markdown artifact reproduces the delivered prompt byte for byte; this record
 * carries everything the Markdown cannot: executor identity, the resolved
 * argument vector (excluding the prompt body, which is piped), exit status, and
 * the session the executor returned.
 */
export interface ExternalDelegationRecord {
  schema_version: 1
  run_id: string
  invocation_id: string
  stage: string
  executor: Exclude<PersonaExecutorKind, 'cursor'>
  /**
   * `fresh` delivers the full canonical card in a new session. `resumed`
   * continues the recorded session with the operator's revision directive.
   * `resume_fallback` records a resume that failed and fell back to a fresh
   * full-card delivery.
   */
  delegation_kind: 'fresh' | 'resumed' | 'resume_fallback'
  binary: string
  argv: string[]
  exit_code: number | null
  timed_out: boolean
  duration_ms: number
  session_id?: string
  resumed_from_session_id?: string
  result_subtype?: string
  is_error?: boolean
  stdout_path: string
  stderr_path: string
  resume_attempt?: {
    exit_code: number | null
    timed_out: boolean
    stdout_path: string
    stderr_path: string
  }
  delegation_artifact_path: string
  recorded_at: string
}

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

/**
 * How the independent review stage gathers its findings. `default` is one
 * reviewer reading the whole change. `squad` delegates one agent per review
 * dimension and joins the returned findings. The mode selects the review method
 * only; `REVIEW-001` owns the verdict and the remediation boundary either way.
 */
export type ReviewMode = 'default' | 'squad'

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

/**
 * The verification level a run resolved at creation, snapshotted so later
 * config edits cannot drift it. `gates` maps shell-criterion ids to the
 * repository-check profile they effectively run, or `false` to skip.
 */
export interface ResolvedVerification {
  level: string
  summary: string
  gates: Record<string, string | false>
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

/**
 * Progressive-disclosure metadata for one selected guidance range.
 *
 * A card renders this instead of the guidance body, so the initial instruction
 * set stays small while the authority stays with the policy. The digest and the
 * counts describe the exact bytes the harness selected when it prepared the
 * invocation, which is what lets a reader detect a source that changed after
 * preparation. Guidance whose `reference` is absent was prepared before
 * progressive disclosure existed and keeps its inline body.
 */
export interface PolicyGuidanceReference {
  start_heading?: string
  end_heading?: string
  content_sha256: string
  line_count: number
  byte_length: number
  /** Imperative condition that tells the reader when to open the source. */
  read_trigger: string
}

export interface PolicyGuidance {
  source_path: string
  content: string
  reference?: PolicyGuidanceReference
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
  /**
   * Activates the row only for runs whose resolved review method matches. An
   * absent value applies to every review method.
   */
  review_mode?: ReviewMode
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

export interface WorktreesConfig {
  root?: string
  branch_prefix?: string
  setup?: string[]
}

export interface ResolvedWorktreesConfig {
  root: string
  branch_prefix: string
  setup: string[]
}

export interface ProjectConfig {
  schema_version: 1
  workspace_id?: string
  workspace_root?: string
  state_root?: string
  /** Maximum bytes permitted in one materialized workflow state file. */
  state_size_budget_bytes?: number
  /** Worker inactivity bound used by `pan status`. */
  stage_liveness_ms?: number
  tracking?: TrackingConfig
  /** Defaults for operator worktrees managed by `pan worktree`. */
  worktrees?: WorktreesConfig
  /**
   * `embedded` installs the harness at `<target>/.pancreator`; `detached`
   * places it outside the target tree entirely, with `workspace_root` holding
   * the target's absolute path.
   */
  installation_mode?: 'self_development' | 'embedded' | 'detached'
  /** Review method new runs adopt. Absent means `default`. */
  review_mode?: ReviewMode
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

export interface TargetInstructionEvidence {
  read_paths: string[]
}

export interface TargetInstructionInput {
  changed_paths: string[]
  read_paths: string[]
}

/**
 * Whether the worker read its complete canonical contract, or could not reach
 * it. `reference_failed` is only valid alongside a `blocked` stage result: a
 * worker that never held the contract has no basis for any other verdict.
 *
 * `pending` is the value the output scaffold writes. It is an intermediate
 * state, never a submittable one: prefilling `read` would put a claim the
 * harness cannot observe into the record before the worker made it.
 */
export type InvocationAttestationStatus =
  | 'pending'
  | 'read'
  | 'reference_failed'

export interface InvocationAttestationSection {
  id: string
  sha256: string
}

/**
 * What a worker did with one referenced guidance selection. `read` means the
 * worker held the selected content — from the source file, or from the
 * invocation snapshot when the file drifted. `skipped` means the worker judged
 * the read trigger inapplicable and says why. `reference_failed` means neither
 * the source nor the snapshot was readable, which fails the attestation.
 * `pending` is the scaffold value and is rejected at submission.
 */
export type GuidanceAttestationStatus =
  | 'pending'
  | 'read'
  | 'skipped'
  | 'reference_failed'

export interface GuidanceAttestationEntry {
  policy_id: string
  source_path: string
  content_sha256: string
  status: GuidanceAttestationStatus
  /** Why the read trigger did not apply. Required when status is skipped. */
  reason?: string
  /** Concrete read error. Required when status is reference_failed. */
  error?: string
}

/**
 * A worker's declaration that it read the complete referenced contract. The
 * declaration is the only observable a harness has: it cannot inspect the model
 * context that received the card. The whole-contract digest ties the claim to
 * the exact card on disk.
 *
 * Per-section and per-guidance digest echoes are legacy: they re-proved what
 * the contract digest already proves at kilobytes of transcription per
 * attempt, so they are optional and validated only when volunteered.
 *
 * A failed reference carries the read error instead of digests, because a worker
 * that never opened the contract has nothing to hash.
 */
export type InvocationAttestation =
  | {
      invocation_id: string
      model: string
      contract_path: string
      contract_sha256: string
      status: 'pending' | 'read'
      sections?: InvocationAttestationSection[]
      guidance?: GuidanceAttestationEntry[]
    }
  | {
      invocation_id: string
      model: string
      contract_path: string
      status: 'reference_failed'
      error: string
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
  target_instruction_evidence?: TargetInstructionEvidence
  invocation_attestation?: InvocationAttestation
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
  verification?: ResolvedVerification
  review_mode?: ReviewMode
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
    /**
     * Runtime that executes this persona. Absent on invocations prepared
     * before executor routing existed, which the harness reads as `cursor`.
     */
    persona_executor?: PersonaExecutorKind
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
    target_instructions?: TargetInstructionInput
  }
  policies: Policy[]
  requirements?: RequirementManifest
  rubric: Criterion[]
  output: {
    path: string
    template: string
    schema: string
    required_data: Record<string, JsonTypeName>
    field_contract?: {
      validators: Array<{
        registry_id: string
        enforcement: 'blocks' | 'advises'
      }>
      fields: Array<{
        path: string
        type: JsonTypeName | 'string'
        enum?: string[]
        required?: string[]
        format?: string
        accepted_shapes?: string[]
      }>
    }
    operator_brief: {
      source_path: string
      rendered_path: string
      /**
       * The harness deletes the source after a successful render and validation.
       * Absent on layout-v1 invocations, which retain the source artifact.
       */
      source_lifecycle?: 'transient' | 'retained'
      /** Compatibility signal for consumers that predate source_lifecycle. */
      source_transient?: boolean
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
   * during the continuation loop, so `INVOCATION-001` is stated here — on the
   * artifact the supervisor is already reading at the moment it delegates —
   * rather than left to ambient recall of `AGENTS.md`.
   */
  delegation?: InvocationDelegationContract
  /**
   * Section-level digest index for the canonical worker contract. Present for
   * invocations prepared with referenced delivery. Its absence marks a legacy
   * invocation whose delegation is validated by full-card equality.
   */
  contract_manifest?: InvocationContractManifest
  /**
   * New cards require run-scoped supervisor and worker model evidence.
   * Its absence preserves the contract of cards prepared before this feature.
   */
  model_evidence_required?: boolean
  workspace_before: WorkspaceSnapshot
}

/** Which side of the delivery a contract section binds. */
export type InvocationContractSectionOwner = 'worker' | 'supervisor'

export interface InvocationContractSection {
  id: string
  heading: string
  owner: InvocationContractSectionOwner
  line_count: number
  sha256: string
}

/**
 * One referenced guidance selection the contract points at. The manifest names
 * every selection so the scaffold can prefill a guidance attestation entry for
 * each, and so the attestation validator has an authoritative order and digest
 * to hold the worker's declarations against.
 */
export interface InvocationContractGuidance {
  policy_id: string
  source_path: string
  content_sha256: string
  read_trigger: string
}

/**
 * The canonical worker contract, described as ordered top-level blocks. The
 * blocks concatenate back to the exact contract bytes, so a section digest and
 * the full digest are checkable against the same file without a second render.
 */
export interface InvocationContractManifest {
  contract_path: string
  contract_sha256: string
  byte_length: number
  line_count: number
  sections: InvocationContractSection[]
  /** Absent when the contract references no guidance, and on legacy invocations. */
  guidance?: InvocationContractGuidance[]
}

/**
 * How the supervisor delivers a worker contract. `verbatim` pastes the whole
 * card. `referenced` pastes a compact delivery prompt that names one canonical
 * contract path, its digest, and a flat section index.
 */
export type InvocationDeliveryMode = 'verbatim' | 'referenced'

export interface InvocationDelegationContract {
  persona: string
  /**
   * Runtime the delegation targets. Absent means `cursor`. When external, the
   * harness — not the supervisor — moves the bytes and authors the delegation
   * evidence; the supervisor's only delivery action is `delegate_command`.
   */
  executor?: PersonaExecutorKind
  /** Present only for `cursor`-executor delegations. */
  cursor_agent_path?: string
  /** Harness command that performs an external delegation, e.g. `pan delegate <run-id>`. */
  delegate_command?: string
  canonical_markdown_path: string
  invocation_validation_path: string
  delegation_artifact_path: string
  submit_command: string
  /** Absent on legacy invocations, which the harness treats as `verbatim`. */
  mode?: InvocationDeliveryMode
  /** The exact prompt body the supervisor delivers under `referenced` mode. */
  delivery_prompt_path?: string
  policies: Policy[]
}

/** One normalized diagnostic identity and how many times a run reported it. */
export interface RepositoryCheckDiagnostic {
  kind: 'probe' | 'command'
  command: string
  diagnostic: string
  count: number
}

/**
 * How a repository-check result differs from its pre-implementation baseline.
 * `carried` failures are inherited and do not fail a gate. `fixed` failures give
 * a stage credit for repairing inherited breakage. Any `new` entry is a
 * regression and fails the owning gate.
 */
export interface RepositoryCheckDelta {
  new: RepositoryCheckDiagnostic[]
  fixed: RepositoryCheckDiagnostic[]
  carried: RepositoryCheckDiagnostic[]
  counts?: {
    new: number
    fixed: number
    carried: number
  }
  full_delta_ref?: {
    sha256: string
    path: string
    counts: {
      new: number
      fixed: number
      carried: number
    }
  }
  /** Full uncapped values retained only until state persistence externalizes them. */
  full?: {
    new: RepositoryCheckDiagnostic[]
    fixed: RepositoryCheckDiagnostic[]
    carried: RepositoryCheckDiagnostic[]
  }
}

export interface DeterministicResult {
  id: string
  type: 'shell' | 'state'
  hard: boolean
  passed: boolean
  overridden?: boolean
  disabled?: boolean
  /**
   * Set when the run's verification level remapped or skipped this gate's
   * workflow-declared repository-check profile.
   */
  verification_level?: string
  explanation?: string
  command?: string
  exit_code?: number | null
  timed_out?: boolean
  evidence_path?: string
  baseline_evidence_path?: string
  preexisting_failure?: boolean
  environment_blocked?: boolean
  repository_check_delta?: RepositoryCheckDelta
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
  /** Runtime that executed this attempt. Absent means `cursor`. */
  executor?: PersonaExecutorKind
  output_path: string
  outcome: StageOutcome
  submitted_at: string
  /**
   * Invocation id of the prior attempt this submission revised via a merge
   * patch. Absent for whole-document submissions.
   */
  revised_from?: string
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
  /**
   * Checksum of the transient brief source, recorded when submission deletes
   * it. Living in stage history keeps the deleted narrative auditable without
   * adding a file to the run directory.
   */
  operator_brief_source?: {
    source_path: string
    source_sha256: string
    rendered_path: string
    status: 'rendered_and_validated'
  }
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
  /**
   * The supervisor assessment that failed the prior attempt, when its gate was
   * supervisor-judged. Without this a retry after a supervisor 'fail' sees a
   * successful-looking attempt and re-guesses what to fix.
   */
  supervisor_assessment?: {
    verdict: string
    summary: string
    action_items: string[]
  }
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
       * The stage outcome that produced this stop. An operator gate applies to
       * every outcome, so approval must apply the recorded outcome rather than
       * assume success. Absent on an action recorded before outcomes were
       * stored, which the harness reads as `success`.
       */
      outcome?: StageOutcome
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
  prepared_at?: string
  last_activity_at?: string
}

export interface OperatorFeedbackItem {
  decision: 'approve' | 'reject' | 'resume' | 'set-stage' | 'revise'
  from_stage: string
  to_stage: string
  attempt: number
  note: string
  path: string
  timestamp: string
}

export interface RunModelEvidence {
  role: 'supervisor' | 'worker'
  invocation_id?: string
  persona: string
  declared_spec: string | null
  effective_model: string | null
  source: string
  result: 'recorded' | 'match' | 'mismatch' | 'unavailable'
  error?: string
  evidence_path: string
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

export interface BestOfNRunRole {
  bon_id: string
  role: 'candidate' | 'consolidation'
  /** Config name from the session configs file, unique inside the session. */
  slot: string
}

export interface RunState {
  schema_version: 1 | 2
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
   * Verification level this run resolved at creation. Absent on runs created
   * before levels existed, which keep workflow-declared gate behavior.
   */
  verification?: ResolvedVerification
  /**
   * Invocation ids whose `data.verification_recommendation` has already been
   * surfaced to the operator, so a declined recommendation does not re-pause
   * every later prepare.
   */
  verification_recommendations_surfaced?: string[]
  /**
   * Review method this run resolved at creation. Snapshotted so a later
   * `config.json` edit cannot change a run already in flight.
   */
  review_mode?: ReviewMode
  /**
   * Extra stage attempts granted by operator-directed revisions, per stage. A
   * refinement round at a director checkpoint is not a failed attempt, so it
   * raises the ceiling instead of consuming budget reserved for failures.
   */
  operator_revisions?: Record<string, number>
  /**
   * Suffix of the run-scoped Cursor agent variants this run delegates to. Set
   * only for a best-of-N run, whose personas carry models the active pipeline
   * config does not declare.
   */
  cursor_agent_suffix?: string
  /** Membership of a best-of-N session. Absent on an ordinary run. */
  best_of_n?: BestOfNRunRole
  title: string
  status: RunStatus
  current_stage: string | null
  pending_action: PendingAction
  current_invocation: CurrentInvocationPointer | null
  invocation_liveness?: {
    status: 'active' | 'stale'
    last_activity_at: string
    stale_after_ms: number
    age_ms: number
  }
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
  model_evidence?: RunModelEvidence[]
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
  /**
   * Latest executor session per stage slug, recorded after a successful
   * external delegation. Consulted only when an operator revision re-runs the
   * stage; retries after a failed attempt never resume.
   */
  external_executor_sessions?: Record<string, ExternalExecutorSession>
  /**
   * Cached claude-code preflight for this run. The credential probe spends a
   * real executor invocation, so it runs once per run rather than once per
   * delegation.
   */
  claude_code_preflight?: {
    binary: string
    version: string
    verified_at: string
  }
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

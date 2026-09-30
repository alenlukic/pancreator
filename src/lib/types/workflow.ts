import type { StageExecutor, StageGate, WorkspacePolicy } from './executors.js'
import type { AwayModeConfig } from './workspace.js'

/**
 * Role a stage plays for run contracts that must attach to equivalent stages
 * across different workflows. `dev/plan`, `prototype/approach`, and any future
 * planning stage share `technical_plan`, so a contract escalates gates by role
 * rather than by hard-coding slugs it cannot know in advance.
 */
export type StageCheckpoint = 'technical_plan' | 'independent_review'

export type CriterionType = 'judgment' | 'shell' | 'state'

export type CriterionResultValue =
  | 'pass'
  | 'fail'
  | 'not_applicable'
  | 'unevaluated'
  | 'skipped'

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

/**
 * A shell criterion the harness runs when the run enters the stage, before it
 * delegates the stage worker. The ship stage declares one for the `full`
 * profile: the release gate. A failure routes to `failure`, whose success
 * transition returns to this stage while that route is open. After
 * `max_loops` consecutive failures the next failure pauses the run for an
 * operator decision that away mode cannot take.
 */
export interface StageEntryGate {
  criterion: string
  failure: string
  max_loops: number
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
  /**
   * Include passed gate evidence so a worker cites the gate and does not run
   * the profile again.
   */
  gate_evidence?: boolean
  /**
   * Include the advisory suite profile of the run's last `full` gate and its
   * delta against the previous succeeded run in the same workspace.
   */
  suite_profile?: boolean
  legacy_full_history?: boolean
}

/**
 * Verdict-conditional persona selection. When the latest output of
 * `source_stage` carries a verdict the map names, the stage runs under the
 * mapped persona instead of its default persona. Run creation validates and
 * snapshots every mapped persona, so verdict routing cannot drift with later
 * config edits.
 */
export interface StagePersonaByVerdict {
  source_stage: string
  /** Dotted path inside the source output's data object, e.g. `verify.verdict`. */
  path: string
  map: Record<string, string>
}

/**
 * A parallel evidence worker the supervisor launches top-level before the
 * stage worker itself. Each worker writes one evidence report the stage
 * worker consolidates. Top-level launch preserves the persona-model mapping
 * that a nested spawn silently loses.
 */
export interface StageEvidenceWorkerDefinition {
  persona: string
  /** Short slug naming the evidence dimension, e.g. `review` or `qa`. */
  role: string
  /** One-paragraph scope statement rendered into the worker's brief. */
  scope: string
  /**
   * Scope used instead of `scope` on a return visit after remediation whose
   * blast radius names a path, and as the dimension scope of a scoped return.
   * Absent means `scope`.
   */
  return_scope?: string
  /**
   * Condition for launching the worker. `live_criteria` launches it only
   * when a criterion of the run has proof `live`, when the change touches a
   * user-facing surface, or when no proof can be read. Absent means the
   * worker always runs.
   */
  run_when?: EvidenceWorkerRunCondition
}

export type EvidenceWorkerRunCondition = 'live_criteria'

/** A declared evidence worker the harness did not launch on this visit. */
export interface EvidenceWorkerSkip {
  persona: string
  role: string
  run_when: EvidenceWorkerRunCondition
  reason: string
}

/**
 * When a return visit of an evidence stage runs one agent instead of its
 * evidence workers plus the stage worker. The harness decides; the stage
 * worker never declares one.
 */
export interface StageScopedReturn {
  /** Most paths the preceding remediation may have changed. */
  max_paths: number
  /** Most findings the verdict that routed the remediation may carry. */
  max_findings: number
  /** A changed path matching one of these keeps the full topology. */
  excluded_path_globs: string[]
  /**
   * Evidence roles the stage worker takes over. A stage whose declared roles
   * reach beyond this list, such as a design-composed verify, never scopes.
   */
  dimensions: string[]
}

/** The scoped return visit an invocation runs, with the facts that allowed it. */
export interface InvocationScopedReturn {
  remediation_invocation_id: string
  /** The verify visit whose verdict routed the remediation, when one did. */
  routing_invocation_id: string | null
  blast_radius: string[]
  findings: Array<{ id: string; severity: string; source: string }>
  /** Each evidence dimension the stage worker covers, with its scope text. */
  dimensions: Array<{ role: string; persona: string; scope: string }>
  limits: Pick<
    StageScopedReturn,
    'max_paths' | 'max_findings' | 'excluded_path_globs'
  >
}

/** Additive changes one optional design composition applies to a stage. */
export interface DesignCompositionStageOverride {
  required_stage_outputs?: StageContextStageSelector[]
  required_data?: Record<string, JsonTypeName>
  evidence_workers?: StageEvidenceWorkerDefinition[]
}

/**
 * Workflow-authored design augmentation applied only when a run requests it.
 * The base workflow remains the authority when the option is absent.
 */
export interface DesignComposition {
  stages?: string[]
  start_stage?: string
  limits?: Partial<SerializedWorkflowLimits>
  stage_overrides?: Record<string, DesignCompositionStageOverride>
}

export interface StageDefinition {
  slug: string
  title: string
  persona: string
  persona_by_verdict?: StagePersonaByVerdict
  evidence_workers?: StageEvidenceWorkerDefinition[]
  scoped_return?: StageScopedReturn
  executor?: StageExecutor
  prompt?: string
  prompt_path?: string
  prompt_sha256?: string
  workspace_policy: WorkspacePolicy
  gate: StageGate
  /**
   * Whether an operator-involvement profile may lower this stage's gate. Absent
   * means relaxable. `dev/ship` sets it false because SHIP-001 requires a pause
   * before branch push, pull-request creation, merge, publication, or deployment; a stored config
   * profile MUST NOT be able to remove that pause silently.
   */
  gate_relaxable?: boolean
  checkpoint?: StageCheckpoint
  context: StageContextDefinition
  required_data?: Record<string, JsonTypeName>
  /**
   * Shape a `blocked` result owes instead of `required_data`. A stage that
   * reports the precondition it lacked never produced the product fields, so
   * requiring them makes the honest report unsubmittable.
   */
  blocked_required_data?: Record<string, JsonTypeName>
  criteria: Criterion[]
  transitions: StageTransitions
  entry_gate?: StageEntryGate
}

/**
 * Run contracts a workflow run abides by for its whole lifetime. A contract is
 * orthogonal to workflow choice: the same contract applies to `dev`,
 * `prototype`, or `design` by attaching to stage checkpoints and personas
 * rather than to stage slugs.
 */
export type RunContract = 'technical_director' | 'long_horizon'

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
  /** Away-mode settings this profile snapshots instead of the project default. */
  away_mode?: AwayModeConfig
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
  design_composition?: DesignComposition
}

export interface WorkflowDefinition extends Omit<WorkflowIndex, 'stages'> {
  stages: StageDefinition[]
}

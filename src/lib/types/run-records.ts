import type { StageOutcome } from './executors.js'
import type { CriterionType, StageCheckpoint } from './workflow.js'
import type { RunActionActor, WorkspaceSnapshot } from './workspace.js'

/** Git and version identity of one Pancreator source tree. */
export interface SourceTreeIdentity {
  /** Absolute path of the tree. */
  root: string
  /** Commit the tree holds, or `null` outside a repository. */
  head: string | null
  /** Branch the tree holds, or `null` when HEAD is detached. */
  branch: string | null
  /** Contents of the tree's `VERSION` file, or `null` when unreadable. */
  version: string | null
}

/** Whether the build that executed a stage came from the tree it acted on. */
export interface BuildCurrencyRecord {
  /** Tree the running `dist` was compiled from. */
  executing_build: SourceTreeIdentity
  /** Tree the stage acted on. */
  workspace: SourceTreeIdentity
  /** True when both identities name the same tree state. */
  current: boolean
}

/**
 * The operator's stage-repair note, when that note and not a recorded attempt
 * is why the current attempt exists.
 *
 * An operator return to an earlier stage leaves no record of that stage for
 * the current attempt, so the retry contract resolved no reason and the card
 * left the newest superseded output of another stage as the only
 * failure-shaped context a worker could read.
 */
export interface OperatorStageRepairContext {
  from_stage: string
  to_stage: string
  /** Who directed the repair: the operator, or away mode on their behalf. */
  actor: string
  note: string
  /** The recorded repair note, which is required reading for this stage. */
  path: string
  recorded_at: string
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
  /**
   * Criteria the attempt itself reported failing that the stage does not hold
   * as hard, such as an acceptance criterion carried by the plan. Without this
   * a retry after a worker-declared failure saw no reason at all. Absent on a
   * record written before this source existed.
   */
  declared_criteria_failures?: Array<{
    id: string
    result: string
    explanation: string
  }>
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
  | {
      type: 'operator_decision'
      /**
       * Set when only the human operator may resolve this pause. Away mode
       * treats the run as having no permitted blocker and leaves it stopped.
       */
      operator_only?: true
    }

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
  /** Absent on records created before decision actors were stored. */
  source?: RunActionActor
  from_stage: string
  to_stage: string
  attempt: number
  note: string
  path: string
  timestamp: string
}

/**
 * A non-blocking observation about this run. An advisory never stops the run.
 */
export interface RunAdvisory {
  kind:
    | 'model_evidence'
    | 'repository_check_claim'
    | 'pipeline_config'
    | 'platform_guidance'
    | 'delegation_supervision'
    /** An evidence report whose worker stopped before its completion marker. */
    | 'evidence_report'
    /** A shared baseline adopted at a workspace other than its capture path. */
    | 'baseline_adoption'
    /** A hard criterion a compatibility path passed without satisfying. */
    | 'gate_bypass'
    /** A ship stage whose executing build is not the workspace it releases. */
    | 'build_currency'
    /** A returning verify stage whose interior profile refresh failed. */
    | 'verify_profile_refresh'
    /**
     * A non-blocking suite-cost observation: the fast wall over its ceiling
     * at release, or a source-stage worker that ran gate profiles itself or
     * browsed files through the shell.
     */
    | 'suite_cost'
  source: 'prepare' | 'probe' | 'submit' | 'supervisor_evidence'
  stage?: string
  invocation_id?: string
  message: string
  recorded_at: string
}

export interface RunModelEvidence {
  role: 'supervisor' | 'worker' | 'evidence_worker'
  invocation_id?: string
  /** Declared role of a parallel evidence worker, for example `review`. */
  worker_role?: string
  persona: string
  declared_spec: string | null
  effective_model: string | null
  source: string
  /** Cursor or executor handle for the launch this manual evidence describes. */
  launch_handle?: string
  /**
   * `pending` marks a detached probe in flight and `unavailable` a probe that
   * produced no answer. Neither is usable evidence on its own, so submission
   * replaces either with `default`: the spec the run snapshot projected for
   * that worker, labeled as a default rather than as a probe result.
   */
  result:
    | 'recorded'
    | 'match'
    | 'mismatch'
    | 'unavailable'
    | 'pending'
    | 'default'
  error?: string
  evidence_path: string
  timestamp: string
}

/**
 * Who is doing the work a pause makes room for.
 *
 * A supervisor that cannot delegate and does the stage work itself is not the
 * operator, and a record that says otherwise attributes the change to someone
 * who never made it.
 */
export type PauseActor = 'operator' | 'supervisor'

export interface OperatorPauseContext {
  prior_status: 'running' | 'awaiting_supervisor' | 'awaiting_operator'
  prior_pending_action: PendingAction
  workspace_before?: WorkspaceSnapshot
  /** Absent on pauses recorded before the actor was tracked: read as operator. */
  actor?: PauseActor
}

export interface OperatorWorkspaceRatification {
  ratification_id: string
  /** Who held the pause the changes were made under. */
  actor?: PauseActor
  stage: string
  workspace_fingerprint: string
  changed_paths: string[]
  deleted_paths: string[]
  note: string
  artifact_path: string
  timestamp: string
}

/**
 * One operator directive executed against the workspace outside a stage.
 *
 * `OPERATOR-001` lets a supervisor execute an operator directive as a
 * mechanical delegate. Without this record the resulting delta belongs to no
 * stage, and every later worker audits a legitimate edit as contamination.
 */
export interface WorkspaceDirectiveRecord {
  directive_id: string
  /** Who performed the edit the operator directed. */
  acting_role: 'supervisor' | 'operator'
  /** The operator directive, in the operator's own terms. */
  directive: string
  /** Stage the run held when the directive was executed. */
  stage: string
  /**
   * What the operator declared about committing these paths. Absent on a
   * record written before the field existed, which resolves to
   * `operator-owned`.
   */
  disposition?: WorkspaceAttributionDisposition
  changed_paths: string[]
  /**
   * The workspace as the last accountable record left it, so this record
   * bounds its own window the way a stage attempt does. Absent on records
   * written before the field existed, which therefore cannot carry a
   * currency chain.
   */
  workspace_before_fingerprint?: string
  workspace_fingerprint: string
  artifact_path: string
  timestamp: string
}

/**
 * What the operator declared about committing the paths one directive covers.
 *
 * `read-only-input` is the only value that exempts a path from a clean-tree
 * gate, and it is the value that keeps a path out of every commit the harness
 * makes. `commit-with-unit` names work that belongs in the unit's own commit.
 * `operator-owned` is the default and leaves every existing refusal in place.
 */
export type WorkspaceAttributionDisposition =
  | 'read-only-input'
  | 'commit-with-unit'
  | 'operator-owned'

/**
 * One operator directive, recorded so that every checkout of the repository
 * can read it.
 *
 * `WorkspaceDirectiveRecord` belongs to one run and answers "who changed
 * this". This record belongs to one repository and answers "may a gate treat
 * this path as clean state". One `pan attribute` writes both.
 */
export interface WorkspaceAttributionRecord {
  attribution_id: string
  /**
   * Common Git directory of the repository, as `gitCommonDir` reports it for
   * the checkout that recorded the directive. Every linked worktree of that
   * repository reports the same value, so one record reaches all of them.
   */
  repository_key: string
  /** Absolute path of the checkout the directive was executed in. */
  recorded_in: string
  run_id: string
  acting_role: 'supervisor' | 'operator'
  /** The operator directive, in the operator's own terms. */
  directive: string
  disposition: WorkspaceAttributionDisposition
  /** Repository-relative paths the directive covers. */
  paths: string[]
  /** Harness-relative path of the run evidence artifact. */
  artifact_path: string
  recorded_at: string
}

export interface WorkspaceAttributionStore {
  schema_version: 1
  records: WorkspaceAttributionRecord[]
}

/** One uncommitted path of a workspace, paired with its attribution. */
export interface DirtyWorkspacePath {
  path: string
  /** False only for an untracked path. Only an untracked path may be exempt. */
  tracked: boolean
  /** The newest record naming this path, or null when none does. */
  attribution: WorkspaceAttributionRecord | null
}

/** The one definition of uncommitted work every clean-tree gate reads. */
export interface WorkspaceCleanliness {
  /** The workspace judged, repository-relative when it sits inside the root. */
  workspace: string
  /** True when nothing blocks. Exempt paths do not make a workspace dirty. */
  clean: boolean
  blocking: DirtyWorkspacePath[]
  exempt: DirtyWorkspacePath[]
}

/**
 * The identity the platform returned for one delegated worker, recorded at
 * launch.
 *
 * The harness observes a worker through files alone, so a worker that dies
 * before its first write leaves nothing at all. This record is what names it
 * afterwards, and its attempt ordinal is what keeps a relaunch from being
 * handed the path the first worker already wrote.
 */
export interface DelegatedWorkerRecord {
  invocation_id: string
  /** `worker` for the stage worker itself, else the evidence-worker role. */
  role: string
  /** Ordinal of this launch for the invocation and role, counting from 1. */
  attempt: number
  /** The identity the platform returned, such as a Cursor subagent id. */
  handle: string
  /** Named agent definition launched, when the supervisor reported it. */
  agent?: string
  model?: string
  launch_mode: 'background' | 'foreground' | 'unknown'
  launched_at: string
  /** Paths this attempt owns, so a later attempt never reuses them. */
  declared_paths: string[]
  /**
   * The declared paths the harness itself wrote at launch, such as an
   * evidence worker's brief. They stay in `declared_paths` as diagnostics,
   * and they are not evidence that the worker wrote anything. Absent means
   * the worker produces every declared path.
   */
  harness_paths?: string[]
}

/** One stage entry gate an operator waiver's declared scope covers. */
export interface EntryGateReach {
  stage: string
  criterion: string
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
  /**
   * Who authored the directive. Absent means the operator, which every
   * record written before away mode could waive a gate carries.
   */
  actor?: RunActionActor
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
  /**
   * Cohort session whose shared baseline this pointer adopts. Absent on a
   * baseline the run captured itself.
   */
  shared_from_cohort?: string
  /** Run that captured the shared baseline this pointer adopts. */
  captured_by_run_id?: string
  /**
   * Workspace the capture executed in, relative to the harness root. A
   * cohort shares one baseline across chunk runs that each own a different
   * worktree, so a failure can belong to the capturing path rather than to
   * the change under test, and the reader needs the path to tell them apart.
   * Absent on a pointer recorded before the path was carried; an absent path
   * asserts nothing and the adoption behaves as it did then.
   */
  capture_workspace_path?: string
}

export interface BestOfNRunRole {
  bon_id: string
  role: 'candidate' | 'consolidation'
  /** Config name from the session configs file, unique inside the session. */
  slot: string
}

/** Membership of one cohort fan-out, recorded on the chunk's delivery run. */
export interface CohortChunkRunBinding {
  cohort_id: string
  /** Absent on records written before the release run carried a binding. */
  role?: 'chunk'
  /** 1-based index of the cohort this chunk belongs to. */
  cohort_index: number
  chunk: string
}

/**
 * Binding of the release run the last integration of a cohort session
 * started. The chunk runs are its implementation record, so the run names the
 * session and the final integration record rather than a chunk.
 */
export interface CohortReleaseRunBinding {
  cohort_id: string
  role: 'release'
  /** Harness-relative path of the final cohort's integration record. */
  integration_record: string
}

export type CohortRunBinding = CohortChunkRunBinding | CohortReleaseRunBinding

/** Which run is capturing the cohort session's shared baseline right now. */
export interface CohortBaselineCaptureClaim {
  run_id: string
  pid: number
  started_at: string
}

/** One unit of ratified work a single delivery run owns. */
export interface CohortChunkRecord {
  id: string
  title: string
  cohort_index: number
  child_spec_path: string
  depends_on: string[]
  worktree?: string
  branch?: string
  run_id?: string
  /** Operator note recorded when a chunk is abandoned. */
  abandoned?: {
    note: string
    recorded_at: string
  }
}

export interface CohortDependencyEdge {
  from: string
  to: string
}

export interface CohortGroupRecord {
  index: number
  chunks: string[]
}

/**
 * Proof that one cohort finished and merged. `integrateCohort` is the only
 * writer, so a later cohort cannot start on an unmerged predecessor.
 */
export interface CohortSatisfactionRecord {
  cohort_index: number
  recorded_at: string
  base_branch: string
  /** Branch the cohort merged into when it differs from `base_branch`. */
  integration_branch?: string
  merge_commit: string
  evidence_path: string
}

export interface CohortSessionState {
  schema_version: 1
  cohort_id: string
  plan_run_id: string
  parent_spec_path: string
  base_branch: string
  /** Optional design graph selection inherited from the planning run. */
  design_composition?: true
  /**
   * Branch the cohorts merge into and later cohorts branch from, when the
   * operator retargeted integration away from `base_branch` with
   * `pan cohort integrate --into-branch`. Absent records integrate into
   * `base_branch`.
   */
  integration_branch?: string
  /**
   * Absolute path of the Git repository the chunks fan out from: the plan
   * run's workspace repository. Records older than the field use the
   * configured workspace repository.
   */
  repository_root?: string
  /**
   * Concurrent chunk runs the session allows. `pan cohort start` fills only
   * the slots that terminal runs freed. Records older than the field default
   * to four.
   */
  max_parallel?: number
  /**
   * Release run the harness started when the last cohort integrated: a
   * `delivery` run that begins at `verify` on the integration branch. Absent
   * until that integration lands.
   */
  release_run_id?: string
  /**
   * The one shared pre-implementation baseline per interior gate profile for
   * the whole session. The first run that prepares a source-allowed stage
   * captures it; every other chunk run and the release run adopts it.
   */
  repository_check_baselines?: Record<string, RepositoryCheckBaselinePointer>
  /**
   * Claim the run that is capturing the shared baseline holds while the
   * capture runs, so a second run of the session waits instead of capturing
   * its own. Cleared when the capture is recorded or abandoned.
   */
  repository_check_baseline_capture?: CohortBaselineCaptureClaim
  created_at: string
  updated_at: string
  chunks: CohortChunkRecord[]
  edges: CohortDependencyEdge[]
  cohorts: CohortGroupRecord[]
  satisfaction: CohortSatisfactionRecord[]
}

/**
 * Where the ratified plan of a planning run went when its gate was approved.
 * A single-chunk plan hands off to one `delivery` run; a wider plan opens a
 * cohort session. The record lets `pan status <plan-run>` name the handoff.
 */
export type DeliveryHandoff =
  | {
      kind: 'delivery'
      run_id: string
      worktree: string
      recorded_at: string
    }
  | {
      kind: 'cohort'
      cohort_id: string
      recorded_at: string
    }
  | {
      /**
       * The route failed after the approval was durable. The approval and the
       * ratified plan stand; the manual commands complete the route by hand,
       * and a later successful retry replaces this record.
       */
      kind: 'failed'
      /** Shape of the route that failed, when the plan could be read. */
      route?: 'cohort' | 'delivery'
      error: string
      manual_commands: string[]
      recorded_at: string
    }

/** One worktree claim moved between two runs by waiver-based plan reuse. */
export interface WorktreeClaimTransfer {
  /** `released` on the subsumed run, `adopted` on the run that reused its plan. */
  role: 'released' | 'adopted'
  worktree: string
  from_run_id: string
  to_run_id: string
  waiver_id: string
  timestamp: string
}

/** Durable membership of one workflow run in a long-horizon session task. */
export interface HorizonRunBinding {
  session_id: string
  task_id: string
  role: 'task' | 'replan'
}

/** Per-task escalation counters carried by the run that executes the task. */
export interface HorizonLadderState {
  retries_spent: number
  strategy_switches_spent: number
  replans_spent: number
  last_failure_signature: string[]
  approaches_tried: string[]
  directive?: string
  pause_kind?: 'ladder_exhausted'
  failure_record_path?: string
}

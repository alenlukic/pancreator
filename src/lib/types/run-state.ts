import type { ExternalExecutorSession, RunStatus } from './executors.js'
import type {
  GovernanceArtifactIssue,
  StageEntryGateRecord,
  StageHistoryItem,
} from './gates.js'
import type { OperatorArtifactSelection } from './invocation.js'
import type { ContextReference, KnownFailingTest } from './requirements.js'
import type {
  BestOfNRunRole,
  CohortRunBinding,
  CurrentInvocationPointer,
  DelegatedWorkerRecord,
  DeliveryHandoff,
  HorizonLadderState,
  HorizonRunBinding,
  OperatorFeedbackItem,
  OperatorGateWaiver,
  OperatorPauseContext,
  OperatorWorkspaceRatification,
  PendingAction,
  RepositoryCheckBaselinePointer,
  RunAdvisory,
  RunModelEvidence,
  SameReasonFailureTrackers,
  WorkspaceDirectiveRecord,
  WorktreeClaimTransfer,
} from './run-records.js'
import type {
  SupervisorCardState,
  SupervisorHandoffRecord,
  WorkspaceSetupRecord,
} from './supervisor.js'
import type {
  ResolvedOperatorInvolvement,
  ResolvedVerification,
  SerializedWorkflowLimits,
} from './workflow.js'
import type {
  AgentHealthView,
  DirtyWorkspaceExit,
  ManagedWorktreeReference,
  ReleaseLandingRecord,
  ResolvedAwayModeConfig,
  RunConfigurationOverride,
} from './workspace.js'

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
  /** Managed worktree identity selected when this run started. */
  managed_worktree?: ManagedWorktreeReference
  /**
   * Waiver-based plan reuse moved this run's worktree claim, or gave it one.
   *
   * Occupancy is otherwise derived from liveness alone, so a run whose plan
   * another run adopted under an operator waiver would hold its worktree
   * until someone aborted it, and release preparation for the adopting run
   * would refuse correctly for the wrong reason.
   */
  worktree_claim_transfer?: WorktreeClaimTransfer
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
  /** Away-mode settings resolved when the run was created. */
  away_mode?: ResolvedAwayModeConfig
  /** Explicit run-local changes made while resolving snapshotted settings. */
  configuration_overrides?: RunConfigurationOverride[]
  /**
   * Operator artifact selection for this run. Absent means enabled for every
   * stage, which preserves runs created before artifact selection existed.
   */
  operator_artifacts?: OperatorArtifactSelection
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
  /** Membership of a cohort fan-out. Absent on an ordinary run. */
  cohort?: CohortRunBinding
  /** Membership of a long-horizon session. Absent on an ordinary run. */
  horizon?: HorizonRunBinding
  /** Contract-gated escalation state. Absent until a long-horizon failure. */
  horizon_ladder?: HorizonLadderState
  /**
   * Route the ratified plan into delivery when its gate is approved: one
   * `delivery` run for a single chunk, cohort 1 for a wider plan. Recorded on
   * every `planning` run; `pan init --no-autostart` records `false`.
   */
  autostart_delivery?: boolean
  /**
   * Predecessor of `autostart_delivery`, written by runs created while the
   * routing covered only the cohort fan-out. Read as a fallback and never
   * written.
   */
  autostart_cohort?: boolean
  /**
   * Parallelism limit the autostarted cohort session records. Absent means
   * the session default.
   */
  autostart_max_parallel?: number
  /** Optional design graph selection snapshotted when the run was created. */
  design_composition?: true
  /** Delivery the approval of this planning run started. */
  delivery_handoff?: DeliveryHandoff
  title: string
  status: RunStatus
  current_stage: string | null
  pending_action: PendingAction
  current_invocation: CurrentInvocationPointer | null
  /** Registry-backed agent health derived for status output. */
  agent_health?: AgentHealthView
  /** Legacy quiet-period signal retained for old state readers. */
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
    /**
     * Tests the request declares as already failing, parsed at run creation.
     * The entry gate reports each as baseline instead of blaming the stage it
     * gates. Absent when the request declares none.
     */
    known_failing_tests?: KnownFailingTest[]
    /**
     * Wider context the request depends on, delivered by reference. A cohort
     * chunk run points at the parent specification here.
     */
    context_reference?: ContextReference
  }
  limits: SerializedWorkflowLimits
  attempts: Record<string, number>
  transition_count: number
  consecutive_failures: number
  stage_history: StageHistoryItem[]
  operator_feedback?: OperatorFeedbackItem[]
  model_evidence?: RunModelEvidence[]
  /** Non-blocking observations recorded during this run, newest last. */
  advisories?: RunAdvisory[]
  revision: number
  created_at: string
  updated_at: string
  pause_reason?: string | null
  operator_pause?: OperatorPauseContext | null
  operator_workspace_ratifications?: OperatorWorkspaceRatification[]
  /** Operator directives executed against the workspace outside a stage. */
  workspace_directives?: WorkspaceDirectiveRecord[]
  /** Platform handles recorded for delegated workers, oldest first. */
  delegated_workers?: DelegatedWorkerRecord[]
  /** Uncommitted work the run left behind when it reached a terminal state. */
  dirty_exit?: DirtyWorkspaceExit
  /** The landing an operator directive closed this run on (`decide landed`). */
  release_landing?: ReleaseLandingRecord
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
  /**
   * Cached openai preflight for this run. Credential resolution and runtime
   * capability are both local, so this caches work rather than a spent
   * invocation, and it records which source supplied the key.
   */
  openai_preflight?: {
    key_source: string
    verified_at: string
  }
  /**
   * Cached copilot binary preflight for this run. The version and `--help`
   * checks are local; the credential is resolved again at each delegation
   * because each persona mapping can name its own provider.
   */
  copilot_preflight?: {
    binary: string
    version: string
    verified_at: string
  }
  governance_artifact_issues?: GovernanceArtifactIssue[]
  governance_artifact_issues_path?: string
  /**
   * The rendered supervisor governance card for this run. `pan init` and
   * `pan prepare` render it; `pan prepare` and `pan submit` refuse while the
   * current digest is not attested. Absent on runs created before the card
   * existed, which gain it on their next prepare.
   */
  supervisor_card?: SupervisorCardState
  repository_check_baselines?: Record<
    string,
    RepositoryCheckBaselinePointer | undefined
  >
  /** Entry-gate records keyed by stage slug. Absent until a gate first runs. */
  entry_gates?: Record<string, StageEntryGateRecord>
  /**
   * Outcome of the workspace setup check the harness ran before this run's
   * first prepared stage. Present only for a run whose workspace is not the
   * configured default. A `passed` or `not_configured` record means setup
   * does not run again for this run; a `failed` one is retried on the next
   * prepare.
   */
  workspace_setup?: WorkspaceSetupRecord
  /**
   * Supervisor-handoff records for this run, one per attempt. An attempt
   * appends a `sending` record, and each later transition to `sent`,
   * `aborted`, or `accepted` replaces that latest record in place. The run
   * event log keeps every transition. Only the latest record decides the
   * fence.
   */
  supervisor_handoffs?: SupervisorHandoffRecord[]
}

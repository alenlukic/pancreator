import type { PersonaExecutorKind } from './executors.js'

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
  /**
   * Content hash per path that a commit absorbed since the snapshot's declared
   * commit base. A commit removes a path from `git status` without changing
   * the working tree, so `entries` alone reads the release commit a ship stage
   * is required to make as though the workspace had changed. These hashes let
   * the comparison see that the content stayed identical.
   *
   * Absent on a snapshot recorded without a commit base, and on every snapshot
   * a run already in flight recorded before this field existed.
   */
  commit_content?: Record<string, string>
}

export interface TrackingConfig {
  include?: string[]
  exclude?: string[]
}

export interface WorktreesConfig {
  root?: string
  branch_prefix?: string
  setup?: string[]
  /**
   * Worktree-relative paths the setup commands produce, such as a dependency
   * tree or a build directory. Readiness is asserted against these rather
   * than inferred from a language, so a worktree the harness did not
   * provision reports what it is missing by name.
   */
  readiness_paths?: string[]
}

export interface ResolvedWorktreesConfig {
  root: string
  branch_prefix: string
  setup: string[]
  readiness_paths: string[]
}

/**
 * What a run left uncommitted in its bound workspace when it ended.
 *
 * A terminal run stops watching its workspace, so anything still dirty is
 * work nobody is accountable for. Naming the paths and the worktree is what
 * lets the operator find it before the next run inherits the tree.
 */
export interface DirtyWorkspaceExit {
  /** Managed worktree the run was bound to, or `null` for a plain workspace. */
  worktree: string | null
  workspace_root: string
  changed_paths: string[]
  recorded_at: string
}

/** Stable identity of one managed operator worktree. */
export interface ManagedWorktreeReference {
  name: string
  path: string
  branch: string
}

/**
 * Operator decision that moved release synchronization off its default rebase
 * target. Recorded on the sync result so the release output carries the
 * reason the pre-rebase refusal did not apply.
 */
export interface LocalReleaseRebaseOverride {
  kind: 'onto' | 'no_rebase'
  /** Ref the operator named, verbatim. Null for `--no-rebase`. */
  requested_ref: string | null
  /** Commit the named ref resolved to. Null when no rebase ran. */
  resolved_commit: string | null
}

export interface LocalReleaseAdvisory {
  code: 'RELEASE_LOCAL_DEFAULT_AHEAD'
  message: string
  details: {
    default_branch: string
    fetched_main: string
    local_head: string
  }
}

export interface LocalReleaseSyncResult {
  status: 'already_current' | 'synchronized' | 'conflict'
  worktree: ManagedWorktreeReference
  branch: string
  remote: string
  fetched_main: string
  /** Commit the rebase replayed onto, or null when an override skipped it. */
  rebase_target: string | null
  /** Operator override of the default rebase target, when one was used. */
  rebase_override: LocalReleaseRebaseOverride | null
  checkpoint_commit: string | null
  advisories: LocalReleaseAdvisory[]
  /** Paths a `read-only-input` attribution kept out of the checkpoint. */
  withheld_paths: string[]
  conflicted_paths: string[]
}

export interface LocalReleaseContinueResult {
  status: 'not_needed' | 'complete' | 'conflict'
  worktree: ManagedWorktreeReference
  branch: string
  /** Paths a `read-only-input` attribution kept out of the continuation. */
  withheld_paths: string[]
  conflicted_paths: string[]
}

export interface LocalReleaseFinalizeResult {
  status: 'finalized'
  worktree: ManagedWorktreeReference
  branch: string
  version: string
  fetched_main: string
  release_commit: string
  index_commit: string
  advisories: LocalReleaseAdvisory[]
  clean: boolean
}

export type AwayModeAction =
  | 'approve'
  | 'reject'
  | 'revise'
  | 'resume'
  | 'set-stage'
  | 'waive-gate'

export type RunActionActor = 'operator' | 'away'

/** A release that landed on pan-dev outside the ship stage, read from the landing log. */
export interface ReleaseLandingRecord {
  version: string
  release_commit: string | null
  index_commit: string | null
  tip_before: string
  tip_after: string
  verified_profiles: string[]
  verification_basis: string
  landed_at: string
  landing_token: string
  directive_note: string
  recorded_at: string
}

export interface AwayModeGuardrails {
  allowed_actions?: AwayModeAction[]
}

export interface AwayModeConfig {
  enabled: boolean
  guardrails?: AwayModeGuardrails
}

export interface ResolvedAwayModeConfig {
  enabled: boolean
  guardrails: {
    allowed_actions: AwayModeAction[]
  }
  source_sha256: string
}

export interface RunConfigurationOverride {
  setting: 'away_mode.enabled'
  configured_value: boolean
  applied_value: boolean
  reason: string
}

export type AgentHealth =
  | 'running'
  | 'stalled'
  | 'dead'
  | 'completed'
  | 'unknown'

export interface AgentRecoveryState {
  step?: 'nudge' | 'resume' | 'redeliver' | 'reprepare' | 'quarantine'
  attempts: number
  consecutive_failures: number
  last_failure_signature?: string
  last_attempt_at?: string
  quarantined: boolean
}

export interface AgentRecord {
  agent_id: string
  parent_agent_id: string | null
  run_id: string
  invocation_id: string
  persona: string
  executor: PersonaExecutorKind
  model: string | null
  session_id: string | null
  transcript_path: string | null
  process_id: number | null
  process_alive: boolean | null
  discovered_at: string
  last_observed_at: string
  last_transcript_at: string | null
  consecutive_unchanged_scans: number
  health: AgentHealth
  health_evidence: string[]
  recovery: AgentRecoveryState
}

export interface AgentHealthView {
  agent_id: string
  health: AgentHealth
  evidence_at: string
  recovery: AgentRecoveryState
}

export interface RegisteredInstallation {
  id: string
  path: string
}

export interface RetentionConfig {
  default_days?: number
  classes?: Record<string, number>
}

/** Configuration for the multi-instance spend sync feature. */
export interface SpendConfig {
  /** Vercel service host for spend snapshots, e.g. `pan-spend.vercel.app`. */
  vercel_host?: string
}

/**
 * Default model and effort the `pan handoff` command selects when the operator
 * omits `--model` and `--effort`. Values must match Cursor picker labels
 * exactly. Both fields are non-empty strings; the loader rejects an empty or
 * absent value with `INVALID_PROJECT_CONFIG`.
 */
export interface HandoffConfig {
  /** Default Cursor picker model label, e.g. `"Claude Opus 5.5"`. */
  model: string
  /** Default Cursor picker effort label, e.g. `"High"`. */
  effort: string
}

export interface ProjectConfig {
  schema_version: 1
  workspace_id?: string
  workspace_root?: string
  state_root?: string
  /** Self-development fast-lane wall ceiling and its permitted weekly rise. */
  fast_wall?: FastWallConfig
  /** Where self-development test fixtures live; see `src/lib/test-scratch.ts`. */
  test_scratch?: { root?: string | null }
  /** Maximum bytes permitted in one materialized workflow state file. */
  state_size_budget_bytes?: number
  /** Worker inactivity bound used by `pan status`. */
  stage_liveness_ms?: number
  tracking?: TrackingConfig
  /** Defaults for operator worktrees managed by `pan worktree`. */
  worktrees?: WorktreesConfig
  /** Retention windows for harness-owned ephemeral state. */
  retention?: RetentionConfig
  /**
   * `embedded` installs the harness at `<target>/.pancreator`; `detached`
   * places it outside the target tree entirely, with `workspace_root` holding
   * the target's absolute path.
   */
  installation_mode?: 'self_development' | 'embedded' | 'detached'
  /** Operator clients that receive projections. Absent means `["cursor"]`. */
  hosts?: Array<'cursor' | 'vscode'>
  /** Autonomous blocker handling, snapshotted into each new run. */
  away_mode?: AwayModeConfig
  /** Calendar-triggered unattended work. Disabled in the shipped config. */
  schedule?: ScheduleConfig
  /** Operator-declared Pancreator installation roots on this machine. */
  installations?: RegisteredInstallation[]
  /** Multi-instance spend sync configuration. */
  spend?: SpendConfig
  /** Default model and effort for `pan handoff`. */
  handoff?: HandoffConfig
}

export type ScheduleWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface ScheduleActionOptions {
  involvement?: string
  verification?: string
  pipeline_config?: string
  attest_supervisor_card?: boolean
}

export type ScheduleAction =
  | { kind: 'command'; command: string }
  | ({
      kind: 'workflow'
      workflow: string
      request_path: string
    } & ScheduleActionOptions)
  | {
      kind: 'session'
      queue_path: string
      involvement?: string
    }
  | ({
      kind: 'prompt'
      prompt: string
      workflow?: string
    } & ScheduleActionOptions)

export interface ScheduleJob {
  id: string
  enabled: boolean
  hour: number
  minute: number
  weekdays?: ScheduleWeekday[]
  timezone?: string
  catch_up_window_minutes?: number
  grace_period_minutes?: number
  workspace?: string
  worktree?: string
  /** When true, skip this job outside a self_development installation. */
  self_development_only?: boolean
  action: ScheduleAction
}

export interface ScheduleConfig {
  enabled: boolean
  catch_up_window_minutes?: number
  grace_period_minutes?: number
  jobs: ScheduleJob[]
}

export interface FastWallConfig {
  /**
   * Null in a target installation until the first passing harness `fast`
   * baseline measures the suite and sets it.
   */
  ceiling_ms: number | null
  /** When a measured baseline set `ceiling_ms` on this installation. */
  calibrated_at?: string
  anchor_date: string
  weekly_allowance_ms: number
  /** Maximum accepted one-minute load average divided by logical CPUs. */
  max_load_average_per_cpu: number
  /** Qualified samples required before the rolling average has a verdict. */
  minimum_qualified_samples: number
}

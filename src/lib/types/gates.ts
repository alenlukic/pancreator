import type { PersonaExecutorKind, StageOutcome } from './executors.js'
import type { CriterionEvaluation, WorkspaceDelta } from './invocation.js'
import type { BuildCurrencyRecord } from './run-records.js'

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
  /**
   * Set when the baseline was captured in a different workspace than the one
   * this check ran in, which a shared cohort baseline always is. A new
   * diagnostic under that divergence may belong to either workspace, so the
   * delta names the two paths instead of attributing the failure.
   */
  baseline_workspace_divergence?: {
    baseline_workspace: string
    current_workspace: string
  }
}

export type GateFailureDisposition =
  | 'environment_or_flake'
  | 'reproduced'
  | 'in_change_closure'
  | 'isolation_unavailable'
  /**
   * The isolation command exited cleanly but its transcript never names the
   * failing test, so nothing proves the test ran. A filter that selects
   * nothing produces exactly this shape, and crediting it would convert a
   * real failure into a pass.
   */
  | 'isolation_unproven'

export interface GateFailureClassification {
  file: string
  test: string
  initial_diagnostic: string
  disposition: GateFailureDisposition
  /** Why a non-reclassifying disposition was reached, for counting across runs. */
  reason?: string
  isolation_command?: string
  isolation_exit_code?: number | null
  isolation_timed_out?: boolean
  /** Whether the rerun transcript names the failing test as executed. */
  isolation_executed?: boolean
}

export interface DeterministicResult {
  id: string
  type: 'shell' | 'state'
  hard: boolean
  passed: boolean
  overridden?: boolean
  disabled?: boolean
  /**
   * Set when the gate was not executed because the submission had already
   * decided a non-success outcome (declared failure or blocked, a failed hard
   * self-criterion, or a failed read attestation). A deterministic gate can
   * only confirm a success, so running one after the outcome is decided
   * spends its runtime proving nothing. `passed` stays true so a skipped gate
   * never masquerades as the failure reason; `explanation` records why it did
   * not run.
   */
  skipped?: boolean
  /**
   * Set when the run's verification level remapped or skipped this gate's
   * workflow-declared repository-check profile.
   */
  verification_level?: string
  /**
   * Set when the gate accepted a cached clean pass and did not run the
   * command.
   */
  cached?: boolean
  /**
   * Set when an active operator gate waiver covered this criterion, so the
   * command never ran. `passed` stays true because the operator decided the
   * gate does not block, and `waiver_id` names the directive that decided it;
   * the absence of `exit_code` and `evidence_path` keeps it distinguishable
   * from a clean pass.
   */
  waived?: boolean
  /** Waiver that covered this criterion. Present only with `waived`. */
  waiver_id?: string
  /**
   * Harness-relative path of the suite profile the test reporter wrote while
   * this gate ran the `full` profile. A cached pass carries the path the
   * original execution recorded. Absent when the profile ran no reporter.
   */
  suite_profile_path?: string
  explanation?: string
  command?: string
  exit_code?: number | null
  timed_out?: boolean
  evidence_path?: string
  baseline_evidence_path?: string
  preexisting_failure?: boolean
  environment_blocked?: boolean
  repository_check_delta?: RepositoryCheckDelta
  failure_classifications?: GateFailureClassification[]
  /**
   * Lanes a failed repository-check gate failed in: a test lane directory
   * name (`unit`, `integration`, ...) for a failing test, otherwise the
   * failing command. Absent on a pass and on a non-profile gate.
   */
  failed_lanes?: string[]
  workspace_fingerprint: string
  delta?: WorkspaceDelta
  /**
   * Set when the harness ran this gate at stage entry, before delegation, and
   * carried the recorded result into the submission instead of running the
   * command again.
   */
  entry_gate?: boolean
}

/** Run-state record of one stage's entry gate. */
export interface StageEntryGateRecord {
  criterion_id: string
  /** Total executions over the run; names each execution's evidence. */
  executions: number
  /** Consecutive failures since the last pass or operator decision. */
  failures: number
  /**
   * Stage the last failure routed to. Present while that repair loop is open:
   * the routed stage returns here on success instead of following its own
   * success transition.
   */
  routed_to?: string
  /**
   * Stage the last failure sent the run to for repair, whichever way that
   * repair returns. A repair that returns through its own success path
   * carries no `routed_to`, but still repairs from this gate's evidence.
   */
  repair_stage?: string
  /** Latest execution, pass or fail. */
  last_result: DeterministicResult
  /**
   * Set on a failure in a lane no earlier gate of the run proved current for
   * the same workspace: the lanes and the profiles that were current. Audits
   * count these to find checks that belong before the verify verdict.
   */
  lane_gap?: { lanes: string[]; verified_profiles: string[] }
  /**
   * Source content digest of the workspace the last pass verified, outside
   * `runtime/` and the release landing metadata paths, with the profile that
   * pass ran. Present only when the gate executed its profile and passed; a
   * waived or level-disabled gate proved nothing and records none. `pan
   * release land` reads it to tell a no-op integrate on this tree from one
   * on a tree nobody verified.
   */
  verified_source?: { fingerprint: string; profile: string }
  /**
   * Length of `stage_history` when the current visit passed. The pass stands
   * while no other stage submits after it; leaving the stage closes the visit.
   */
  passed_at_history_length?: number
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
  /**
   * Size of the submitted stage output in bytes. Advisory observability for
   * output-volume creep; never a gate.
   */
  output_bytes?: number
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
  /**
   * Self-development ship only. Which build executed the release lane, and
   * which tree it released. Recorded as a fact rather than gated, because the
   * redirection that makes the two agree cannot be active on the release that
   * introduces it.
   */
  build_currency?: BuildCurrencyRecord
}

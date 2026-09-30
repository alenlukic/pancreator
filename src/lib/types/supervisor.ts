import type { TargetRepoPrimerFreshness } from '../validators/target-repo-primer.js'
import type {
  DelegationObservationSource,
  DelegationWatchSummary,
  ForegroundReturnSummary,
} from '../watch.js'
import type { StageOutcome } from './executors.js'
import type { DeterministicResult } from './gates.js'
import type { ArtifactReference, CriterionEvaluation } from './invocation.js'

/**
 * Run-state record of the workspace setup decision for one run.
 *
 * - `passed`: the target-declared setup commands ran in the run's workspace
 *   and succeeded, or the run captured its repository-check baselines before
 *   this record existed, which proves the tree was provisioned
 *   (`inferred_from` names that evidence).
 * - `failed`: a setup command failed and the run paused; the next prepare
 *   runs setup again.
 * - `not_configured`: nothing to run, because no stage of the workflow works
 *   in a provisioned tree or the target declares no setup command.
 */
export interface WorkspaceSetupRecord {
  status: 'passed' | 'failed' | 'not_configured'
  recorded_at: string
  /** Present when the pass was inferred from evidence rather than run. */
  inferred_from?: 'repository_check_baselines' | 'worktree_readiness'
}

/** The policy blocks one supervisor-card re-render changed. */
export interface SupervisorCardPolicyDiff {
  /** Card digest this delta is measured from. */
  previous_sha256: string
  changed: string[]
  added: string[]
  removed: string[]
}

/** Run-state record of the supervisor governance card and its attestation. */
export interface SupervisorCardState {
  path: string
  sha256: string
  rendered_at: string
  /**
   * Optional digests of the per-policy sections rendered into the supervisor
   * governance card. New runs can use these digests as stable pointers from the
   * supervisor procedure document without repeating policy bodies.
   */
  policy_sections?: Array<{ policy_id: string; sha256: string }>
  /**
   * What the last re-render changed, by policy block. A mid-run policy edit
   * invalidates the attestation, and this summary is what the supervisor
   * re-reads instead of the whole card. Absent on a first render and on a
   * render whose digest did not change.
   */
  policy_section_diff?: SupervisorCardPolicyDiff
  /** Digest the supervisor attested to have read, when any. */
  attested_sha256?: string
  /**
   * Per-policy digests as they stood at that attestation. The delta a
   * supervisor owes is measured from what it last read, so a second edit
   * before any re-attestation does not erase the first.
   */
  attested_policy_sections?: Array<{ policy_id: string; sha256: string }>
  attested_at?: string
  /**
   * Counts attestations. Each `/pan-start` and `/pan-resume` attests, so each
   * increment opens one supervisor session. The redline record must carry a
   * declaration for the current generation before prepare or submit proceed.
   */
  session_generation?: number
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
  /**
   * How the harness saw this delegation reach a terminal state: a completed
   * `pan watch` record, a foreground-return attestation, or the external
   * executor's own evidence. It proves DELEGATE-001 was kept by the harness,
   * not asserted. Absent for a supervisor-persona stage with no worker.
   */
  delegation_observation?: {
    source: DelegationObservationSource | null
    watch?: DelegationWatchSummary
    foreground_return?: ForegroundReturnSummary
  }
  next_state: string | null
  timestamp: string
}

export interface RepositoryValidationResult {
  ok: boolean
  errors: string[]
  warnings: string[]
  /**
   * Freshness of `docs/target-repo-primer.md`, in every installation mode
   * that carries one. `PRIMER-001` makes the primer mandatory reading for
   * every agent, so `pan doctor` reports its state wherever the harness runs.
   * The matching `warnings` entry stays self-development-only, because a
   * fresh embedded install must validate with no warnings.
   */
  target_repo_primer?: TargetRepoPrimerFreshness
  report_hash: string
}

/**
 * Status of one supervisor-handoff attempt recorded under a run. `pan handoff`
 * writes the records through the run operation mutex. A transition replaces
 * the attempt's latest record in place, and the run event log keeps the
 * transition history.
 */
export type SupervisorHandoffStatus =
  | 'sending'
  | 'sent'
  | 'aborted'
  | 'accepted'

/** One supervisor-handoff event appended to `supervisor_handoffs` in RunState. */
export interface SupervisorHandoffRecord {
  /** Stable id of this handoff attempt, a UUID. */
  id: string
  status: SupervisorHandoffStatus
  /**
   * Supervisor-card `session_generation` of the handing-off session, or 0
   * when the card has never been attested. The fence compares this against the
   * current generation to decide whether to refuse.
   */
  from_session_generation: number
  /** Prompt sent to the new chat: always `/pan-resume <run-id>`. */
  prompt: string
  /** Model picker label, e.g. `"Claude Opus 5.5"`. */
  model: string
  /** Effort picker label, e.g. `"High"`. */
  effort: string
  /**
   * Verified picker label (`"<model> <effort>"`). The `sending` record carries
   * it from the moment it is written, before Send is pressed.
   */
  verified_label?: string
  /** ISO-8601 timestamp when the `sending` record was written. */
  initiated_at: string
  /** ISO-8601 timestamp when the `sent` status was recorded. */
  sent_at?: string
  /** ISO-8601 timestamp when `aborted` or `accepted` was recorded. */
  resolved_at?: string
  /** Harness-relative path of the handoff note file. */
  note_path?: string
  /** Harness-relative path of the step-evidence JSON. */
  evidence_path?: string
  /** Error code that caused an `aborted` transition. */
  aborted_code?: string
  /** Session generation of the new supervisor session that `accepted`. */
  accepted_session_generation?: number
}

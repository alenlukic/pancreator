import type {
  PersonaExecutorKind,
  StageExecutor,
  StageGate,
  StageOutcome,
  WorkspacePolicy,
} from './executors.js'
import type {
  ContextReference,
  ContextReferenceStatus,
  Policy,
  PolicyDelivery,
  RequirementManifest,
} from './requirements.js'
import type {
  OperatorStageRepairContext,
  PriorAttemptFailure,
  WorkspaceDirectiveRecord,
} from './run-records.js'
import type {
  Criterion,
  CriterionResultValue,
  EvidenceWorkerSkip,
  InvocationScopedReturn,
  JsonTypeName,
  ResolvedOperatorInvolvement,
  ResolvedVerification,
} from './workflow.js'
import type {
  ManagedWorktreeReference,
  WorkspaceSnapshot,
} from './workspace.js'

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

/** Per-file read evidence for one required target instruction file. */
export interface TargetInstructionRead {
  path: string
  /**
   * Verbatim last content line of the file. Skip empty lines and Markdown
   * divider lines.
   */
  final_line: string
}

export interface TargetInstructionEvidence {
  read_paths: string[]
  /**
   * Required alongside `read_paths` on new invocations; absent only on
   * outputs written before per-reference read evidence existed.
   */
  reads?: TargetInstructionRead[]
}

export interface TargetInstructionInput {
  changed_paths: string[]
  read_paths: string[]
}

/**
 * The one marker that a stage is re-entered after a successful remediation
 * (`VERIFY-001`).
 *
 * Presence is the return itself, and it decides the profile allowance the
 * brief states. `blast_radius` is a separate question — how far the repair
 * reached — and it MAY be empty when the remediation declared no changed
 * path. A case whose subject sits outside a non-empty radius observed the
 * same behavior against the same code, so the worker carries its result with
 * a `carried_from` citation instead of executing it again. An empty radius
 * bounds nothing and carries nothing.
 */
export interface RemediationReturn {
  remediation_invocation_id: string
  blast_radius: string[]
  /**
   * Output of the visit whose failing verdict routed the remediation, when
   * one did. A passing visit routed nothing, so it is never named here.
   */
  routing_output_path?: string
  /**
   * The failed release gate that routed the remediation instead of a verdict,
   * with the evidence the return visit confirms repaired.
   */
  routing_gate?: {
    stage: string
    criterion_id: string
    evidence_path: string
  }
}

export interface PrDescriptionContext {
  mode: 'target' | 'fallback'
  template_path: string | null
  instruction_paths: string[]
  heading_order: string[]
  required_headings: string[]
  optional_headings: string[]
  allows_body_title: boolean
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
  /**
   * Verbatim last content line of the selected guidance content. Skip empty
   * lines and Markdown divider lines. Required when status is `read`.
   */
  final_line?: string
  /** Why the read trigger did not apply. Required when status is skipped. */
  reason?: string
  /** Concrete read error. Required when status is reference_failed. */
  error?: string
}

/** What a worker did with one context reference the invocation carried. */
export interface ContextReferenceAttestationEntry {
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
 * Per-section digest echoes are legacy: they re-proved what the contract
 * digest already proves at kilobytes of transcription per attempt, so they
 * are optional and validated only when volunteered. Per-guidance entries are
 * required when the manifest references guidance — but as read evidence
 * (status plus a `final_line` quote the card does not carry), not as digest
 * transcription: the identity fields are prefilled by the scaffold.
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
      context_references?: ContextReferenceAttestationEntry[]
    }
  | {
      invocation_id: string
      model: string
      contract_path: string
      status: 'reference_failed'
      error: string
    }

/**
 * OPERATOR-001: a platform instruction that conflicts with an operator
 * directive, harness governance, or the persona brief, and the authority the
 * agent followed.
 */
export interface PlatformGuidanceConflict {
  guidance: string
  covered_step: string
  authority_followed: string
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
  operator_question?: {
    question: string
    reason: string
    evidence: string[]
  }
  platform_guidance_conflicts?: PlatformGuidanceConflict[]
  workspace_changes?: WorkspaceChangeAttribution
  target_instruction_evidence?: TargetInstructionEvidence
  invocation_attestation?: InvocationAttestation
  data: Record<string, unknown>
}

export interface OperatorArtifactSelection {
  /**
   * `requested` enables artifacts for every stage. `suppressed` enables only
   * the stage slugs listed in requested_stages.
   */
  mode: 'suppressed' | 'requested'
  requested_stages: string[]
}

export type InvocationReferenceRetrieval =
  | 'required'
  | 'conditional'
  | 'index_only'

/** One resolved parallel evidence worker on a prepared invocation. */
/** Declared paths one launch of an evidence role owns. */
export interface EvidenceWorkerAttempt {
  /** Ordinal of the launch, counting from 1. */
  attempt: number
  brief_path: string
  evidence_path: string
  recorded_at: string
}

export interface InvocationEvidenceWorker {
  persona: string
  role: string
  scope: string
  /** Named projected agent to launch, e.g. `pan-reviewer`. */
  agent: string
  model: string
  /** Generated brief the supervisor pastes as the worker's prompt. */
  brief_path: string
  /** Report the worker writes; a required input of the stage worker. */
  evidence_path: string
  /**
   * Every launch of this role, oldest first. A relaunched worker gets its own
   * pair of paths so it writes beside the first report instead of over it.
   * Absent on invocations prepared before attempts were recorded, which read
   * as the single attempt the two fields above declare.
   */
  attempts?: EvidenceWorkerAttempt[]
}

export interface InvocationReference {
  path: string
  description: string
  retrieval?: InvocationReferenceRetrieval
  condition?: string
  /**
   * `current` is true when the evidence matches the invocation workspace
   * fingerprint. The verify validator needs one citation per current entry.
   */
  gate_evidence?: {
    profile: string
    fingerprint: string
    current: boolean
    acceptance_mode?: 'clean_pass' | 'baseline_relative_acceptance' | 'unknown'
    raw_exit_code?: number | null
    preexisting_failure?: boolean
  }
}

export interface SuiteProfileEntry {
  file: string
  name?: string
  duration_ms: number
  test_count?: number
}

export interface SuiteProfileDelta {
  run_id: string
  profile_path: string
  test_count: number
  wall_clock_ms: number
  test_count_delta: number
  wall_clock_ms_delta: number
}

/** Rendered on the ship card and in `pan status`. Advisory only. */
export interface SuiteProfileSummary {
  profile_path: string
  gate_id: string
  stage: string
  cached: boolean
  lane: string
  test_count: number
  pass_count: number
  fail_count: number
  wall_clock_ms: number
  slowest_files: SuiteProfileEntry[]
  slowest_tests: SuiteProfileEntry[]
  previous?: SuiteProfileDelta
}

export interface FastWallStagePoint {
  recorded_at: string
  wall_clock_ms: number
  test_count: number
  worker_count: number
  /** The run phase that produced the record: `baseline`, a gate id, or `agent`. */
  phase: string
  /** This run's own marginal wall per test. Null on a record with no summed file time. */
  marginal_wall_ms_per_test: number | null
}

export interface FastWallStageSummary {
  series_path: string
  before: FastWallStagePoint | null
  after: FastWallStagePoint | null
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
  /** Installation topology captured so rendered execution roots stay exact. */
  installation_mode?: 'self_development' | 'embedded' | 'detached'
  /** Managed worktree identity bound to this run, when selected at init. */
  managed_worktree?: ManagedWorktreeReference
  /** Absolute harness root. Present when the workspace is not the harness checkout, so an external worker resolves harness-relative paths. */
  harness_root?: string
  gate_overrides?: Record<string, string | false>
  operator_involvement?: ResolvedOperatorInvolvement
  verification?: ResolvedVerification
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
  /**
   * Why this attempt exists when the operator moved the run here. Present
   * instead of `prior_failure` whenever the repair note is newer than any
   * recorded attempt of this stage.
   */
  operator_stage_repair?: OperatorStageRepairContext
  inputs: {
    references: InvocationReference[]
    missing_required?: string[]
    /**
     * Present whenever this stage is re-entered after a successful
     * remediation, whatever that remediation's blast radius was. Absent on a
     * first visit.
     */
    remediation_return?: RemediationReturn
    target_instructions?: TargetInstructionInput
    pr_description?: PrDescriptionContext
    /**
     * Wider context this run reads by reference. `reference_status` is
     * computed at preparation, so a drifted or missing source is stated on the
     * card instead of discovered by the worker.
     */
    context_reference?: ContextReference & {
      reference_status: ContextReferenceStatus
      /**
       * Digest of the source as it stands on disk at preparation. Present only
       * when the source drifted, so the card and the submission check can
       * name both digests instead of one.
       */
      actual_content_sha256?: string
    }
  }
  /**
   * Parallel evidence workers resolved for this attempt. The supervisor
   * launches every listed agent top-level and in parallel, awaits all of
   * them, and confirms each evidence report exists before delivering the
   * stage worker's own card. Submission rejects the stage output while an
   * evidence report is missing.
   */
  evidence_workers?: InvocationEvidenceWorker[]
  /** Declared evidence workers whose `run_when` kept them off this visit. */
  evidence_worker_skips?: EvidenceWorkerSkip[]
  /**
   * Present on a scoped return visit: no evidence worker runs, and the stage
   * worker records every listed dimension in its own output.
   */
  scoped_return?: InvocationScopedReturn
  /**
   * Advisory suite profile section data, present when the stage context asks
   * for it and the run recorded a profile. Never a gate.
   */
  suite_profile?: SuiteProfileSummary
  /** Fast-lane measurements bracketing this run's implementation stage. */
  fast_wall?: FastWallStageSummary
  policies: Policy[]
  /**
   * Delivery mode of each policy on the worker card, keyed by policy id.
   * Absent on cards prepared before pointer delivery existed, which inline
   * every policy.
   */
  policy_delivery?: Record<string, PolicyDelivery>
  requirements?: RequirementManifest
  rubric: Criterion[]
  output: {
    path: string
    template: string
    schema: string
    required_data: Record<string, JsonTypeName>
    /**
     * Exact `pan output scaffold` command for this invocation. It names the
     * invocation JSON snapshot — the only artifact the command accepts — so a
     * worker never has to guess between the snapshot and the Markdown
     * contract. Absent on legacy invocations and supervisor-owned stages.
     */
    scaffold_command?: string
    artifacts?: ArtifactReference[]
    artifact_targets?: Record<string, string>
    field_contract?: {
      criterion_results?: Record<string, string>
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
    operator_brief?: {
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
  /**
   * Workspace changes an operator directive already attributed. A worker
   * reads these instead of auditing a delta no stage claims.
   */
  attributed_changes?: WorkspaceDirectiveRecord[]
  workspace_before: WorkspaceSnapshot
  /**
   * The harness root as it stood when this invocation was prepared, recorded
   * only when the run's workspace is a different directory. The one place a
   * run may not write is the only place the workspace snapshot cannot see, so
   * the scope gate compares this baseline against the harness root at submit.
   */
  harness_before?: WorkspaceSnapshot
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
  /**
   * Supervisor-only procedure document beside the card. It owns the resolved
   * delivery steps and every workflow lifecycle command, so the worker-visible
   * contract never carries one. Absent on legacy invocations, whose cards
   * inline the full procedure.
   */
  supervisor_procedure_path?: string
  submit_command: string
  /**
   * The resolved `pan output validate` command, with the run id, the output
   * file, and the invocation snapshot. The supervisor otherwise rebuilds a
   * three-argument shape from memory and discovers it by trial.
   */
  output_validate_command?: string
  /**
   * `pan watch <run-id> --invocation <id>` for a `cursor`-executor
   * delegation. With `--foreground-returned` it records the attestation
   * `pan submit` requires; awaited, it is the DELEGATE-001 timer. Absent on
   * external-executor and legacy invocations.
   */
  watch_command?: string
  /**
   * The run's platform-guidance redline record. The procedure document names
   * it at the launch step, where the platform's "do not wait for it" text
   * arrives, rather than leaving the supervisor to recall a declaration made
   * before the run began.
   */
  redline_record_path?: string
  /** Absent on legacy invocations, which the harness treats as `verbatim`. */
  mode?: InvocationDeliveryMode
  /** The exact prompt body the supervisor delivers under `referenced` mode. */
  delivery_prompt_path?: string
  policies: Policy[]
  /**
   * The run's supervisor governance card at prepare time. The procedure
   * document prints it so the supervisor holds its complete policy set, not
   * only the delivery policy inlined in `policies`.
   */
  supervisor_card?: {
    path: string
    sha256: string
    attest_command: string
    /** Optional per-policy section digests rendered into the card. */
    policy_sections?: Array<{ policy_id: string; sha256: string }>
  }
}

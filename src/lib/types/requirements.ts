import type { RunContract } from './workflow.js'

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

/**
 * One test a run request declares as already failing.
 *
 * Identity is a file plus exactly one case, never a file alone: a file-wide
 * declaration would credit the regression the gate exists to catch. The reason
 * is required so a later reader can retire the declaration.
 */
export interface KnownFailingTest {
  file: string
  case: string
  reason: string
}

/**
 * An audited pointer to a document a run must read but never copies. It shares
 * the guidance-reference shape and digest basis, so a card can print it in the
 * same block and a stage output can attest it the same way. Cohort fan-out uses
 * it to hand every child run the same parent specification.
 */
export interface ContextReference {
  source_path: string
  content_sha256: string
  line_count: number
  byte_length: number
  /** Imperative condition that tells the reader when to open the source. */
  read_trigger: string
}

export type ContextReferenceStatus = 'current' | 'drifted' | 'missing'

export interface PrDescriptionAuthority {
  template_path?: string
  instruction_paths?: string[]
}

export interface PolicyArtifactAuthority {
  pr_description?: PrDescriptionAuthority
}

export type PolicyAudience = 'agent' | 'supervisor' | 'harness' | 'operator'

export interface PolicyInstruction {
  text: string
  audience: PolicyAudience[]
  /**
   * Keep this instruction on a card that delivers its policy as a pointer to
   * a projected always-apply rule. Marks a clause a worker has to meet on
   * the card itself, beside the rule.
   */
  excerpt?: boolean
}

/**
 * How one policy reaches a worker card. `pointer` names the projected
 * always-apply Cursor rule that carries the policy text and the digest of
 * the agent-audience section the pointer stands for.
 */
export type PolicyDelivery =
  | { mode: 'inline' }
  | { mode: 'pointer'; target: string; sha256: string }

export interface Policy {
  id: string
  title: string
  severity: 'hard' | 'soft'
  summary: string
  instructions: PolicyInstruction[]
  extension_id?: string
  /** Names the target that authored this policy. Absent on harness policies. */
  target_extension?: string
  artifact_authority?: PolicyArtifactAuthority
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
  /**
   * The target exists but carries nothing this validator judges, so the
   * validator states that rather than failing every field the target never
   * owed. A not-applicable result satisfies its requirement.
   */
  | 'not_applicable'

export interface RequirementIssue {
  code: string
  message: string
  pointer?: string
  line?: number
}

export interface RequirementComparisonBase {
  source: 'invocation.workspace_before' | 'workspace.cumulative_diff'
  workspace_root: string
  fingerprint?: string
  invocation_path?: string
  run_id?: string
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
  comparison_base?: RequirementComparisonBase
}

export interface PolicyLookupRow {
  persona: string
  workflow: string
  stage: string
  installation_scope?: 'all' | 'self_development'
  technology?: string
  /**
   * Optional marker for rows generated by a specific automation. Self-development
   * resolution may skip these rows to avoid leaking target-only guidance onto
   * self-development cards.
   */
  generated_by?: string
  /**
   * Activates the row only for runs abiding by this contract. Keeps run
   * contracts inside the single policy applicability map instead of a second
   * one that could drift from it, as CONTRACT-001 requires.
   */
  contract?: RunContract
  /**
   * Activates the row only when the invocation requests operator artifacts.
   * An absent context retains standalone and historical behavior.
   */
  operator_artifacts?: 'requested' | 'suppressed'
  /**
   * Activates the row only for the run mode derived from its snapshotted
   * contracts. An absent value applies in either mode.
   */
  long_horizon?: boolean
  policies: string[]
}

export interface PolicyLookupTable {
  schema_version: 1
  rows: PolicyLookupRow[]
}

/**
 * Every refusal a stage-output validator can raise, and the declared field
 * each one blocks on.
 *
 * A worker learns a required shape from its rendered card, not from the
 * refusal it gets for breaking it. That only holds while the fields a
 * validator blocks on are the fields its stage contract declares, and the two
 * were separately maintained until the completeness proof below existed: the
 * verify handler shipped three fields short of its declaration, the ship
 * declaration named two of the thirty-three fields the release handler
 * refuses on, and the claims handler refused implement and remediate workers
 * on acceptance ids the contract never mentioned. Each round repaired the one
 * validator a verifier had named, so the next round found the next one.
 *
 * This module closes that by enumerating every validator the shared field
 * contract binds to a stage, rather than the one currently under review.
 * `tests/integration/validators-stage-validators.test.ts` reads each
 * handler's own source, and fails when a handler raises a refusal this
 * declaration does not carry or blocks on a path the stage contract does not
 * declare. A new refusal therefore fails a test rather than a worker.
 */

/** One refusal a stage validator can raise, and what it blocks on. */
export interface StageRefusal {
  /**
   * Stable issue code, or the `issue()` argument expression as the handler
   * spells it when the handler composes the code at runtime.
   */
  code: string
  /** Declared field paths the refusal blocks on. */
  paths: readonly string[]
  /** Required when `paths` is empty: why no declared field owns the rule. */
  unowned_reason?: string
  /** Set when `code` is a composed expression rather than a literal. */
  composed?: boolean
}

/** Where one validator raises its refusals. */
export interface RefusalSource {
  /** Repository-relative module path. */
  file: string
  /** Top-level functions in that module which raise the refusals. */
  functions: readonly string[]
}

/**
 * An `issue()` argument a handler passes through from a rule table, and the
 * codes that table can produce. The completeness proof expands the
 * expression to those codes, so a pass-through does not hide a refusal.
 */
export interface GeneratedRefusalCodes {
  expression: string
  codes: readonly string[]
}

/** One validator's complete refusal set for one stage. */
export interface StageValidatorRefusals {
  /** Validation-registry id that owns the refusals. */
  registry_id: string
  /**
   * Key of the shared field contract entry, or `null` when no entry binds the
   * validator. A validator with no entry has nowhere to declare a field, so
   * every one of its refusals MUST be unowned.
   *
   * The key is the stage slug, except where two workflows share one slug and
   * a different validator owns each. `intake` is the one such slug, so the
   * prototype entry is `prototype:intake` and the design intake keeps the
   * bare slug free.
   */
  stage: string | null
  sources: readonly RefusalSource[]
  refusals: readonly StageRefusal[]
  /** Rule-table pass-throughs the handler raises instead of a literal. */
  generated?: readonly GeneratedRefusalCodes[]
}

/** The blocking fields one registry owns within one stage. */
export interface ValidatorBlockingFields {
  stage: string
  registry_id: string
  fields: readonly string[]
}

const STAGE_VALIDATORS_MODULE = 'src/lib/validators/stage-validators.ts'
const PROTOTYPE_MODULE = 'src/lib/validators/prototype-output.ts'
const PR_DESCRIPTION_MODULE = 'src/lib/validators/pr-description.ts'

/**
 * Raised by the shared `gitUnavailableIssue` helper, which four handlers
 * reach. Every validator that can reach it declares it.
 */
const GIT_UNAVAILABLE: StageRefusal = {
  code: 'git.unavailable',
  paths: [],
  unowned_reason:
    'The workspace diff could not be read, which is an environment failure rather than a field requirement.',
}

/**
 * Refusals `validateImplementationClaims` can raise. The handler serves the
 * implement and remediate stages from one pass, so both stages declare the
 * same set.
 */
export const CLAIMS_REFUSALS: readonly StageRefusal[] = [
  {
    code: 'output.shape',
    paths: [],
    unowned_reason:
      'The stage output is not an object, so no field inside it exists to declare.',
  },
  { code: 'blocked.missing', paths: ['data.blocked'] },
  {
    code: 'blocked.shape',
    paths: [
      'data.blocked.missing_precondition',
      'data.blocked.supplying_command',
    ],
  },
  {
    code: 'blocked.acceptance_results',
    paths: [],
    unowned_reason:
      'A blocked result requires the acceptance collection to stay empty, so the refusal is the inverse of a field requirement.',
  },
  {
    code: 'blocked.implementation_forbidden',
    paths: [],
    unowned_reason:
      'A blocked output MUST NOT carry data.implementation, so the refusal is the inverse of a field requirement.',
  },
  { code: 'blocked.evidence', paths: ['data.blocked.evidence[]'] },
  {
    code: 'blocked.diff_not_disclosed',
    paths: [],
    unowned_reason:
      'The refusal relates this attempt Git delta to top-level workspace_changes.paths, which is not a data field of the output.',
  },
  { code: 'implementation.missing', paths: ['data.implementation'] },
  {
    code: 'implementation.remediation_missing',
    paths: ['data.implementation.remediation[]'],
  },
  {
    code: 'implementation.remediation_shape',
    paths: [
      'data.implementation.remediation[]',
      'data.implementation.remediation[].cause',
      'data.implementation.remediation[].action',
      'data.implementation.remediation[].evidence[]',
    ],
  },
  {
    code: 'claim.entry_shape',
    paths: [
      'data.implementation.changed_files[]',
      'data.implementation.tests_added[]',
    ],
  },
  {
    code: 'claim.attribution_not_disclosed',
    paths: ['data.implementation.changed_files[]'],
  },
  GIT_UNAVAILABLE,
  {
    code: 'claim.not_in_diff',
    paths: [],
    unowned_reason:
      'The refusal relates a declared entry to the workspace diff.',
  },
  {
    code: 'claim.diff_not_disclosed',
    paths: [],
    unowned_reason:
      'The refusal covers a workspace change the collection never reports, which is a relation over the collection.',
  },
  {
    code: 'claim.file_missing',
    paths: [],
    unowned_reason:
      'The file a declared path names does not exist, which is a relation to the filesystem.',
  },
  {
    code: 'claim.modified_after_output',
    paths: [],
    unowned_reason:
      'The refusal relates the modification time of a claimed path to the time the output was written.',
  },
  { code: 'acceptance.missing', paths: ['data.acceptance_results[]'] },
  { code: 'acceptance.shape', paths: ['data.acceptance_results[].id'] },
  {
    code: 'acceptance.duplicate',
    paths: [],
    unowned_reason:
      'Uniqueness is a relation between items rather than a requirement on one item.',
  },
  { code: 'acceptance.result', paths: ['data.acceptance_results[].result'] },
  {
    code: 'acceptance.evidence',
    paths: ['data.acceptance_results[].evidence[]'],
  },
  {
    code: 'acceptance.evidence_shape',
    paths: ['data.acceptance_results[].evidence[]'],
  },
  {
    code: 'acceptance.coverage',
    paths: [],
    unowned_reason:
      'The refusal compares reported ids against the ratified plan, which is a relation to another document.',
  },
  {
    code: 'acceptance.unknown',
    paths: [],
    unowned_reason:
      'The refusal compares reported ids against the ratified plan, which is a relation to another document.',
  },
  {
    code: 'claim.test_missing',
    paths: [],
    unowned_reason:
      'The test file a declared entry names does not exist, which is a relation to the filesystem.',
  },
  {
    code: 'implementation.tests_added_contract_missing',
    paths: [
      'data.implementation.tests_added[]',
      'data.implementation.tests_added[].path',
      'data.implementation.tests_added[].contract',
    ],
  },
]

/**
 * Refusals `validatePlanTrace` can raise, including the composed
 * verification-recommendation code the shared helper builds. That helper also
 * serves the intake handler, so the same expression raises
 * `intake.verification_recommendation` there.
 */
export const PLAN_REFUSALS: readonly StageRefusal[] = [
  { code: 'plan.criterion_id', paths: ['data.acceptance_criteria[].id'] },
  {
    code: 'plan.verification_missing',
    paths: [
      'data.acceptance_criteria[].verification',
      'data.acceptance_criteria[].verification.method',
    ],
  },
  {
    code: 'plan.verification_expected',
    paths: ['data.acceptance_criteria[].verification.expected'],
  },
  {
    code: 'plan.maps_to_missing',
    paths: ['data.acceptance_criteria[].maps_to'],
  },
  {
    code: 'plan.maps_to_mismatch',
    paths: ['data.acceptance_criteria[].maps_to'],
  },
  {
    code: 'plan.maps_to_unknown',
    paths: ['data.acceptance_criteria[].maps_to'],
  },
  {
    code: 'plan.orphan_story',
    paths: [],
    unowned_reason:
      'The refusal covers a ratified user story no criterion reports, which is a relation to another document.',
  },
  {
    code: 'plan.story_trace_missing',
    paths: [],
    unowned_reason:
      'The refusal reads the collection as a whole for at least one story mapping rather than requiring a field of one item.',
  },
  {
    code: 'plan.file_required',
    paths: [
      'data.engineering_plan.files[]',
      'data.engineering_plan.files[].path',
      'data.engineering_plan.files[].status',
      'data.engineering_plan.files[].purpose',
    ],
  },
  {
    code: 'plan.file_status',
    paths: ['data.engineering_plan.files[].status'],
  },
  {
    code: 'plan.file_missing',
    paths: [],
    unowned_reason:
      'The file a declared path names does not exist, which is a relation to the filesystem.',
  },
  { code: 'plan.case_reruns_profile', paths: ['data.test_plan[]'] },
  { code: 'plan.case_invalid_pan_invocation', paths: ['data.test_plan[]'] },
  {
    code: 'plan.criterion_unproducible',
    paths: [
      'data.acceptance_criteria[].verification.method',
      'data.acceptance_criteria[].verification.expected',
    ],
  },
  {
    code: 'plan.disposition_missing',
    paths: ['data.open_question_dispositions[].id'],
  },
  {
    code: 'plan.disposition_shape',
    paths: ['data.open_question_dispositions[].id'],
  },
  {
    code: 'plan.disposition_duplicate',
    paths: [],
    unowned_reason:
      'Uniqueness is a relation between items rather than a requirement on one item.',
  },
  {
    code: 'plan.disposition_value',
    paths: ['data.open_question_dispositions[].disposition'],
  },
  {
    code: 'plan.disposition_answer',
    paths: ['data.open_question_dispositions[].answer'],
  },
  {
    code: 'plan.disposition_evidence',
    paths: ['data.open_question_dispositions[].evidence'],
  },
  {
    code: 'plan.disposition_unknown',
    paths: [],
    unowned_reason:
      'The refusal compares reported question ids against the ratified specification, which is a relation to another document.',
  },
  {
    code: 'plan.criterion_assumes_answer',
    paths: [],
    unowned_reason:
      'The refusal relates a criterion mapping to the disposition the same output recorded.',
  },
  {
    code: '`${stage}.verification_recommendation`',
    composed: true,
    paths: [
      'data.verification_recommendation',
      'data.verification_recommendation.level',
      'data.verification_recommendation.reason',
    ],
  },
]

/**
 * Refusals `validateReleaseOutput` can raise.
 *
 * The release handler is one imperative pass rather than a rule table, so
 * this list cannot be generated from its branches the way the verify list is.
 * The completeness test reads the handler source instead.
 */
export const RELEASE_REFUSALS: readonly StageRefusal[] = [
  {
    code: 'release.missing',
    paths: [],
    unowned_reason:
      'The whole `data.release` object is absent, so no field inside it exists to declare.',
  },
  {
    code: 'release.local_release_missing',
    paths: [
      'data.release.local_release',
      'data.release.local_release.release_commit',
      'data.release.local_release.index_commit',
      'data.release.local_release.fetched_main',
      'data.release.local_release.branch',
      'data.release.local_release.pr_description_path',
    ],
  },
  {
    code: 'release.commit_order',
    paths: [],
    unowned_reason:
      'The refusal relates the declared commits to the workspace Git history rather than requiring another field.',
  },
  {
    code: 'release.fetched_main_not_ancestor',
    paths: [],
    unowned_reason:
      'Ancestry is a relation in the workspace Git history rather than a requirement on a field.',
  },
  {
    code: 'release.worktree_dirty',
    paths: [],
    unowned_reason:
      'The refusal reads the state of the workspace rather than a field of the output.',
  },
  {
    code: 'release.branch_mismatch',
    paths: [],
    unowned_reason:
      'The refusal compares a declared field against the checked-out branch, which is a relation to the workspace.',
  },
  {
    code: 'release.index_commit_scope',
    paths: [],
    unowned_reason:
      'The refusal reads the contents of a commit rather than requiring another field.',
  },
  {
    code: 'release.pr_description_path_invalid',
    paths: ['data.release.local_release.pr_description_path'],
  },
  {
    code: 'release.pr_description_missing',
    paths: [],
    unowned_reason:
      'The file the declared path names does not exist, which is a relation to the filesystem.',
  },
  {
    code: 'release.pr_commit_range_missing',
    paths: [],
    unowned_reason:
      'The refusal reads the content of the referenced PR description rather than a field of the output.',
  },
  {
    code: 'release.versioning_missing',
    paths: ['data.release.versioning'],
  },
  {
    code: 'release.current_version',
    paths: ['data.release.versioning.current_version'],
  },
  {
    code: 'release.proposed_version',
    paths: ['data.release.versioning.proposed_version'],
  },
  {
    code: 'release.recommendation',
    paths: ['data.release.versioning.recommendation'],
  },
  {
    code: 'release.proposed_version_mismatch',
    paths: [],
    unowned_reason:
      'The refusal relates the proposed version to the current version and the recommendation.',
  },
  {
    code: 'release.baseline_commit',
    paths: ['data.release.versioning.baseline_commit'],
  },
  {
    code: 'release.committed_version_unavailable',
    paths: [],
    unowned_reason:
      'The refusal reads the VERSION file of a commit rather than a field of the output.',
  },
  {
    code: 'release.current_version_mismatch',
    paths: [],
    unowned_reason:
      'The refusal relates a declared version to the committed VERSION value.',
  },
  {
    code: 'release.baseline_version_mismatch',
    paths: [],
    unowned_reason:
      'The refusal relates the baseline commit to the VERSION value it carries.',
  },
  {
    code: 'release.baseline_not_ancestor',
    paths: [],
    unowned_reason:
      'Ancestry is a relation in the workspace Git history rather than a requirement on a field.',
  },
  {
    code: 'release.baseline_not_bump',
    paths: [],
    unowned_reason:
      "The refusal relates the baseline commit to its parent's VERSION value.",
  },
  {
    code: 'release.rationale_missing',
    paths: ['data.release.versioning.rationale'],
  },
  {
    code: 'release.compatibility_missing',
    paths: ['data.release.versioning.compatibility'],
  },
  {
    code: 'release.index_action_missing',
    paths: ['data.release.versioning.release_index_action'],
  },
  {
    code: 'release.updated_files_invalid',
    paths: ['data.release.versioning.updated_files[]'],
  },
  {
    code: 'release.updated_file_out_of_scope',
    paths: ['data.release.versioning.updated_files[]'],
  },
  {
    code: 'release.updated_file_missing',
    paths: ['data.release.versioning.updated_files[]'],
  },
  {
    code: 'release.version_not_applied',
    paths: [],
    unowned_reason:
      'The refusal relates a declared field to the VERSION file on disk.',
  },
  {
    code: 'release.index_mapping',
    paths: [],
    unowned_reason:
      'The refusal relates declared fields to release/index.json.',
  },
  {
    code: 'release.metadata_invalid',
    paths: [],
    unowned_reason:
      'The refusal reports repository release metadata errors rather than a field of the output.',
  },
  {
    code: 'release.change_list_shape',
    paths: [
      'data.release.change_list[]',
      'data.release.change_list[].path',
      'data.release.change_list[].kind',
      'data.release.change_list[].description',
    ],
  },
  {
    code: 'release.change_list',
    paths: ['data.release.change_list[]'],
  },
  {
    code: 'release.change_not_in_diff',
    paths: [],
    unowned_reason:
      'The refusal relates a declared entry to the workspace diff.',
  },
  {
    code: 'release.diff_not_disclosed',
    paths: [],
    unowned_reason:
      'The refusal covers a workspace change the collection never reports, which is a relation over the collection.',
  },
  {
    code: 'release.rollback',
    paths: ['data.release.rollback_plan'],
  },
  {
    code: 'release.rollback_command_invalid',
    paths: [],
    unowned_reason:
      'The refusal reads the content of a declared field rather than requiring another field.',
  },
  {
    code: 'release.governance_review_missing',
    paths: ['data.release.governance_artifact_review'],
  },
  {
    code: 'release.governance_review_summary',
    paths: ['data.release.governance_artifact_review.summary'],
  },
  {
    code: 'release.governance_issue_undisposed',
    paths: ['data.release.governance_artifact_review.issues_reviewed[]'],
  },
  {
    code: 'release.validation_shape',
    paths: ['data.release.validation[]'],
  },
  {
    code: 'release.validation_fingerprint',
    paths: ['data.release.validation[].workspace_fingerprint'],
  },
  {
    code: 'release.validation_fingerprint_unknown',
    paths: [],
    unowned_reason:
      'The refusal relates a declared fingerprint to the run stage history and waivers.',
  },
  {
    code: 'release.validation_evidence_missing',
    paths: ['data.release.validation[].evidence_path'],
  },
  {
    code: 'release.deferred_undisclosed',
    paths: ['data.release.deferred_acceptance_criteria[]'],
  },
  {
    code: 'release.follow_up_shape',
    paths: [
      'data.release.follow_up_cases[]',
      'data.release.follow_up_cases[].id',
    ],
  },
  {
    code: 'release.follow_up_evidence',
    paths: ['data.release.follow_up_cases[].evidence[]'],
  },
  {
    code: 'release.evidence_missing',
    paths: ['data.release.follow_up_cases[].evidence[]'],
  },
  {
    code: 'release.waiver_undisclosed',
    paths: [
      'data.release.disclosed_waivers[]',
      'data.release.disclosed_waivers[].waiver_id',
    ],
  },
  {
    code: 'release.waiver_fingerprint',
    paths: ['data.release.disclosed_waivers[].workspace_fingerprint'],
  },
  {
    code: 'release.waiver_fingerprint_mismatch',
    paths: [],
    unowned_reason:
      'The refusal relates a declared fingerprint to the run-state waiver record.',
  },
  {
    code: 'release.waiver_evidence_missing',
    paths: [],
    unowned_reason:
      'The evidence paths come from the run-state waiver record rather than from the output.',
  },
  GIT_UNAVAILABLE,
]

/**
 * Refusals `validatePrDescription` can raise. Its target is the PR
 * description Markdown document rather than the ship stage output, so no
 * stage-output field owns any of them. The output field that names the
 * document, `data.release.local_release.pr_description_path`, is declared and
 * enforced by `RELEASE-VALIDATE-001`.
 */
export const PR_DESCRIPTION_REFUSALS: readonly StageRefusal[] = [
  {
    code: 'pr.context_missing',
    paths: [],
    unowned_reason:
      'The refusal reports an unresolvable PR description context, which is a relation to run state rather than a field of the output.',
  },
  {
    code: 'pr.file_missing',
    paths: [],
    unowned_reason:
      'The document the ship output names does not exist, which is a relation to the filesystem.',
  },
  {
    code: 'pr.title_invalid',
    paths: [],
    unowned_reason:
      'The refusal reads the PR description Markdown document rather than a field of the stage output.',
  },
  {
    code: 'pr.title_forbidden',
    paths: [],
    unowned_reason:
      'The refusal reads the PR description Markdown document rather than a field of the stage output.',
  },
  {
    code: 'pr.heading_unexpected',
    paths: [],
    unowned_reason:
      'The refusal reads the PR description Markdown document rather than a field of the stage output.',
  },
  {
    code: 'pr.heading_missing',
    paths: [],
    unowned_reason:
      'The refusal reads the PR description Markdown document rather than a field of the stage output.',
  },
  {
    code: 'pr.section_empty',
    paths: [],
    unowned_reason:
      'The refusal reads the PR description Markdown document rather than a field of the stage output.',
  },
  {
    code: 'pr.heading_order',
    paths: [],
    unowned_reason:
      'The refusal reads the PR description Markdown document rather than a field of the stage output.',
  },
]

/** Raised by the prototype dispatcher before it reaches a stage handler. */
const PROTOTYPE_SHAPE: StageRefusal = {
  code: 'prototype.shape',
  paths: [],
  unowned_reason:
    'The stage output is not an object, so no field inside it exists to declare.',
}

/**
 * Refusals `validatePrototypeOutput` can raise for the prototype intake
 * stage.
 *
 * The handler raises one code from three branches — a missing id, missing
 * question text, and a repeated id — so the declaration carries the code once
 * and names both item fields the three branches block on.
 */
export const PROTOTYPE_INTAKE_REFUSALS: readonly StageRefusal[] = [
  PROTOTYPE_SHAPE,
  {
    code: 'prototype.question_id',
    paths: [
      'data.prototype_brief.technical_questions[].id',
      'data.prototype_brief.technical_questions[].question',
    ],
  },
]

/**
 * Refusals `validatePrototypeOutput` can raise for the approach stage.
 *
 * `validatePreconditionEntry` composes its codes from the collection position
 * it is checking, so the declaration carries the expression the handler
 * spells rather than one code per array index.
 */
export const APPROACH_REFUSALS: readonly StageRefusal[] = [
  PROTOTYPE_SHAPE,
  { code: 'prototype.approach_missing', paths: ['data.technical_approach'] },
  {
    code: 'prototype.preconditions_missing',
    paths: ['data.technical_approach.preconditions[]'],
  },
  {
    code: '`${prefix}.shape`',
    composed: true,
    paths: ['data.technical_approach.preconditions[]'],
  },
  {
    code: '`${prefix}.${field}`',
    composed: true,
    paths: [
      'data.technical_approach.preconditions[].id',
      'data.technical_approach.preconditions[].affected_questions[]',
      'data.technical_approach.preconditions[].check',
      'data.technical_approach.preconditions[].evidence[]',
    ],
  },
  {
    code: '`${prefix}.volatile`',
    composed: true,
    paths: ['data.technical_approach.preconditions[].volatile'],
  },
  {
    code: '`${prefix}.status`',
    composed: true,
    paths: ['data.technical_approach.preconditions[].status'],
  },
  {
    code: '`${prefix}.exclusions`',
    composed: true,
    paths: ['data.technical_approach.preconditions[].exclusions[]'],
  },
  {
    code: 'prototype.exclusion_authority',
    paths: [],
    unowned_reason:
      "The refusal relates a declared exclusion to the run's operator-decision ledger.",
  },
  {
    code: 'prototype.approach_blocked',
    paths: [],
    unowned_reason:
      'The refusal relates the declared result to the status of the preconditions.',
  },
]

/** Refusals `validatePrototypeOutput` can raise for the build stage. */
export const BUILD_REFUSALS: readonly StageRefusal[] = [
  PROTOTYPE_SHAPE,
  { code: 'prototype.spike_missing', paths: ['data.spike'] },
  {
    code: 'prototype.precondition_checks_shape',
    paths: ['data.spike.precondition_checks[]'],
  },
  {
    code: 'prototype.approach_unresolved',
    paths: [],
    unowned_reason:
      'The refusal relates build success to the readability of the approach stage output.',
  },
  {
    code: 'prototype.precondition_checks_missing',
    paths: ['data.spike.precondition_checks[]'],
  },
  {
    code: 'prototype.precondition_check_shape',
    paths: ['data.spike.precondition_checks[]'],
  },
  {
    code: 'prototype.precondition_check_id',
    paths: ['data.spike.precondition_checks[].precondition_id'],
  },
  {
    code: 'prototype.precondition_check_status',
    paths: ['data.spike.precondition_checks[].status'],
  },
  {
    code: 'prototype.precondition_check_evidence',
    paths: ['data.spike.precondition_checks[].evidence[]'],
  },
  {
    code: 'prototype.blocked_changed_files',
    paths: [],
    unowned_reason:
      'A build blocked by an unavailable precondition MUST leave the collection empty, so the refusal is the inverse of a field requirement.',
  },
  {
    code: 'prototype.volatile_check_missing',
    paths: [],
    unowned_reason:
      'The refusal relates the recorded checks to the volatile preconditions of the approach output.',
  },
  {
    code: 'prototype.volatile_check_unready',
    paths: [],
    unowned_reason:
      'The refusal relates a recorded check status to the declared changed files.',
  },
]

/** Refusals `validatePrototypeOutput` can raise for the evaluate stage. */
export const EVALUATE_REFUSALS: readonly StageRefusal[] = [
  PROTOTYPE_SHAPE,
  { code: 'prototype.evaluation_missing', paths: ['data.evaluation'] },
  {
    code: 'prototype.environment_blockers',
    paths: ['data.evaluation.environment_blockers[]'],
  },
  { code: 'prototype.verdict', paths: ['data.evaluation.verdict'] },
  {
    code: 'prototype.environment_blockers_empty',
    paths: [],
    unowned_reason:
      'The refusal relates the declared verdict to the size of the collection.',
  },
  {
    code: 'prototype.question_results',
    paths: ['data.evaluation.question_results[]'],
  },
  {
    code: 'prototype.environment_blocker_shape',
    paths: ['data.evaluation.environment_blockers[]'],
  },
  {
    code: 'prototype.environment_blocker_description',
    paths: ['data.evaluation.environment_blockers[].description'],
  },
  {
    code: 'prototype.environment_blocker_evidence',
    paths: ['data.evaluation.environment_blockers[].evidence[]'],
  },
  {
    code: 'prototype.environment_blocker_questions',
    paths: ['data.evaluation.environment_blockers[].affected_questions[]'],
  },
  {
    code: 'prototype.question_result_shape',
    paths: ['data.evaluation.question_results[]'],
  },
  {
    code: 'prototype.question_result_field',
    paths: [
      'data.evaluation.question_results[].question_id',
      'data.evaluation.question_results[].result',
      'data.evaluation.question_results[].cause',
    ],
  },
  {
    code: 'prototype.question_result_cause',
    paths: ['data.evaluation.question_results[].cause'],
  },
  {
    code: 'prototype.discard_condition_met',
    paths: ['data.evaluation.question_results[].discard_condition_met'],
  },
  {
    code: 'prototype.question_result_evidence',
    paths: ['data.evaluation.question_results[].evidence[]'],
  },
  {
    code: 'prototype.readiness_question',
    paths: ['data.evaluation.question_results[].readiness_question'],
  },
  {
    code: 'prototype.readiness_claim',
    paths: [],
    unowned_reason:
      'The refusal relates a question result cause to an environment blocker that names the same question.',
  },
  {
    code: 'prototype.verdict_precedence',
    paths: [],
    unowned_reason:
      'The refusal relates the declared verdict to a met product discard condition.',
  },
  {
    code: 'prototype.question_coverage',
    paths: [],
    unowned_reason:
      'The refusal compares reported question ids against the declared technical questions, which is a relation to another document.',
  },
]

/**
 * Refusals `validateTargetInstructionCoverage` can raise. It gates every
 * stage output, and no stage entry of the shared field contract binds it,
 * because the fields it blocks on sit at the top level of the output rather
 * than under `data`. `GLOBAL-002` states that obligation on the worker's own
 * card, which is what the declaration rule exists to guarantee.
 */
export const TARGET_INSTRUCTION_REFUSALS: readonly StageRefusal[] = [
  {
    code: 'TARGET_INSTRUCTION_COVERAGE_MISSING',
    paths: [],
    unowned_reason:
      'The refusal blocks on top-level target_instruction_evidence.read_paths, which GLOBAL-002 states on the worker card and which the shared stage contract does not reach because it declares data fields only.',
  },
  {
    code: 'TARGET_INSTRUCTION_READ_EVIDENCE_MISSING',
    paths: [],
    unowned_reason:
      'The refusal blocks on top-level target_instruction_evidence.reads, which GLOBAL-002 states on the worker card and which the shared stage contract does not reach because it declares data fields only.',
  },
  {
    code: 'TARGET_INSTRUCTION_READ_EVIDENCE_MISMATCH',
    paths: [],
    unowned_reason:
      'The refusal compares a recorded final_line against the file on disk, which is a relation to the filesystem.',
  },
  GIT_UNAVAILABLE,
]

/**
 * `issue()` call sites in the scanned modules that no stage-output validator
 * owns. Each states why, because an unexplained omission is how a whole
 * handler escapes the completeness proof.
 */
export const UNCOVERED_REFUSAL_SOURCES: readonly {
  file: string
  function: string
  reason: string
}[] = [
  {
    file: STAGE_VALIDATORS_MODULE,
    function: 'undeclaredBlockingFieldIssues',
    reason:
      'Repository validation of the shared field contract, which refuses a contract document rather than a stage output.',
  },
  {
    file: STAGE_VALIDATORS_MODULE,
    function: 'validateSharedFieldContract',
    reason:
      'Repository validation of the shared field contract, which refuses a contract document rather than a stage output.',
  },
  {
    file: STAGE_VALIDATORS_MODULE,
    function: 'validateIntakeOutput',
    reason:
      'INTAKE-VALIDATE-001 refuses a product specification whose shape the planning stage definition declares in its own required_data, and the shared field contract carries no stage entry to hold those refusals against. Moving them under this proof needs an intake entry in that contract.',
  },
  {
    file: STAGE_VALIDATORS_MODULE,
    function: 'validateDecompositionArtifact',
    reason:
      'The target is a decomposition Markdown artifact rather than a stage output the shared field contract declares.',
  },
  {
    file: STAGE_VALIDATORS_MODULE,
    function: 'validateHarnessRepairIntake',
    reason:
      'The target is a harness-repair intake Markdown artifact rather than a stage output the shared field contract declares.',
  },
  {
    file: STAGE_VALIDATORS_MODULE,
    function: 'validateInvestigationArtifact',
    reason:
      'The target is an investigation Markdown artifact rather than a stage output the shared field contract declares.',
  },
  {
    file: STAGE_VALIDATORS_MODULE,
    function: 'validateSpotfixOutcome',
    reason:
      'A spotfix runs outside a workflow run, so it holds no stage contract and no shared field contract entry.',
  },
]

/**
 * Every stage-output validator that can refuse a submission, with the source
 * it raises its refusals from.
 *
 * The verify entry is supplied by the caller because that handler generates
 * its item refusals from the rule tables it iterates, and those tables live
 * beside the handler.
 */
export function stageValidatorRefusals(
  verifyRefusals: readonly StageRefusal[],
  verifyGenerated: readonly GeneratedRefusalCodes[],
): readonly StageValidatorRefusals[] {
  return [
    {
      registry_id: 'PLAN-TRACE-VALIDATE-001',
      stage: 'plan',
      sources: [
        {
          file: STAGE_VALIDATORS_MODULE,
          functions: [
            'validatePlanTrace',
            'criterionProducerIssues',
            'openQuestionDispositionIssues',
            'verificationRecommendationIssues',
          ],
        },
      ],
      refusals: PLAN_REFUSALS,
    },
    {
      registry_id: 'IMPLEMENTATION-CLAIMS-VALIDATE-001',
      stage: 'implement',
      sources: [
        {
          file: STAGE_VALIDATORS_MODULE,
          functions: ['validateImplementationClaims', 'gitUnavailableIssue'],
        },
      ],
      refusals: CLAIMS_REFUSALS,
    },
    {
      registry_id: 'IMPLEMENTATION-CLAIMS-VALIDATE-001',
      stage: 'remediate',
      sources: [
        {
          file: STAGE_VALIDATORS_MODULE,
          functions: ['validateImplementationClaims', 'gitUnavailableIssue'],
        },
      ],
      refusals: CLAIMS_REFUSALS,
    },
    {
      registry_id: 'VERIFY-VALIDATE-001',
      stage: 'verify',
      sources: [
        {
          file: STAGE_VALIDATORS_MODULE,
          functions: ['validateVerifyOutput', 'checkVerifyItems'],
        },
      ],
      refusals: verifyRefusals,
      generated: verifyGenerated,
    },
    {
      registry_id: 'RELEASE-VALIDATE-001',
      stage: 'ship',
      sources: [
        {
          file: STAGE_VALIDATORS_MODULE,
          functions: ['validateReleaseOutput', 'gitUnavailableIssue'],
        },
      ],
      refusals: RELEASE_REFUSALS,
    },
    {
      registry_id: 'PR-DESCRIPTION-VALIDATE-001',
      stage: 'ship',
      sources: [
        { file: PR_DESCRIPTION_MODULE, functions: ['validatePrDescription'] },
      ],
      refusals: PR_DESCRIPTION_REFUSALS,
    },
    {
      registry_id: 'PROTOTYPE-OUTPUT-VALIDATE-001',
      stage: 'prototype:intake',
      sources: [
        {
          file: PROTOTYPE_MODULE,
          functions: ['validatePrototypeOutput', 'validateIntakeOutput'],
        },
      ],
      refusals: PROTOTYPE_INTAKE_REFUSALS,
    },
    {
      registry_id: 'PROTOTYPE-OUTPUT-VALIDATE-001',
      stage: 'approach',
      sources: [
        {
          file: PROTOTYPE_MODULE,
          functions: [
            'validatePrototypeOutput',
            'validateApproachOutput',
            'validatePreconditionEntry',
          ],
        },
      ],
      refusals: APPROACH_REFUSALS,
    },
    {
      registry_id: 'PROTOTYPE-OUTPUT-VALIDATE-001',
      stage: 'build',
      sources: [
        {
          file: PROTOTYPE_MODULE,
          functions: ['validatePrototypeOutput', 'validateBuildOutput'],
        },
      ],
      refusals: BUILD_REFUSALS,
    },
    {
      registry_id: 'PROTOTYPE-OUTPUT-VALIDATE-001',
      stage: 'evaluate',
      sources: [
        {
          file: PROTOTYPE_MODULE,
          functions: ['validatePrototypeOutput', 'validateEvaluateOutput'],
        },
      ],
      refusals: EVALUATE_REFUSALS,
    },
    {
      registry_id: 'TARGET-INSTRUCTION-COVERAGE-VALIDATE-001',
      stage: null,
      sources: [
        {
          file: STAGE_VALIDATORS_MODULE,
          functions: [
            'validateTargetInstructionCoverage',
            'gitUnavailableIssue',
          ],
        },
      ],
      refusals: TARGET_INSTRUCTION_REFUSALS,
    },
  ]
}

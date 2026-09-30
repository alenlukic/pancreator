/**
 * Refusal tables of the delivery stage validators: implementation claims, the
 * plan trace, the release handler, the PR description, and target
 * instruction coverage.
 */

import { GIT_UNAVAILABLE, type StageRefusal } from './shapes.js'

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
    code: 'implementation.handoff_shape',
    paths: [
      'data.implementation.handoff',
      'data.implementation.handoff.symbols_changed[]',
      'data.implementation.handoff.symbols_changed[].path',
      'data.implementation.handoff.symbols_changed[].symbol',
      'data.implementation.handoff.start_here[]',
      'data.implementation.handoff.start_here[].path',
      'data.implementation.handoff.decisions[]',
      'data.implementation.handoff.untested[]',
    ],
  },
  {
    code: 'implementation.handoff_unclaimed',
    paths: [],
    unowned_reason:
      'The refusal relates a handoff symbol path to the changed_files collection.',
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
    code: 'plan.proof_missing',
    paths: ['data.acceptance_criteria[].proof'],
  },
  {
    code: 'plan.live_case_missing',
    paths: [],
    unowned_reason:
      'The refusal matches each live criterion against the test-plan cases that name it, which is a relation between two collections.',
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
    code: 'release.observation_shape',
    paths: [
      'data.release.observations[]',
      'data.release.observations[].criterion',
      'data.release.observations[].signal',
      'data.release.observations[].source',
      'data.release.observations[].window',
      'data.release.observations[].check',
    ],
  },
  {
    code: 'release.observation_window',
    paths: ['data.release.observations[].window'],
  },
  {
    code: 'release.observation_missing',
    paths: [
      'data.release.observations[]',
      'data.release.observations[].criterion',
    ],
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

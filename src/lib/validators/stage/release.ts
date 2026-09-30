/** The ship stage's release-output validator. */

import path from 'node:path'

import {
  readJson,
  isRecord,
  resolveInside,
  fileExists,
  readText,
} from '../../io.js'
import { errorMessage } from '../../errors.js'
import type { HandlerInput, HandlerResult } from '../../requirements/types.js'
import { activeOperatorGateWaivers } from '../../waivers.js'
import { readProjectConfig } from '../../project-config.js'
import {
  panInvocationsInText,
  panProseInvocationError,
} from '../../pan-command-grammar.js'
import { releaseAllocationFor } from '../../release-allocation.js'
import {
  isSemanticVersion,
  nextSemanticVersion,
  type ReleaseBump,
  compareVersions,
  isReleaseMetadataPath,
  validateReleaseMetadata,
} from '../../versioning.js'
import { sharedFieldRequirements } from './field-contract.js'
import {
  gitOutput,
  gitUnavailableIssue,
  issue,
  missingEvidencePath,
  workspaceRootFromInput,
  workspaceSourceChanges,
} from './evidence.js'
import { releaseObservationIssues } from './release-observations.js'

export function validateReleaseOutput(input: HandlerInput): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const value = readJson(path.join(input.root, input.targetPath)) as Record<
    string,
    unknown
  >
  const data = isRecord(value.data) ? value.data : {}
  const release = isRecord(data.release) ? data.release : null

  if (!release) {
    return {
      status: 'failed',
      issues: [issue('release.missing', 'data.release is required')],
    }
  }

  if (readProjectConfig(input.root)?.installation_mode === 'self_development') {
    const workspaceRoot = workspaceRootFromInput(input)
    const localReleaseRequired = isRecord(input.invocation?.managed_worktree)
    const localRelease = isRecord(release.local_release)
      ? release.local_release
      : null

    const releaseCommit =
      localRelease && typeof localRelease.release_commit === 'string'
        ? localRelease.release_commit
        : ''
    const indexCommit =
      localRelease && typeof localRelease.index_commit === 'string'
        ? localRelease.index_commit
        : ''
    const fetchedMain =
      localRelease && typeof localRelease.fetched_main === 'string'
        ? localRelease.fetched_main
        : ''

    const localBranch =
      localRelease && typeof localRelease.branch === 'string'
        ? localRelease.branch
        : ''
    const prDescriptionPath =
      localRelease && typeof localRelease.pr_description_path === 'string'
        ? localRelease.pr_description_path
        : ''

    if (
      localReleaseRequired &&
      (!localRelease ||
        !/^[0-9a-f]{40}$/u.test(releaseCommit) ||
        !/^[0-9a-f]{40}$/u.test(indexCommit) ||
        !/^[0-9a-f]{40}$/u.test(fetchedMain) ||
        localBranch.length === 0 ||
        prDescriptionPath.length === 0)
    ) {
      issues.push(
        issue(
          'release.local_release_missing',
          'Self-development release output MUST include complete local release commit, ancestry, branch, and PR evidence',
        ),
      )
    } else if (localReleaseRequired && localRelease) {
      const head = gitOutput(workspaceRoot, ['rev-parse', 'HEAD'])
      const indexParent = gitOutput(workspaceRoot, [
        'rev-parse',
        `${indexCommit}^`,
      ])
      const fetchedAncestor = gitOutput(workspaceRoot, [
        'merge-base',
        '--is-ancestor',
        fetchedMain,
        releaseCommit,
      ])

      const clean = gitOutput(workspaceRoot, [
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
      ])
      const indexDiff = gitOutput(workspaceRoot, [
        'diff-tree',
        '--no-commit-id',
        '--name-only',
        '-r',
        indexCommit,
      ])
      const branch = gitOutput(workspaceRoot, ['branch', '--show-current'])

      if (
        !head.ok ||
        head.stdout !== indexCommit ||
        !indexParent.ok ||
        indexParent.stdout !== releaseCommit
      ) {
        issues.push(
          issue(
            'release.commit_order',
            'The index commit MUST be HEAD with the immutable release commit as its parent',
          ),
        )
      }

      if (!fetchedAncestor.ok) {
        issues.push(
          issue(
            'release.fetched_main_not_ancestor',
            'Fetched main MUST be an ancestor of the release commit',
          ),
        )
      }

      if (!clean.ok || clean.stdout.length > 0) {
        issues.push(
          issue(
            'release.worktree_dirty',
            'Release finalization MUST leave a clean worktree',
          ),
        )
      }

      if (!branch.ok || branch.stdout !== localBranch) {
        issues.push(
          issue(
            'release.branch_mismatch',
            'release.local_release.branch MUST match the finalized worktree branch',
          ),
        )
      }

      if (!indexDiff.ok || indexDiff.stdout !== 'release/index.json') {
        issues.push(
          issue(
            'release.index_commit_scope',
            'The index commit MUST change only release/index.json',
          ),
        )
      }

      // An agent supplies this path, so a traversal or an absolute path is a
      // reportable mistake in the output rather than a harness fault.
      // `resolveInside` throws on one, which ended the validator with a stack
      // trace instead of an issue the retry could read.
      let prPath: string | null = null

      try {
        prPath = resolveInside(input.root, prDescriptionPath)
      } catch (error) {
        issues.push(
          issue(
            'release.pr_description_path_invalid',
            `release.local_release.pr_description_path MUST resolve inside ` +
              `the installation: ${prDescriptionPath} (${errorMessage(error)})`,
          ),
        )
      }

      if (prPath === null) {
        // The path named nothing this validator can read, and the issue above
        // says so. The content checks below have no file to judge.
      } else if (!fileExists(prPath)) {
        issues.push(
          issue(
            'release.pr_description_missing',
            `Final PR description is missing: ${prDescriptionPath}`,
          ),
        )
      } else if (
        !readText(prPath).includes(`${releaseCommit}..${indexCommit}`)
      ) {
        issues.push(
          issue(
            'release.pr_commit_range_missing',
            'The final PR description MUST include the completed local release commit range',
          ),
        )
      }
    }

    const versioning = isRecord(release.versioning) ? release.versioning : null

    if (!versioning) {
      issues.push(
        issue(
          'release.versioning_missing',
          'Self-development release output MUST include release.versioning',
        ),
      )
    } else {
      const currentVersion =
        typeof versioning.current_version === 'string'
          ? versioning.current_version
          : ''
      const proposedVersion =
        typeof versioning.proposed_version === 'string'
          ? versioning.proposed_version
          : ''
      const recommendation =
        typeof versioning.recommendation === 'string'
          ? versioning.recommendation
          : ''
      const baselineCommit =
        typeof versioning.baseline_commit === 'string'
          ? versioning.baseline_commit
          : ''

      const rawUpdatedFiles = Array.isArray(versioning.updated_files)
        ? versioning.updated_files
        : []
      const updatedFiles = rawUpdatedFiles.filter(
        (entry): entry is string => typeof entry === 'string',
      )

      const rationale =
        typeof versioning.rationale === 'string'
          ? versioning.rationale.trim()
          : ''
      const compatibility =
        typeof versioning.compatibility === 'string'
          ? versioning.compatibility.trim()
          : ''
      const releaseIndexAction =
        typeof versioning.release_index_action === 'string'
          ? versioning.release_index_action.trim()
          : ''

      if (!isSemanticVersion(currentVersion)) {
        issues.push(
          issue(
            'release.current_version',
            'release.versioning.current_version MUST be complete Semantic Versioning',
          ),
        )
      }

      if (!isSemanticVersion(proposedVersion)) {
        issues.push(
          issue(
            'release.proposed_version',
            'release.versioning.proposed_version MUST be complete Semantic Versioning',
          ),
        )
      }

      if (!['major', 'minor', 'patch'].includes(recommendation)) {
        issues.push(
          issue(
            'release.recommendation',
            'release.versioning.recommendation MUST be major, minor, or patch',
          ),
        )
      } else {
        const expected = nextSemanticVersion(
          currentVersion,
          recommendation as ReleaseBump,
        )
        // A worktree that shares its base with a concurrent release cannot
        // take the exact next version, so the allocation ledger may hand it
        // a higher one for the same bump. Anything else is still a mismatch.
        const allocated =
          expected !== null &&
          isSemanticVersion(proposedVersion) &&
          compareVersions(proposedVersion, expected) > 0 &&
          releaseAllocationFor(
            input.root,
            workspaceRoot,
            proposedVersion,
            recommendation,
          ) !== null

        if (expected !== proposedVersion && !allocated) {
          issues.push(
            issue(
              'release.proposed_version_mismatch',
              `release.versioning.proposed_version MUST be ${expected ?? 'a valid next version'} for a ${recommendation} bump from ${currentVersion}, or a higher version pan release allocate handed this worktree for the same bump`,
            ),
          )
        }
      }

      if (!/^[0-9a-f]{40}$/u.test(baselineCommit)) {
        issues.push(
          issue(
            'release.baseline_commit',
            'release.versioning.baseline_commit MUST be a full lowercase Git commit hash',
          ),
        )
      } else {
        const committedVersion = gitOutput(workspaceRoot, [
          'show',
          localReleaseRequired ? `${releaseCommit}^:VERSION` : 'HEAD:VERSION',
        ])

        if (!committedVersion.ok) {
          issues.push(
            issue(
              'release.committed_version_unavailable',
              `Unable to read the committed VERSION: ${committedVersion.error}`,
            ),
          )
        } else if (committedVersion.stdout.trim() !== currentVersion) {
          issues.push(
            issue(
              'release.current_version_mismatch',
              'release.versioning.current_version MUST equal the committed HEAD:VERSION value',
            ),
          )
        }

        const baselineVersion = gitOutput(workspaceRoot, [
          'show',
          `${baselineCommit}:VERSION`,
        ])

        if (
          !baselineVersion.ok ||
          baselineVersion.stdout.trim() !== currentVersion
        ) {
          issues.push(
            issue(
              'release.baseline_version_mismatch',
              'release.versioning.baseline_commit MUST contain current_version in VERSION',
            ),
          )
        }

        const ancestor = gitOutput(workspaceRoot, [
          'merge-base',
          '--is-ancestor',
          baselineCommit,
          'HEAD',
        ])

        if (!ancestor.ok) {
          issues.push(
            issue(
              'release.baseline_not_ancestor',
              'release.versioning.baseline_commit MUST be an ancestor of HEAD',
            ),
          )
        }

        const parentVersion = gitOutput(workspaceRoot, [
          'show',
          `${baselineCommit}^:VERSION`,
        ])

        if (
          parentVersion.ok &&
          parentVersion.stdout.trim() === currentVersion
        ) {
          issues.push(
            issue(
              'release.baseline_not_bump',
              'release.versioning.baseline_commit MUST be the commit that introduced current_version, not a later commit carrying the same value',
            ),
          )
        }
      }

      if (rationale.length === 0) {
        issues.push(
          issue(
            'release.rationale_missing',
            'release.versioning.rationale MUST explain the selected bump',
          ),
        )
      }

      if (compatibility.length === 0) {
        issues.push(
          issue(
            'release.compatibility_missing',
            'release.versioning.compatibility MUST describe compatibility impact',
          ),
        )
      }

      if (releaseIndexAction.length === 0) {
        issues.push(
          issue(
            'release.index_action_missing',
            'release.versioning.release_index_action MUST describe the completed separate index commit',
          ),
        )
      }

      if (rawUpdatedFiles.length !== updatedFiles.length) {
        issues.push(
          issue(
            'release.updated_files_invalid',
            'release.versioning.updated_files MUST contain only path strings',
          ),
        )
      }

      for (const file of updatedFiles) {
        if (!isReleaseMetadataPath(file)) {
          issues.push(
            issue(
              'release.updated_file_out_of_scope',
              `release.versioning.updated_files contains an out-of-scope path: ${file}`,
            ),
          )
        }
      }

      const requiredUpdatedFiles = [
        'CHANGELOG.md',
        'VERSION',
        'docs/embedded-installation.md',
        'package-lock.json',
        'package.json',
      ]

      for (const file of requiredUpdatedFiles) {
        if (!updatedFiles.includes(file)) {
          issues.push(
            issue(
              'release.updated_file_missing',
              `release.versioning.updated_files MUST include ${file}`,
            ),
          )
        }
      }

      const diskVersion = readText(path.join(workspaceRoot, 'VERSION')).trim()

      if (diskVersion !== proposedVersion) {
        issues.push(
          issue(
            'release.version_not_applied',
            'VERSION MUST equal release.versioning.proposed_version before ship submission',
          ),
        )
      }

      if (localReleaseRequired) {
        const indexedRelease = readJson(
          path.join(workspaceRoot, 'release', 'index.json'),
        )
        const indexedEntries =
          isRecord(indexedRelease) && Array.isArray(indexedRelease.releases)
            ? indexedRelease.releases
            : []
        const indexed = indexedEntries.find(
          (entry) =>
            isRecord(entry) &&
            entry.version === proposedVersion &&
            entry.commit === releaseCommit,
        )

        if (!indexed) {
          issues.push(
            issue(
              'release.index_mapping',
              'release/index.json MUST map proposed_version to release_commit',
            ),
          )
        }
      }

      for (const metadataError of validateReleaseMetadata(workspaceRoot)
        .errors) {
        issues.push(issue('release.metadata_invalid', metadataError))
      }
    }
  }

  const rawChangeList = Array.isArray(release.change_list)
    ? release.change_list
    : []
  const changeListRequirement = sharedFieldRequirements(
    input.root,
    'ship',
  ).find((field) => field.path === 'data.release.change_list[]')
  const requiredChangeListFields = changeListRequirement?.required ?? []
  const changeList = rawChangeList
    .map((entry) =>
      isRecord(entry) &&
      requiredChangeListFields.every(
        (field) =>
          typeof entry[field] === 'string' &&
          (entry[field] as string).trim().length > 0,
      )
        ? entry.path
        : null,
    )
    .filter((entry): entry is string => typeof entry === 'string')

  const diffResult = workspaceSourceChanges(workspaceRootFromInput(input))

  if (rawChangeList.length !== changeList.length) {
    const invalid = rawChangeList.find(
      (entry) =>
        !isRecord(entry) ||
        requiredChangeListFields.some(
          (field) =>
            typeof entry[field] !== 'string' ||
            (entry[field] as string).trim().length === 0,
        ),
    )
    issues.push(
      issue(
        'release.change_list_shape',
        `change_list entries MUST be objects with path, kind, and description: ${JSON.stringify(invalid)}`,
      ),
    )
  }

  if (!diffResult.ok) {
    if (changeList.length > 0) {
      issues.push(gitUnavailableIssue(diffResult.error))
    }
  } else {
    const diffFiles = diffResult.files

    if (changeList.length === 0 && diffFiles.length > 0) {
      issues.push(issue('release.change_list', 'change_list MUST be non-empty'))
    }

    for (const file of changeList) {
      if (diffFiles.length > 0 && !diffFiles.includes(file)) {
        issues.push(
          issue(
            'release.change_not_in_diff',
            `change_list file not in workspace diff: ${file}`,
          ),
        )
      }
    }

    for (const file of diffFiles) {
      if (!changeList.includes(file)) {
        issues.push(
          issue(
            'release.diff_not_disclosed',
            `diff file not listed in change_list: ${file}`,
          ),
        )
      }
    }
  }

  const rollback =
    typeof release.rollback_plan === 'string'
      ? release.rollback_plan
      : typeof release.rollback === 'string'
        ? release.rollback
        : ''

  if (rollback.trim().length === 0) {
    issues.push(issue('release.rollback', 'rollback_plan MUST be non-empty'))
  }

  for (const argv of panInvocationsInText(rollback)) {
    const refusal = panProseInvocationError(argv)

    if (refusal) {
      issues.push(
        issue(
          'release.rollback_command_invalid',
          `rollback_plan names \`pan ${argv.join(' ')}\`. ` + refusal,
        ),
      )
    }
  }

  const governanceReview = isRecord(release.governance_artifact_review)
    ? release.governance_artifact_review
    : null
  const runGovernanceIssues = Array.isArray(
    input.runState?.governance_artifact_issues,
  )
    ? input.runState.governance_artifact_issues.filter(isRecord)
    : []

  if (runGovernanceIssues.length > 0) {
    if (!governanceReview) {
      issues.push(
        issue(
          'release.governance_review_missing',
          'release.governance_artifact_review MUST disposition every recorded governance or artifact issue',
        ),
      )
    } else {
      const reviewedIssueIds = new Set(
        Array.isArray(governanceReview.issues_reviewed)
          ? governanceReview.issues_reviewed.filter(
              (item): item is string => typeof item === 'string',
            )
          : [],
      )
      const summary =
        typeof governanceReview.summary === 'string'
          ? governanceReview.summary.trim()
          : ''

      if (summary.length === 0) {
        issues.push(
          issue(
            'release.governance_review_summary',
            'release.governance_artifact_review.summary MUST be non-empty',
          ),
        )
      }

      for (const runIssue of runGovernanceIssues) {
        const issueId =
          typeof runIssue.issue_id === 'string' ? runIssue.issue_id : ''

        if (issueId.length > 0 && !reviewedIssueIds.has(issueId)) {
          issues.push(
            issue(
              'release.governance_issue_undisposed',
              `Recorded governance or artifact issue is not dispositioned: ${issueId}`,
            ),
          )
        }
      }
    }
  }

  const waivers = Array.isArray(release.disclosed_waivers)
    ? release.disclosed_waivers
    : Array.isArray(release.waivers)
      ? release.waivers
      : []
  const followUps = Array.isArray(release.follow_up_cases)
    ? release.follow_up_cases
    : []
  const deferred = Array.isArray(release.deferred_acceptance_criteria)
    ? release.deferred_acceptance_criteria
    : []

  const runWaivers = Array.isArray(input.runState?.operator_gate_waivers)
    ? input.runState.operator_gate_waivers
    : []
  const workspaceBefore = isRecord(input.invocation?.workspace_before)
    ? input.invocation.workspace_before
    : null
  const currentFingerprint =
    workspaceBefore && typeof workspaceBefore.fingerprint === 'string'
      ? workspaceBefore.fingerprint
      : undefined
  const activeRunWaivers = activeOperatorGateWaivers(
    {
      stage_history: input.runState?.stage_history,
      operator_gate_waivers: runWaivers,
      accepted_workspace_fingerprint:
        input.runState?.accepted_workspace_fingerprint,
    },
    currentFingerprint,
  )

  const runDeferred = Array.isArray(
    input.runState?.deferred_acceptance_criteria,
  )
    ? (input.runState.deferred_acceptance_criteria as string[])
    : []
  const stageHistory = Array.isArray(input.runState?.stage_history)
    ? input.runState.stage_history
    : []
  const knownFingerprints = new Set<string>()

  for (const historyItem of stageHistory) {
    if (
      isRecord(historyItem) &&
      typeof historyItem.workspace_fingerprint === 'string'
    ) {
      knownFingerprints.add(historyItem.workspace_fingerprint)
    }
  }

  if (typeof input.runState?.accepted_workspace_fingerprint === 'string') {
    knownFingerprints.add(input.runState.accepted_workspace_fingerprint)
  }

  for (const waiver of runWaivers) {
    if (isRecord(waiver) && typeof waiver.workspace_fingerprint === 'string') {
      knownFingerprints.add(waiver.workspace_fingerprint)
    }
  }

  const validation = Array.isArray(release.validation) ? release.validation : []

  for (const [index, entry] of validation.entries()) {
    if (!isRecord(entry)) {
      issues.push(
        issue(
          'release.validation_shape',
          `validation[${index}] MUST be an object`,
        ),
      )
      continue
    }

    const fingerprint =
      typeof entry.workspace_fingerprint === 'string'
        ? entry.workspace_fingerprint
        : ''

    if (fingerprint.length === 0) {
      issues.push(
        issue(
          'release.validation_fingerprint',
          `validation[${index}] MUST declare workspace_fingerprint`,
        ),
      )
    } else if (!knownFingerprints.has(fingerprint)) {
      issues.push(
        issue(
          'release.validation_fingerprint_unknown',
          `validation fingerprint is not backed by stage history or waivers: ${fingerprint}`,
        ),
      )
    }

    const evidencePath =
      typeof entry.evidence_path === 'string' ? entry.evidence_path : ''

    const missingValidationPath = missingEvidencePath(input, evidencePath)

    if (missingValidationPath) {
      issues.push(
        issue(
          'release.validation_evidence_missing',
          `Validation evidence path does not exist: ${missingValidationPath}`,
        ),
      )
    }
  }

  for (const criterion of runDeferred) {
    if (!deferred.includes(criterion)) {
      issues.push(
        issue(
          'release.deferred_undisclosed',
          `Deferred acceptance criterion not disclosed: ${criterion}`,
        ),
      )
    }
  }

  issues.push(...releaseObservationIssues(input.root, release, input.runState))

  for (const followUp of followUps) {
    if (!isRecord(followUp) || typeof followUp.id !== 'string') {
      issues.push(
        issue('release.follow_up_shape', 'Each follow_up_case MUST have an id'),
      )
      continue
    }

    const evidence = Array.isArray(followUp.evidence) ? followUp.evidence : []

    if (evidence.length === 0) {
      issues.push(
        issue(
          'release.follow_up_evidence',
          `Follow-up ${followUp.id} MUST include evidence`,
        ),
      )
    }

    for (const entry of evidence) {
      const missingPath = missingEvidencePath(input, entry)

      if (missingPath) {
        issues.push(
          issue(
            'release.evidence_missing',
            `Follow-up evidence path does not exist: ${missingPath}`,
          ),
        )
      }
    }
  }

  for (const waiver of activeRunWaivers) {
    const disclosed = waivers.find(
      (item) => isRecord(item) && item.waiver_id === waiver.waiver_id,
    )

    if (!disclosed) {
      // Distinguish a waiver that is absent from one disclosed under the
      // wrong key or shape: reporting both as "not disclosed" misdiagnoses a
      // re-key defect as an omission (audited follow-up SHIP-FU-001).
      const misdeclared = waivers.find((item) =>
        isRecord(item)
          ? Object.values(item).includes(waiver.waiver_id)
          : item === waiver.waiver_id,
      )

      issues.push(
        issue(
          'release.waiver_undisclosed',
          misdeclared === undefined
            ? `Active waiver not disclosed: ${waiver.waiver_id}`
            : `Waiver ${waiver.waiver_id} is disclosed without a 'waiver_id' ` +
                `key. Re-key this entry, keeping its content: ` +
                `${JSON.stringify(misdeclared)}`,
        ),
      )
      continue
    }

    const runFingerprint =
      typeof waiver.workspace_fingerprint === 'string'
        ? waiver.workspace_fingerprint
        : ''
    const disclosedFingerprint =
      typeof disclosed.workspace_fingerprint === 'string'
        ? disclosed.workspace_fingerprint
        : ''

    if (disclosedFingerprint.length === 0) {
      issues.push(
        issue(
          'release.waiver_fingerprint',
          `Disclosed waiver ${waiver.waiver_id} MUST include workspace_fingerprint`,
        ),
      )
    } else if (disclosedFingerprint !== runFingerprint) {
      issues.push(
        issue(
          'release.waiver_fingerprint_mismatch',
          `Disclosed waiver fingerprint does not match run state for ${waiver.waiver_id}`,
        ),
      )
    }

    for (const evidencePath of [
      typeof waiver.artifact_path === 'string' ? waiver.artifact_path : '',
      typeof waiver.source_evidence_path === 'string'
        ? waiver.source_evidence_path
        : '',
    ]) {
      if (
        evidencePath.length > 0 &&
        !fileExists(path.join(input.root, evidencePath))
      ) {
        issues.push(
          issue(
            'release.waiver_evidence_missing',
            `Waiver evidence path does not exist: ${evidencePath}`,
          ),
        )
      }
    }
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}

/** Implement and remediate claims, checked against the workspace diff. */

import path from 'node:path'

import { readJson, isRecord, fileExists } from '../../io.js'
import type { HandlerInput, HandlerResult } from '../../requirements/types.js'
import {
  sharedFieldRequirements,
  validEvidenceShape,
} from './field-contract.js'
import {
  attemptChangedPaths,
  attemptTestDelta,
  gitUnavailableIssue,
  issue,
  modifiedMs,
  parseTestsAddedEntry,
  resolveWorkspaceRelativeFilePath,
  workspaceRootFromInput,
  workspaceSourceChanges,
  type TestsAddedEntry,
} from './evidence.js'
import { planAcceptanceCriterionIds } from './plan-lookups.js'

export function validateImplementationClaims(
  input: HandlerInput,
): HandlerResult {
  const issues: HandlerResult['issues'] = []

  const absolute = path.join(input.root, input.targetPath)
  const parsed: unknown = readJson(absolute)

  if (!isRecord(parsed)) {
    return {
      status: 'failed',
      issues: [issue('output.shape', 'stage output MUST be an object')],
    }
  }

  const value = parsed
  const data = isRecord(value.data) ? value.data : {}

  if (value.result === 'blocked') {
    const blocked = isRecord(data.blocked) ? data.blocked : null

    if (!blocked) {
      issues.push(
        issue(
          'blocked.missing',
          'data.blocked is required for a blocked result',
        ),
      )
    } else {
      for (const field of [
        'missing_precondition',
        'supplying_command',
      ] as const) {
        const fieldValue = blocked[field]

        if (typeof fieldValue !== 'string' || fieldValue.trim().length === 0) {
          issues.push(
            issue(
              'blocked.shape',
              `data.blocked.${field} MUST be a non-empty string`,
            ),
          )
        }
      }
    }

    if (
      !Array.isArray(data.acceptance_results) ||
      data.acceptance_results.length !== 0
    ) {
      issues.push(
        issue(
          'blocked.acceptance_results',
          'data.acceptance_results MUST be an empty array for a blocked result',
        ),
      )
    }

    if (data.implementation !== undefined) {
      issues.push(
        issue(
          'blocked.implementation_forbidden',
          'data.implementation MUST NOT be present for a blocked result',
        ),
      )
    }

    if (blocked) {
      const evidence = blocked.evidence

      if (
        !Array.isArray(evidence) ||
        evidence.length === 0 ||
        !evidence.every(
          (entry) => typeof entry === 'string' && entry.trim().length > 0,
        )
      ) {
        issues.push(
          issue(
            'blocked.evidence',
            'data.blocked.evidence MUST be a non-empty array of non-empty ' +
              'strings proving the missing precondition',
          ),
        )
      }
    }

    // A blocked worker may still have edited the tree before it stopped.
    // `data.implementation` is forbidden here, so the only honest place for
    // those paths is top-level `workspace_changes.paths`, reconciled against
    // the Git delta rather than against a claim list that cannot exist.
    const blockedWorkspaceRoot = workspaceRootFromInput(input)
    const blockedAttemptFiles = attemptChangedPaths(input, blockedWorkspaceRoot)
    const blockedDiff =
      blockedAttemptFiles === null
        ? workspaceSourceChanges(blockedWorkspaceRoot)
        : null
    const owedBlockedDisclosure =
      blockedAttemptFiles ?? (blockedDiff?.ok ? blockedDiff.files : [])

    const blockedAttribution = isRecord(value.workspace_changes)
      ? value.workspace_changes
      : null
    const blockedAttributedPaths = Array.isArray(blockedAttribution?.paths)
      ? blockedAttribution.paths.filter(
          (entry): entry is string => typeof entry === 'string',
        )
      : []

    for (const file of owedBlockedDisclosure) {
      if (!blockedAttributedPaths.includes(file)) {
        issues.push(
          issue(
            'blocked.diff_not_disclosed',
            `File changed by this blocked attempt but not listed in ` +
              `workspace_changes.paths: ${file}`,
          ),
        )
      }
    }

    return { status: issues.length === 0 ? 'passed' : 'failed', issues }
  }

  const implementation = isRecord(data.implementation)
    ? data.implementation
    : null

  if (!implementation) {
    return {
      status: 'failed',
      issues: [
        issue('implementation.missing', 'data.implementation is required'),
      ],
    }
  }

  const invocationAttempt =
    typeof input.invocation?.attempt === 'number' ? input.invocation.attempt : 1

  if (invocationAttempt > 1) {
    const remediation = Array.isArray(implementation.remediation)
      ? implementation.remediation
      : []

    if (remediation.length === 0) {
      issues.push(
        issue(
          'implementation.remediation_missing',
          'Retry implementation output MUST explicitly describe remediation for the prior failure or loop cause',
        ),
      )
    }

    for (const [index, item] of remediation.entries()) {
      if (!isRecord(item)) {
        issues.push(
          issue(
            'implementation.remediation_shape',
            `implementation.remediation[${index}] MUST be an object`,
          ),
        )
        continue
      }

      for (const field of ['cause', 'action', 'evidence'] as const) {
        const value = item[field]
        const valid =
          field === 'evidence'
            ? Array.isArray(value) &&
              value.some(
                (entry) => typeof entry === 'string' && entry.trim().length > 0,
              )
            : typeof value === 'string' && value.trim().length > 0

        if (!valid) {
          issues.push(
            issue(
              'implementation.remediation_shape',
              `implementation.remediation[${index}].${field} MUST be ${
                field === 'evidence'
                  ? 'a non-empty string array'
                  : 'a non-empty string'
              }`,
            ),
          )
        }
      }
    }
  }

  const changedFilesRaw = Array.isArray(implementation.changed_files)
    ? (implementation.changed_files as unknown[])
    : []
  const changedFiles = changedFilesRaw.filter(
    (file): file is string => typeof file === 'string',
  )

  // Reject non-string entries explicitly: comparing or joining an object
  // yields '[object Object]' diagnostics, and path.join on one throws.
  for (const entry of changedFilesRaw) {
    if (typeof entry !== 'string') {
      issues.push(
        issue(
          'claim.entry_shape',
          `implementation.changed_files entries MUST be strings; got ${JSON.stringify(entry)}`,
        ),
      )
    }
  }

  // The output states the same fact twice: `changed_files` claims the work,
  // and `workspace_changes.paths` attributes what the workspace holds. A
  // contradiction between them is decidable from the output alone, so it does
  // not wait on a Git read that a non-Git workspace or a failed diff can take
  // away.
  const attribution = isRecord(value.workspace_changes)
    ? value.workspace_changes
    : null
  const attributedPaths = Array.isArray(attribution?.paths)
    ? attribution.paths.filter(
        (entry): entry is string => typeof entry === 'string',
      )
    : []

  for (const file of attributedPaths) {
    if (!changedFiles.includes(file)) {
      issues.push(
        issue(
          'claim.attribution_not_disclosed',
          `Path attributed in workspace_changes but not listed in changed_files: ${file}`,
        ),
      )
    }
  }

  const acceptanceResultsList = Array.isArray(data.acceptance_results)
    ? data.acceptance_results
    : []
  const workspaceRoot = workspaceRootFromInput(input)
  const diffResult = workspaceSourceChanges(workspaceRoot)
  // Snapshotted once: the disclosure check and the test-delta check below
  // both read this attempt's changed paths.
  const attemptFiles = attemptChangedPaths(input, workspaceRoot)

  if (!diffResult.ok) {
    if (changedFiles.length > 0) {
      issues.push(gitUnavailableIssue(diffResult.error))
    }
  } else {
    const diffFiles = diffResult.files
    // Disclosure is owed for what this attempt changed. Existence is checked
    // against the cumulative diff, which still catches a fabricated claim.
    const owedDisclosure = attemptFiles ?? diffFiles
    // The cumulative diff lists existing files only, so a file this attempt
    // deleted appears in the attempt delta and nowhere else. It is a real
    // change the worker must disclose, not a fabricated claim.
    const knownChange = (file: string): boolean =>
      diffFiles.includes(file) || owedDisclosure.includes(file)

    if (diffFiles.length > 0 && changedFiles.length > 0) {
      for (const file of changedFiles) {
        if (!knownChange(file)) {
          issues.push(
            issue(
              'claim.not_in_diff',
              `Claimed changed file not in workspace diff: ${file}`,
            ),
          )
        }
      }

      for (const file of owedDisclosure) {
        if (!changedFiles.includes(file)) {
          issues.push(
            issue(
              'claim.diff_not_disclosed',
              `File changed by this attempt but not listed in changed_files: ${file}`,
            ),
          )
        }
      }
    } else if (changedFiles.length > 0) {
      for (const file of changedFiles) {
        if (
          !owedDisclosure.includes(file) &&
          !fileExists(path.join(workspaceRoot, file))
        ) {
          issues.push(
            issue(
              'claim.file_missing',
              `Claimed changed file does not exist: ${file}`,
            ),
          )
        }
      }
    }
  }

  // The output is the claim, so every path it claims must already hold the
  // work when it is written. A path modified after the output was written was
  // edited after the claim was made, and the claim describes a tree that no
  // longer exists.
  const outputModifiedMs = modifiedMs(path.join(input.root, input.targetPath))

  if (outputModifiedMs !== null) {
    for (const file of changedFiles) {
      const fileModifiedMs = modifiedMs(path.join(workspaceRoot, file))

      if (fileModifiedMs !== null && fileModifiedMs > outputModifiedMs) {
        issues.push(
          issue(
            'claim.modified_after_output',
            `Claimed changed file was modified after the output that claims it: ${file}. ` +
              'Rewrite the output after the last edit it describes.',
          ),
        )
      }
    }
  }

  if (acceptanceResultsList.length === 0) {
    issues.push(
      issue('acceptance.missing', 'data.acceptance_results MUST be non-empty'),
    )
  }

  const acceptanceIds = new Set<string>()
  const evidenceRequirement = sharedFieldRequirements(
    input.root,
    'implement',
  ).find((field) => field.path === 'data.acceptance_results[].evidence[]')
  const acceptedEvidenceShapes = new Set(
    evidenceRequirement?.accepted_shapes ?? [],
  )

  for (const [index, item] of acceptanceResultsList.entries()) {
    if (!isRecord(item) || typeof item.id !== 'string') {
      issues.push(
        issue(
          'acceptance.shape',
          `acceptance_results[${index}] MUST have an id`,
        ),
      )
      continue
    }

    if (acceptanceIds.has(item.id)) {
      issues.push(
        issue('acceptance.duplicate', `Duplicate acceptance id: ${item.id}`),
      )
    }

    acceptanceIds.add(item.id)

    if (typeof item.result !== 'string' || item.result.trim().length === 0) {
      issues.push(
        issue(
          'acceptance.result',
          `Acceptance ${item.id} MUST declare a result`,
        ),
      )
    }

    const evidence = Array.isArray(item.evidence) ? item.evidence : []

    if (evidence.length === 0) {
      issues.push(
        issue(
          'acceptance.evidence',
          `Acceptance ${item.id} MUST include evidence`,
        ),
      )
    }

    for (const [evidenceIndex, entry] of evidence.entries()) {
      if (
        typeof entry !== 'string' ||
        !validEvidenceShape(entry, acceptedEvidenceShapes)
      ) {
        issues.push(
          issue(
            'acceptance.evidence_shape',
            `Acceptance ${item.id} evidence[${evidenceIndex}] MUST be a path reference, prose observation, or pytest node id`,
          ),
        )
      }
    }
  }

  const expectedIds = planAcceptanceCriterionIds(
    input.root,
    input.targetPath,
    input.runState,
  )

  if (expectedIds.length > 0) {
    const expectedSet = new Set(expectedIds)

    for (const id of expectedIds) {
      if (!acceptanceIds.has(id)) {
        issues.push(
          issue(
            'acceptance.coverage',
            `Implementation MUST report acceptance result for ${id}`,
          ),
        )
      }
    }

    for (const id of acceptanceIds) {
      if (!expectedSet.has(id)) {
        issues.push(
          issue(
            'acceptance.unknown',
            `Unknown acceptance id not in plan: ${id}`,
          ),
        )
      }
    }
  }

  const testsAddedRaw = Array.isArray(implementation.tests_added)
    ? (implementation.tests_added as unknown[])
    : []
  const testsAdded: TestsAddedEntry[] = []

  for (const entry of testsAddedRaw) {
    const parsed = parseTestsAddedEntry(entry)

    if (parsed) {
      testsAdded.push(parsed)
    } else {
      issues.push(
        issue(
          'claim.entry_shape',
          `implementation.tests_added entries MUST be '<test file path>' ` +
            `strings or { path, contract } objects; got ${JSON.stringify(entry)}`,
        ),
      )
    }
  }

  for (const entry of testsAdded) {
    const resolved = resolveWorkspaceRelativeFilePath(
      input.root,
      workspaceRoot,
      entry.file,
    )

    if (!fileExists(resolved)) {
      issues.push(
        issue(
          'claim.test_missing',
          `Listed test file does not exist: ${entry.file} (from entry: ` +
            `${entry.raw}). Entries MUST be '<test file path>' optionally ` +
            `followed by '::<test case>', e.g. ` +
            `'tests/unit/example.test.ts::adds provenance rows'.`,
        ),
      )
    }
  }

  // Each new test file and each net-positive test delta needs a contract.
  // A change that adds no tests needs no entry.
  for (const delta of attemptTestDelta(input, workspaceRoot, {
    attemptFiles,
    diff: diffResult,
  })) {
    const covered = testsAdded.some(
      (entry) =>
        entry.file === delta.path &&
        typeof entry.contract === 'string' &&
        entry.contract.trim().length > 0,
    )

    if (covered) {
      continue
    }

    const shape =
      delta.kind === 'new_file'
        ? `is a new test file with ${delta.count} test call site(s)`
        : `gained ${delta.count} net test call site(s)`

    issues.push(
      issue(
        'implementation.tests_added_contract_missing',
        `${delta.path} ${shape}; implementation.tests_added MUST carry ` +
          `{ "path": "${delta.path}", "contract": "<one sentence naming the ` +
          `behavior the test proves>" }.`,
      ),
    )
  }

  return {
    status: issues.length === 0 ? 'passed' : 'failed',
    issues,
  }
}

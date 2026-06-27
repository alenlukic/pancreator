import path from 'node:path'
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

import { fileExists, isRecord, readJson, readText } from '../io.js'
import { loadRegistry } from '../requirements/registry.js'
import { hasHeading, parseMarkdown } from '../markdown.js'
import type { HandlerInput, HandlerResult } from '../requirements/types.js'
import { activeOperatorGateWaivers } from '../waivers.js'

const REVIEW_SEVERITIES = new Set(['blocker', 'high', 'medium', 'low'])
const WORK_MODES = new Set(['systematic', 'lightweight'])
const GIT_TIMEOUT_MS = 30_000
const GIT_MAX_BUFFER = 1_024 * 1_024

type GitCommandResult =
  | { ok: true; stdout: string }
  | { ok: false; error: string }

type GitDiffResult =
  | { ok: true; files: string[] }
  | { ok: false; error: string }

function gitOutput(root: string, gitArgs: string[]): GitCommandResult {
  const result = spawnSync('git', gitArgs, {
    cwd: root,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  })

  if (result.error) {
    return { ok: false, error: result.error.message }
  }

  if (result.status !== 0) {
    return {
      ok: false,
      error: (
        result.stderr ||
        result.stdout ||
        `git exited ${result.status}`
      ).trim(),
    }
  }

  return { ok: true, stdout: result.stdout.trim() }
}

function gitChangedFiles(root: string): GitDiffResult {
  const files = new Set<string>()

  const tracked = gitOutput(root, [
    'diff',
    '--name-only',
    'HEAD',
    '--diff-filter=ACMR',
  ])

  if (!tracked.ok) {
    return { ok: false, error: tracked.error }
  }

  for (const file of tracked.stdout.split('\n').filter(Boolean)) {
    files.add(file)
  }

  const untracked = gitOutput(root, [
    'ls-files',
    '--others',
    '--exclude-standard',
  ])

  if (!untracked.ok) {
    return { ok: false, error: untracked.error }
  }

  for (const file of untracked.stdout.split('\n').filter(Boolean)) {
    files.add(file)
  }

  return { ok: true, files: [...files] }
}

function workspaceSourceChanges(root: string): GitDiffResult {
  const diff = gitChangedFiles(root)

  if (!diff.ok) {
    return diff
  }

  return {
    ok: true,
    files: diff.files.filter(
      (file) =>
        !file.startsWith('runtime/') &&
        !file.endsWith('/.lock') &&
        !file.includes('/validations/'),
    ),
  }
}

function gitUnavailableIssue(error: string): HandlerResult['issues'][number] {
  return issue(
    'git.unavailable',
    `Git-backed validation failed closed: ${error}`,
  )
}

function issue(code: string, message: string): HandlerResult['issues'][number] {
  return { code, message }
}

function acceptanceCriterionIdsFromPlanOutput(
  root: string,
  planOutputPath: string,
): string[] {
  const absolute = path.join(root, planOutputPath)

  if (!fileExists(absolute)) {
    return []
  }

  const value = readJson(absolute) as Record<string, unknown>
  const data = isRecord(value.data) ? value.data : {}
  const criteria = Array.isArray(data.acceptance_criteria)
    ? data.acceptance_criteria
    : []
  const ids: string[] = []

  for (const item of criteria) {
    if (isRecord(item) && typeof item.id === 'string') {
      ids.push(item.id)
    }
  }

  return [...new Set(ids)].sort()
}

function assessmentVerdictForInvocation(
  root: string,
  runId: string,
  invocationId: string,
): string | null {
  const assessmentsDirectory = path.join(
    root,
    'runtime/logs/workflows',
    runId,
    'assessments',
  )
  const currentPath = path.join(
    assessmentsDirectory,
    `${invocationId}.assessment.json`,
  )
  const legacyPath = path.join(
    assessmentsDirectory,
    `assessment-${invocationId}.json`,
  )
  const assessmentPath = fileExists(currentPath) ? currentPath : legacyPath

  if (!fileExists(assessmentPath)) {
    return null
  }

  try {
    const value = readJson(assessmentPath)

    return isRecord(value) && typeof value.verdict === 'string'
      ? value.verdict
      : null
  } catch {
    return null
  }
}

function latestPlanOutputPathFromOutputs(
  root: string,
  runId: string,
): string | null {
  const outputsDir = path.join(root, 'runtime/logs/workflows', runId, 'outputs')

  if (!fileExists(outputsDir)) {
    return null
  }

  const planPattern = /^(?:\d{3}_)?plan-(\d+)[-_]/u
  const planFiles = readdirSync(outputsDir)
    .filter((entry) => planPattern.test(entry))
    .sort((left, right) => {
      const leftNumber = Number(planPattern.exec(left)?.[1] ?? 0)
      const rightNumber = Number(planPattern.exec(right)?.[1] ?? 0)

      return leftNumber - rightNumber
    })

  if (planFiles.length === 0) {
    return null
  }

  const latestPlan = planFiles[planFiles.length - 1]

  return `runtime/logs/workflows/${runId}/outputs/${latestPlan}`
}

function acceptedPlanOutputPath(
  root: string,
  runId: string,
  runState?: Record<string, unknown>,
): string | null {
  const stageHistory = Array.isArray(runState?.stage_history)
    ? runState.stage_history
    : []
  let latestAccepted: string | null = null
  let latestSuccessful: string | null = null

  for (const item of stageHistory) {
    if (
      !isRecord(item) ||
      item.stage !== 'plan' ||
      item.outcome !== 'success' ||
      typeof item.output_path !== 'string'
    ) {
      continue
    }

    if (!fileExists(path.join(root, item.output_path))) {
      continue
    }

    latestSuccessful = item.output_path

    if (typeof item.invocation_id !== 'string') {
      continue
    }

    if (
      assessmentVerdictForInvocation(root, runId, item.invocation_id) === 'pass'
    ) {
      latestAccepted = item.output_path
    }
  }

  if (latestAccepted) {
    return latestAccepted
  }

  if (latestSuccessful) {
    return latestSuccessful
  }

  return latestPlanOutputPathFromOutputs(root, runId)
}

function planAcceptanceCriterionIds(
  root: string,
  targetPath: string,
  runState?: Record<string, unknown>,
): string[] {
  const runMatch = /runtime\/logs\/workflows\/([^/]+)\//u.exec(targetPath)

  if (!runMatch) {
    return []
  }

  const planOutputPath = acceptedPlanOutputPath(root, runMatch[1], runState)

  if (!planOutputPath) {
    return []
  }

  return acceptanceCriterionIdsFromPlanOutput(root, planOutputPath)
}

export function validateImplementationClaims(
  input: HandlerInput,
): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const absolute = path.join(input.root, input.targetPath)
  const value = readJson(absolute) as Record<string, unknown>
  const data = isRecord(value.data) ? value.data : {}
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

  const changedFiles = Array.isArray(implementation.changed_files)
    ? (implementation.changed_files as string[])
    : []
  const acceptanceResultsList = Array.isArray(data.acceptance_results)
    ? data.acceptance_results
    : []
  const diffResult = workspaceSourceChanges(input.root)

  if (!diffResult.ok) {
    if (changedFiles.length > 0) {
      issues.push(gitUnavailableIssue(diffResult.error))
    }
  } else {
    const diffFiles = diffResult.files

    if (diffFiles.length > 0 && changedFiles.length > 0) {
      for (const file of changedFiles) {
        if (!diffFiles.includes(file)) {
          issues.push(
            issue(
              'claim.not_in_diff',
              `Claimed changed file not in workspace diff: ${file}`,
            ),
          )
        }
      }

      for (const file of diffFiles) {
        if (!changedFiles.includes(file)) {
          issues.push(
            issue(
              'claim.diff_not_disclosed',
              `Diff file not listed in changed_files: ${file}`,
            ),
          )
        }
      }
    } else if (changedFiles.length > 0) {
      for (const file of changedFiles) {
        if (!fileExists(path.join(input.root, file))) {
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

  if (acceptanceResultsList.length === 0) {
    issues.push(
      issue('acceptance.missing', 'data.acceptance_results MUST be non-empty'),
    )
  }

  const acceptanceIds = new Set<string>()

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

  const testsAdded = Array.isArray(implementation.tests_added)
    ? (implementation.tests_added as string[])
    : []

  for (const testPath of testsAdded) {
    if (!fileExists(path.join(input.root, testPath))) {
      issues.push(
        issue(
          'claim.test_missing',
          `Listed test file does not exist: ${testPath}`,
        ),
      )
    }
  }

  return {
    status: issues.length === 0 ? 'passed' : 'failed',
    issues,
  }
}

export function validateIntakeOutput(input: HandlerInput): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const value = readJson(path.join(input.root, input.targetPath)) as Record<
    string,
    unknown
  >
  const data = isRecord(value.data) ? value.data : {}
  const spec = isRecord(data.product_spec) ? data.product_spec : null

  if (!spec) {
    issues.push(issue('intake.spec_missing', 'data.product_spec is required'))
    return { status: 'failed', issues }
  }

  if (typeof spec.summary !== 'string' || spec.summary.trim().length === 0) {
    issues.push(
      issue('intake.summary', 'product_spec.summary MUST be non-empty'),
    )
  }

  const stories = Array.isArray(spec.user_stories) ? spec.user_stories : []
  const storyIds = new Set<string>()

  for (const [index, story] of stories.entries()) {
    if (!isRecord(story) || typeof story.id !== 'string') {
      issues.push(
        issue(
          'intake.story_id',
          `User story ${index + 1} MUST have a stable id`,
        ),
      )
      continue
    }

    storyIds.add(story.id)

    if (
      typeof story.statement !== 'string' ||
      story.statement.trim().length === 0
    ) {
      issues.push(
        issue(
          'intake.story_statement',
          `User story ${story.id} MUST have an observable statement`,
        ),
      )
    }
  }

  const constraints = Array.isArray(spec.constraints) ? spec.constraints : []

  if (constraints.length === 0) {
    issues.push(
      issue('intake.constraints', 'product_spec.constraints MUST be non-empty'),
    )
  }

  if (!Array.isArray(spec.out_of_scope)) {
    issues.push(
      issue(
        'intake.out_of_scope',
        'product_spec.out_of_scope MUST be an array',
      ),
    )
  }

  if (!Array.isArray(spec.open_questions)) {
    issues.push(
      issue(
        'intake.open_questions',
        'product_spec.open_questions MUST be an array',
      ),
    )
  }

  const artifacts = Array.isArray(value.artifacts) ? value.artifacts : []

  for (const artifact of artifacts) {
    if (!isRecord(artifact) || typeof artifact.path !== 'string') {
      continue
    }

    const artifactPath = path.join(input.root, artifact.path)

    if (!fileExists(artifactPath)) {
      issues.push(
        issue('intake.artifact_missing', `Artifact missing: ${artifact.path}`),
      )
      continue
    }

    const markdown = readText(artifactPath)
    let mentionedStories = 0

    for (const id of storyIds) {
      if (markdown.includes(id)) {
        mentionedStories += 1
      }
    }

    if (storyIds.size > 0 && mentionedStories === 0) {
      issues.push(
        issue(
          'intake.md_json_mismatch',
          `Artifact ${artifact.path} does not reference any user story ids from JSON`,
        ),
      )
    }
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}

export function validatePlanTrace(input: HandlerInput): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const value = readJson(path.join(input.root, input.targetPath)) as Record<
    string,
    unknown
  >
  const data = isRecord(value.data) ? value.data : {}
  const criteria = Array.isArray(data.acceptance_criteria)
    ? data.acceptance_criteria
    : []
  const plan = isRecord(data.engineering_plan) ? data.engineering_plan : null
  const referencedStories = new Set<string>()

  const intakeStories = isRecord(data.product_spec)
    ? data.product_spec.user_stories
    : null
  const storyIds = new Set<string>()

  if (Array.isArray(intakeStories)) {
    for (const story of intakeStories) {
      if (isRecord(story) && typeof story.id === 'string') {
        storyIds.add(story.id)
      }
    }
  }

  for (const [index, item] of criteria.entries()) {
    if (!isRecord(item) || typeof item.id !== 'string') {
      issues.push(
        issue(
          'plan.criterion_id',
          `Acceptance criterion ${index + 1} MUST have an id`,
        ),
      )
      continue
    }

    const verification = isRecord(item.verification) ? item.verification : null

    if (!verification || typeof verification.method !== 'string') {
      issues.push(
        issue(
          'plan.verification_missing',
          `Criterion ${item.id} MUST declare a verification method`,
        ),
      )
    } else if (
      typeof verification.expected !== 'string' ||
      verification.expected.trim().length === 0
    ) {
      issues.push(
        issue(
          'plan.verification_expected',
          `Criterion ${item.id} MUST declare verification.expected`,
        ),
      )
    }

    const mapsTo = Array.isArray(item.maps_to) ? item.maps_to : []

    if (mapsTo.length === 0) {
      issues.push(
        issue(
          'plan.maps_to_missing',
          `Criterion ${item.id} MUST declare maps_to`,
        ),
      )
    }

    for (const mapped of mapsTo) {
      if (typeof mapped === 'string' && mapped.startsWith('US-')) {
        referencedStories.add(mapped)
      } else if (typeof mapped === 'string' && mapped.startsWith('AC-')) {
        if (mapped !== item.id) {
          issues.push(
            issue(
              'plan.maps_to_mismatch',
              `Criterion ${item.id} maps_to includes unrelated acceptance id ${mapped}`,
            ),
          )
        }
      } else if (typeof mapped === 'string' && mapped.includes('-')) {
        const catalog = loadRegistry(input.root)

        if (!catalog.entries.has(mapped)) {
          issues.push(
            issue(
              'plan.maps_to_unknown',
              `Criterion ${item.id} maps_to references unknown registry id ${mapped}`,
            ),
          )
        }
      }
    }
  }

  for (const storyId of storyIds) {
    if (!referencedStories.has(storyId)) {
      issues.push(
        issue(
          'plan.orphan_story',
          `User story ${storyId} is not referenced by any acceptance criterion`,
        ),
      )
    }
  }

  if (
    storyIds.size === 0 &&
    referencedStories.size === 0 &&
    criteria.length > 0
  ) {
    issues.push(
      issue(
        'plan.story_trace_missing',
        'Plan acceptance criteria MUST map to user story ids (US-*)',
      ),
    )
  }

  const files = plan && Array.isArray(plan.files) ? plan.files : []

  for (const [index, file] of files.entries()) {
    if (!isRecord(file) || typeof file.path !== 'string') {
      issues.push(
        issue(
          'plan.file_shape',
          `engineering_plan.files[${index}] MUST have path`,
        ),
      )
      continue
    }

    const status = typeof file.status === 'string' ? file.status : ''

    if (status !== 'new' && !fileExists(path.join(input.root, file.path))) {
      issues.push(
        issue(
          'plan.file_missing',
          `Likely file does not exist and is not marked new: ${file.path}`,
        ),
      )
    }
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}

export function validateReviewOutput(input: HandlerInput): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const value = readJson(path.join(input.root, input.targetPath)) as Record<
    string,
    unknown
  >
  const data = isRecord(value.data) ? value.data : {}
  const review = isRecord(data.review) ? data.review : null

  if (!review) {
    return {
      status: 'failed',
      issues: [issue('review.missing', 'data.review is required')],
    }
  }

  const findings = Array.isArray(review.findings) ? review.findings : []
  const acceptanceResults = Array.isArray(review.acceptance_results)
    ? review.acceptance_results
    : []

  for (const [index, finding] of findings.entries()) {
    if (!isRecord(finding) || typeof finding.id !== 'string') {
      issues.push(
        issue('review.finding_shape', `Finding ${index + 1} MUST have an id`),
      )
      continue
    }

    const severity =
      typeof finding.severity === 'string' ? finding.severity : ''

    if (!REVIEW_SEVERITIES.has(severity)) {
      issues.push(
        issue(
          'review.severity',
          `Finding ${finding.id} MUST use an allowed severity`,
        ),
      )
    }

    if (
      typeof finding.remediation_stage !== 'string' ||
      finding.remediation_stage.trim().length === 0
    ) {
      issues.push(
        issue(
          'review.remediation_stage',
          `Finding ${finding.id} MUST declare remediation_stage`,
        ),
      )
    }

    const evidence = Array.isArray(finding.evidence) ? finding.evidence : []

    if (evidence.length === 0) {
      issues.push(
        issue(
          'review.finding_evidence',
          `Finding ${finding.id} MUST include evidence`,
        ),
      )
    }

    for (const [evidenceIndex, entry] of evidence.entries()) {
      if (typeof entry !== 'string' || entry.trim().length === 0) {
        issues.push(
          issue(
            'review.finding_evidence',
            `Finding ${finding.id} evidence[${evidenceIndex}] MUST be non-empty`,
          ),
        )
      }
    }
  }

  if (acceptanceResults.length === 0) {
    issues.push(
      issue(
        'review.acceptance_missing',
        'review.acceptance_results is required',
      ),
    )
  }

  const reportedIds = new Set<string>()

  for (const [index, item] of acceptanceResults.entries()) {
    if (!isRecord(item) || typeof item.id !== 'string') {
      issues.push(
        issue(
          'review.acceptance_shape',
          `acceptance_results[${index}] MUST have an id`,
        ),
      )
      continue
    }

    if (reportedIds.has(item.id)) {
      issues.push(
        issue(
          'review.acceptance_duplicate',
          `Duplicate acceptance id: ${item.id}`,
        ),
      )
    }

    reportedIds.add(item.id)

    if (typeof item.result !== 'string' || item.result.trim().length === 0) {
      issues.push(
        issue(
          'review.acceptance_result',
          `Acceptance ${item.id} MUST declare a result`,
        ),
      )
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
      if (!reportedIds.has(id)) {
        issues.push(
          issue(
            'review.acceptance_missing',
            `Review MUST report acceptance result for ${id}`,
          ),
        )
      }
    }

    for (const id of reportedIds) {
      if (!expectedSet.has(id)) {
        issues.push(
          issue(
            'review.acceptance_unknown',
            `Unknown acceptance id not in plan: ${id}`,
          ),
        )
      }
    }
  }

  const failedAcceptance = acceptanceResults.some(
    (item) => isRecord(item) && item.result === 'fail',
  )

  if (
    review.verdict === 'pass' &&
    (findings.some((item) => isRecord(item) && item.severity === 'blocker') ||
      failedAcceptance)
  ) {
    issues.push(
      issue(
        'review.verdict_inconsistent',
        'pass verdict inconsistent with blocker finding or failed acceptance',
      ),
    )
  }

  if (review.verdict === 'fail' && findings.length === 0 && !failedAcceptance) {
    issues.push(
      issue(
        'review.verdict_inconsistent',
        'fail verdict requires blocker/high findings or failed acceptance',
      ),
    )
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}

export function validateQaOutput(input: HandlerInput): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const value = readJson(path.join(input.root, input.targetPath)) as Record<
    string,
    unknown
  >
  const data = isRecord(value.data) ? value.data : {}
  const qa = isRecord(data.qa_report)
    ? data.qa_report
    : isRecord(data.test)
      ? data.test
      : null

  if (!qa) {
    return {
      status: 'failed',
      issues: [issue('qa.missing', 'data.qa_report is required')],
    }
  }

  const cases = Array.isArray(qa.cases) ? qa.cases : []
  const defects = Array.isArray(qa.defects) ? qa.defects : []
  const acceptanceResults = Array.isArray(qa.acceptance_results)
    ? qa.acceptance_results
    : []

  for (const [index, testCase] of cases.entries()) {
    if (!isRecord(testCase) || typeof testCase.id !== 'string') {
      issues.push(
        issue('qa.case_shape', `QA case ${index + 1} MUST have an id`),
      )
      continue
    }

    for (const field of ['steps', 'expected', 'actual', 'result'] as const) {
      if (
        typeof testCase[field] !== 'string' ||
        (testCase[field] as string).trim().length === 0
      ) {
        issues.push(
          issue(
            'qa.case_field',
            `QA case ${testCase.id} MUST include ${field}`,
          ),
        )
      }
    }
  }

  for (const [index, defect] of defects.entries()) {
    if (!isRecord(defect) || typeof defect.id !== 'string') {
      issues.push(
        issue('qa.defect_shape', `Defect ${index + 1} MUST have an id`),
      )
      continue
    }

    if (
      typeof defect.classification !== 'string' ||
      defect.classification.trim().length === 0
    ) {
      issues.push(
        issue(
          'qa.defect_classification',
          `Defect ${defect.id} MUST declare classification`,
        ),
      )
    }

    if (typeof defect.owner !== 'string' || defect.owner.trim().length === 0) {
      issues.push(
        issue('qa.defect_owner', `Defect ${defect.id} MUST declare owner`),
      )
    }
  }

  if (acceptanceResults.length === 0) {
    issues.push(
      issue(
        'qa.acceptance_missing',
        'qa_report.acceptance_results is required',
      ),
    )
  }

  const expectedIds = planAcceptanceCriterionIds(
    input.root,
    input.targetPath,
    input.runState,
  )

  if (expectedIds.length > 0) {
    const reportedIds = new Set<string>()

    for (const item of acceptanceResults) {
      if (!isRecord(item) || typeof item.id !== 'string') {
        continue
      }

      reportedIds.add(item.id)

      if (item.result === 'not_applicable') {
        const explanation =
          typeof item.explanation === 'string' ? item.explanation.trim() : ''

        if (explanation.length === 0) {
          issues.push(
            issue(
              'qa.not_applicable',
              `Acceptance ${item.id} marked not_applicable MUST justify`,
            ),
          )
        }
      }

      const evidence = Array.isArray(item.evidence) ? item.evidence : []

      if (evidence.length === 0) {
        issues.push(
          issue(
            'qa.acceptance_evidence',
            `Acceptance ${item.id} MUST include evidence`,
          ),
        )
      } else {
        for (const entry of evidence) {
          if (
            typeof entry === 'string' &&
            entry.includes('/') &&
            !fileExists(path.join(input.root, entry))
          ) {
            issues.push(
              issue(
                'qa.evidence_missing',
                `Evidence path does not exist: ${entry}`,
              ),
            )
          }
        }
      }
    }

    for (const id of expectedIds) {
      if (!reportedIds.has(id)) {
        issues.push(
          issue(
            'qa.acceptance_coverage',
            `QA MUST report acceptance result for ${id}`,
          ),
        )
      }
    }
  }

  const failedAcceptance = acceptanceResults.some(
    (item) => isRecord(item) && item.result === 'fail',
  )

  if (qa.verdict === 'pass' && failedAcceptance) {
    issues.push(
      issue(
        'qa.verdict_inconsistent',
        'pass verdict inconsistent with failed acceptance criterion',
      ),
    )
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}

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

  const changeList = Array.isArray(release.change_list)
    ? (release.change_list as string[])
    : []
  const diffResult = workspaceSourceChanges(input.root)

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

    if (
      evidencePath.length > 0 &&
      evidencePath.includes('/') &&
      !fileExists(path.join(input.root, evidencePath))
    ) {
      issues.push(
        issue(
          'release.validation_evidence_missing',
          `Validation evidence path does not exist: ${evidencePath}`,
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
      if (
        typeof entry === 'string' &&
        entry.includes('/') &&
        !fileExists(path.join(input.root, entry))
      ) {
        issues.push(
          issue(
            'release.evidence_missing',
            `Follow-up evidence path does not exist: ${entry}`,
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
      issues.push(
        issue(
          'release.waiver_undisclosed',
          `Active waiver not disclosed: ${waiver.waiver_id}`,
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

export function validateDecompositionArtifact(
  input: HandlerInput,
): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const content = readText(path.join(input.root, input.targetPath))
  const parsed = parseMarkdown(content)
  const lower = content.toLowerCase()
  const requiredHeadings = [
    'decision',
    'scope summary',
    'threshold assessment',
    'fragmentation economics',
    'requirement traceability',
    'risks and unknowns',
    'next action',
  ]

  for (const heading of requiredHeadings) {
    if (!hasHeading(parsed, heading)) {
      issues.push(
        issue(
          'decomposition.section_missing',
          `Decomposition MUST include heading: ${heading}`,
        ),
      )
    }
  }

  const decisionSection = /^## Decision\s*\n+([^\n]+)/imu.exec(content)?.[1]
  const normalizedDecision = decisionSection
    ?.replaceAll(/[`*_]/gu, '')
    .replace(/^decision\s*:\s*/iu, '')
    .trim()
    .toLowerCase()

  if (normalizedDecision !== 'retain' && normalizedDecision !== 'decompose') {
    issues.push(
      issue(
        'decomposition.decision',
        'Decision section MUST contain exactly retain or decompose',
      ),
    )
  }

  const thresholdTerms = [
    'independence gate',
    'hard trigger',
    'pressure indicator',
    'file count',
  ]

  for (const term of thresholdTerms) {
    if (!lower.includes(term)) {
      issues.push(
        issue(
          'decomposition.threshold_coverage',
          `Threshold assessment MUST address ${term}`,
        ),
      )
    }
  }

  if (!lower.includes('workflow overhead') || !lower.includes('risk')) {
    issues.push(
      issue(
        'decomposition.economics',
        'Fragmentation economics MUST compare workflow overhead with risk reduction',
      ),
    )
  }

  const chunkPattern = /^## Chunk (\d+):\s+(.+)$/gmu
  const chunkMatches = [...content.matchAll(chunkPattern)]

  if (normalizedDecision === 'retain') {
    if (!hasHeading(parsed, 'retained intake spec')) {
      issues.push(
        issue(
          'decomposition.retained_spec',
          'A retain decision MUST include the retained intake spec',
        ),
      )
    }

    if (chunkMatches.length > 0) {
      issues.push(
        issue(
          'decomposition.retain_chunks',
          'A retain decision MUST NOT include decomposed chunks',
        ),
      )
    }
  }

  if (normalizedDecision === 'decompose') {
    for (const heading of ['dependency graph', 'execution order']) {
      if (!hasHeading(parsed, heading)) {
        issues.push(
          issue(
            'decomposition.section_missing',
            `A decompose decision MUST include heading: ${heading}`,
          ),
        )
      }
    }

    if (chunkMatches.length < 2) {
      issues.push(
        issue(
          'decomposition.chunk_count',
          'A decompose decision MUST contain at least two chunks',
        ),
      )
    }

    if (
      chunkMatches.length > 5 &&
      !hasHeading(parsed, 'more than five chunks justification')
    ) {
      issues.push(
        issue(
          'decomposition.over_fragmented',
          'More than five chunks MUST include an explicit justification',
        ),
      )
    }

    const expectedNumbers = chunkMatches.map((_, index) => index + 1)
    const observedNumbers = chunkMatches.map((match) => Number(match[1]))

    if (
      observedNumbers.some((number, index) => number !== expectedNumbers[index])
    ) {
      issues.push(
        issue(
          'decomposition.chunk_sequence',
          'Chunk headings MUST be numbered sequentially from 1',
        ),
      )
    }

    const requiredChunkSections = [
      'objective',
      'in scope',
      'out of scope',
      'acceptance criteria',
      'dependencies',
      'validation',
      'handoff contract',
    ]

    for (const [index, match] of chunkMatches.entries()) {
      const start = match.index ?? 0
      const end = chunkMatches[index + 1]?.index ?? content.length
      const block = content.slice(start, end)
      const blockParsed = parseMarkdown(block)

      for (const heading of requiredChunkSections) {
        if (!hasHeading(blockParsed, heading)) {
          issues.push(
            issue(
              'decomposition.chunk_section_missing',
              `Chunk ${index + 1} MUST include heading: ${heading}`,
            ),
          )
        }
      }

      const acceptanceHeading = /^### Acceptance criteria\s*$/imu.exec(block)
      let acceptanceSection = ''

      if (acceptanceHeading?.index !== undefined) {
        const remainder = block.slice(
          acceptanceHeading.index + acceptanceHeading[0].length,
        )
        const nextHeading = /^###?\s+/mu.exec(remainder)
        acceptanceSection = remainder.slice(0, nextHeading?.index)
      }

      if (!acceptanceSection || !/^\s*\d+\.\s+\S/mu.test(acceptanceSection)) {
        issues.push(
          issue(
            'decomposition.chunk_acceptance',
            `Chunk ${index + 1} MUST include numbered acceptance criteria`,
          ),
        )
      }
    }

    if (!/\bDAG\b|directed acyclic graph/iu.test(content)) {
      issues.push(
        issue(
          'decomposition.dependency_graph',
          'Dependency graph MUST identify the chunk graph as a DAG',
        ),
      )
    }
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}

export function validateInvestigationArtifact(
  input: HandlerInput,
): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const content = readText(path.join(input.root, input.targetPath))
  const parsed = parseMarkdown(content)
  const requiredHeadings = [
    'root cause',
    'acceptance criteria',
    'work mode',
    'next action',
    'work-001',
  ]

  for (const heading of requiredHeadings) {
    if (!hasHeading(parsed, heading)) {
      issues.push(
        issue(
          'investigation.section_missing',
          `Investigation MUST include heading: ${heading}`,
        ),
      )
    }
  }

  const modeLine = content
    .split('\n')
    .find((line) => line.toLowerCase().includes('work mode'))

  if (
    !modeLine ||
    ![...WORK_MODES].some((mode) => modeLine.toLowerCase().includes(mode))
  ) {
    issues.push(
      issue(
        'investigation.work_mode',
        'Investigation MUST declare exactly one work mode (systematic or lightweight)',
      ),
    )
  }

  const criteriaMatches = content.match(/^\s*\d+\.\s+/gmu) ?? []

  if (criteriaMatches.length === 0) {
    issues.push(
      issue(
        'investigation.numbered_criteria',
        'Investigation MUST include numbered acceptance criteria',
      ),
    )
  }

  const work001Section = content.toLowerCase()
  const thresholdChecks = [
    'coherent',
    'acceptance criteria',
    'three implementation files',
    'cross-module',
    'systematic',
  ]
  const thresholdHits = thresholdChecks.filter((item) =>
    work001Section.includes(item),
  ).length

  if (thresholdHits < 3) {
    issues.push(
      issue(
        'investigation.work001_threshold',
        'Investigation MUST evaluate WORK-001 lightweight eligibility thresholds',
      ),
    )
  }

  if (
    content.toLowerCase().includes('uncertain') &&
    !content.toLowerCase().includes('systematic')
  ) {
    issues.push(
      issue(
        'investigation.uncertainty_route',
        'Uncertainty MUST route to systematic work mode',
      ),
    )
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}

export function validateSpotfixOutcome(input: HandlerInput): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const content = readText(path.join(input.root, input.targetPath))
  const lower = content.toLowerCase()

  if (lower.includes('status: success') && lower.includes('escalation')) {
    issues.push(
      issue(
        'spotfix.conflict',
        'Spotfix MUST NOT claim success and escalation simultaneously',
      ),
    )
  }

  const cycleMatches = content.match(/cycle\s+\d/giu) ?? []

  if (cycleMatches.length > 3) {
    issues.push(
      issue(
        'spotfix.cycle_limit',
        'Spotfix MUST NOT exceed three validation cycles',
      ),
    )
  }

  if (!/\bnpm run\b|\.\/bin\/pan\b/u.test(content)) {
    issues.push(
      issue(
        'spotfix.validation_command',
        'Spotfix MUST document configured validation command coverage',
      ),
    )
  }

  const diffResult = gitChangedFiles(input.root)

  if (!diffResult.ok) {
    issues.push(gitUnavailableIssue(diffResult.error))
  } else {
    const diffFiles = diffResult.files.filter(
      (file) => !file.startsWith('runtime/'),
    )

    if (diffFiles.length > 3) {
      issues.push(
        issue(
          'spotfix.diff_bounded',
          'Spotfix MUST keep implementation scope within three non-test files',
        ),
      )
    }
  }

  if (
    lower.includes('escalation') &&
    !hasHeading(parseMarkdown(content), 'escalation')
  ) {
    issues.push(
      issue(
        'spotfix.escalation_content',
        'Escalation MUST include a dedicated escalation heading and rationale',
      ),
    )
  }

  if (lower.includes('escalation')) {
    const requiredEscalationFields = [
      'acceptance criteria',
      'validation cycle',
      'blocker',
    ]
    const missing = requiredEscalationFields.filter(
      (field) => !lower.includes(field),
    )

    if (missing.length > 0) {
      issues.push(
        issue(
          'spotfix.escalation_incomplete',
          `Escalation MUST document: ${missing.join(', ')}`,
        ),
      )
    }
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}

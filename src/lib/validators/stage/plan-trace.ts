/**
 * The plan trace validator: acceptance-criterion producers, verification
 * recommendations, and open-question dispositions.
 */

import path from 'node:path'

import { isRecord, readJson, fileExists } from '../../io.js'
import { loadRegistry } from '../../requirements/registry.js'
import type { HandlerResult, HandlerInput } from '../../requirements/types.js'
import { loadRepositoryChecks } from '../../repository-checks.js'
import {
  panInvocationsInText,
  panProseInvocationError,
} from '../../pan-command-grammar.js'
import { sharedEnum, sharedRequiredChildFields } from './field-contract.js'
import {
  issue,
  resolveWorkspaceRelativeFilePath,
  workspaceRootFromInput,
} from './evidence.js'
import { intakeProductSpecFromRun } from './plan-lookups.js'
import { profileCommandInText } from './verify.js'

/**
 * Shape check for the optional worker recommendation to change the run's
 * verification level. Level-name validity is judged at prepare time against
 * the installation's configured levels.
 */
export function verificationRecommendationIssues(
  data: Record<string, unknown>,
  stage: string,
): HandlerResult['issues'] {
  const recommendation = data.verification_recommendation

  if (recommendation === undefined) {
    return []
  }

  if (
    !isRecord(recommendation) ||
    typeof recommendation.level !== 'string' ||
    recommendation.level.trim().length === 0 ||
    typeof recommendation.reason !== 'string' ||
    recommendation.reason.trim().length === 0
  ) {
    return [
      issue(
        `${stage}.verification_recommendation`,
        'data.verification_recommendation MUST carry non-empty level and ' +
          'reason strings when present',
      ),
    ]
  }

  return []
}

/**
 * Validate a plan stage output's traceability: each acceptance criterion has an
 * id, a known proof type, and maps to intake user stories or constraints; every
 * intake story is covered; each planned file and case is well-formed and
 * producible; and the verification recommendation is present when expected.
 * Reads the intake product spec from the run's intake output. Raises `plan.*`
 * codes.
 */
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

  // The intake record on disk is authoritative; a spec embedded in the plan
  // document is only a fallback for runs whose intake output is unavailable.
  const productSpec =
    intakeProductSpecFromRun(input.root, input.targetPath, input.runState) ??
    (isRecord(data.product_spec) ? data.product_spec : null)
  const intakeStories = productSpec ? productSpec.user_stories : null
  const storyIds = new Set<string>()
  const relatedTraceIds = new Set<string>()
  const proofTypes = sharedEnum(
    input.root,
    'plan',
    'data.acceptance_criteria[].proof',
  )

  if (productSpec) {
    for (const collection of [
      productSpec.constraints,
      productSpec.out_of_scope,
    ]) {
      if (!Array.isArray(collection)) {
        continue
      }

      for (const entry of collection) {
        if (isRecord(entry) && typeof entry.id === 'string') {
          relatedTraceIds.add(entry.id)
        } else if (typeof entry === 'string') {
          relatedTraceIds.add(entry)
        }
      }
    }
  }

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

    if (!proofTypes.has(typeof item.proof === 'string' ? item.proof : '')) {
      issues.push(
        issue(
          'plan.proof_missing',
          `Criterion ${item.id} MUST declare proof as one of ` +
            `${[...proofTypes].join(', ')}`,
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
      } else if (
        typeof mapped === 'string' &&
        (mapped.startsWith('C-') || mapped.startsWith('OOS-')) &&
        relatedTraceIds.has(mapped)
      ) {
        continue
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
  // Plan file paths name target-repository files, so they resolve against the
  // workspace root. Resolving them against the installation root fails every
  // path in a detached install, where the two are different directories.
  const workspaceRoot = workspaceRootFromInput(input)
  const requiredFileFields = sharedRequiredChildFields(
    input.root,
    'plan',
    'data.engineering_plan.files[]',
  )
  const fileStatusValues = sharedEnum(
    input.root,
    'plan',
    'data.engineering_plan.files[].status',
  )

  for (const [index, file] of files.entries()) {
    if (!isRecord(file)) {
      issues.push(
        issue(
          'plan.file_required',
          `engineering_plan.files[${index}] MUST be an object`,
        ),
      )
      continue
    }

    for (const field of requiredFileFields) {
      const value = file[field]

      if (field === 'status') {
        if (typeof value !== 'string' || !fileStatusValues.has(value)) {
          issues.push(
            issue(
              'plan.file_status',
              `engineering_plan.files[${index}].status MUST be new or modified`,
            ),
          )
        }
      } else if (typeof value !== 'string' || value.trim().length === 0) {
        issues.push(
          issue(
            'plan.file_required',
            `engineering_plan.files[${index}].${field} MUST be a non-empty string`,
          ),
        )
      }
    }

    if (typeof file.path !== 'string' || file.path.trim().length === 0) {
      continue
    }

    const status = typeof file.status === 'string' ? file.status : ''

    // Absolute and traversal paths are acceptable when that is what the plan
    // declares: any path that resolves on this system is valid, and the
    // existence check below is the only gate. Downstream target-instruction
    // resolution consumes the same paths without rejecting them.
    if (
      status !== 'new' &&
      !fileExists(
        resolveWorkspaceRelativeFilePath(input.root, workspaceRoot, file.path),
      )
    ) {
      issues.push(
        issue(
          'plan.file_missing',
          `Likely file does not exist and is not marked new: ${file.path}`,
        ),
      )
    }
  }

  // ORCH-001: the gate runs each profile once, so a case must not rerun one.
  const testPlan = Array.isArray(data.test_plan) ? data.test_plan : []

  for (const [index, testCase] of testPlan.entries()) {
    if (!isRecord(testCase)) {
      continue
    }

    const caseId =
      typeof testCase.id === 'string' ? testCase.id : `test_plan[${index}]`
    const text = ['setup', 'action', 'command', 'steps']
      .map((field) => testCase[field])
      .filter((entry): entry is string => typeof entry === 'string')
      .join('\n')
    const rerun =
      text.length > 0 ? profileCommandInText(input.root, text) : null

    const configuredProfile = rerun
      ? loadRepositoryChecks(input.root).profiles[rerun.profile]
      : undefined
    const readOnlyConfiguration =
      rerun?.profile === 'configuration' &&
      configuredProfile?.commands.length === 1

    if (rerun && !readOnlyConfiguration) {
      issues.push(
        issue(
          'plan.case_reruns_profile',
          `Test-plan case ${caseId} runs \`${rerun.command}\`, the ` +
            `\`${rerun.profile}\` profile; the gate runs that profile once, so ` +
            'the case must exercise a focused scenario instead',
        ),
      )
    }

    for (const argv of panInvocationsInText(text)) {
      const refusal = panProseInvocationError(argv)

      if (refusal) {
        issues.push(
          issue(
            'plan.case_invalid_pan_invocation',
            `Test-plan case ${caseId} names \`pan ${argv.join(' ')}\`. ` +
              refusal,
          ),
        )
      }
    }
  }

  // PLAN-002: the test plan lists cases only for `live` criteria, because QA
  // runs only for them. A gate lane, a code read, or a post-ship signal
  // proves every other criterion.
  const coveredCriteria = new Set(
    testPlan.flatMap((testCase) =>
      isRecord(testCase) && typeof testCase.criterion === 'string'
        ? [testCase.criterion]
        : [],
    ),
  )

  for (const item of criteria) {
    if (
      isRecord(item) &&
      typeof item.id === 'string' &&
      item.proof === 'live' &&
      !coveredCriteria.has(item.id)
    ) {
      issues.push(
        issue(
          'plan.live_case_missing',
          `Criterion ${item.id} has proof live and MUST have at least one ` +
            'test-plan case whose criterion names it',
        ),
      )
    }
  }

  issues.push(...criterionProducerIssues(criteria))
  issues.push(
    ...openQuestionDispositionIssues(input, data, criteria, productSpec),
  )
  issues.push(...verificationRecommendationIssues(data, 'plan'))

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}

/**
 * Workflow lifecycle commands. Only the supervisor runs one, so a criterion
 * whose evidence comes out of one of these names an artifact its own graders
 * are forbidden to create.
 */
const LIFECYCLE_COMMANDS = [
  'pan init',
  'pan prepare',
  'pan delegate',
  'pan submit',
  'pan assess',
  'pan decide',
  'pan pause',
  'pan resume',
  'pan set-stage',
  'pan waive-gate',
  'pan abort',
  'pan cohort',
  'pan governance attest-supervisor',
]

/**
 * Evidence an assigned worker may produce for itself: a test, or a read-only
 * command that changes no run state. A criterion that names one of these has
 * a legitimate producer even when it also describes a lifecycle command.
 */
const WORKER_PRODUCIBLE_EVIDENCE = [
  'tests/',
  'pan context card',
  'pan context digest',
  'pan repository-check',
  'pan requirements run',
  'pan tests',
  'pan validate',
  'pan status',
  'npm test',
]

/**
 * Refuse an acceptance criterion whose verification names a lifecycle command
 * and no producer the assigned workers may run.
 *
 * Evidence workers and the verifier are barred from lifecycle commands, and
 * `pan prepare` additionally refuses an unattested supervisor, so a criterion
 * proved only that way is unmeetable as written. `pan context card` is the
 * read-only render that gives a card-shaped criterion a legitimate producer.
 */
function criterionProducerIssues(criteria: unknown[]): HandlerResult['issues'] {
  const issues: HandlerResult['issues'] = []

  for (const item of criteria) {
    if (!isRecord(item) || typeof item.id !== 'string') {
      continue
    }

    const verification = isRecord(item.verification) ? item.verification : null

    if (!verification) {
      continue
    }

    const text = ['method', 'expected']
      .map((field) => verification[field])
      .filter((entry): entry is string => typeof entry === 'string')
      .join('\n')
      .toLowerCase()

    if (WORKER_PRODUCIBLE_EVIDENCE.some((token) => text.includes(token))) {
      continue
    }

    const lifecycle = LIFECYCLE_COMMANDS.find((command) =>
      text.includes(command),
    )

    if (lifecycle) {
      issues.push(
        issue(
          'plan.criterion_unproducible',
          `Criterion ${item.id} is verified by \`${lifecycle}\`, a lifecycle ` +
            'command no assigned evidence worker or verifier may run; name ' +
            'a producer those workers may run, such as `pan context card` ' +
            'for a rendered card or a test path',
        ),
      )
    }
  }

  return issues
}

/** Leading identifier of an inherited open question, e.g. `Q2` in `Q2: ...`. */
const OPEN_QUESTION_ID_PATTERN = /^\s*([A-Za-z]+-?\d+)\s*[:.)]/u

function openQuestionIds(spec: Record<string, unknown> | null): string[] {
  const questions =
    spec && Array.isArray(spec.open_questions) ? spec.open_questions : []
  const ids: string[] = []

  for (const question of questions) {
    if (typeof question !== 'string') {
      continue
    }

    const match = OPEN_QUESTION_ID_PATTERN.exec(question)

    if (match) {
      ids.push(match[1])
    }
  }

  return ids
}

function openQuestionCount(spec: Record<string, unknown> | null): number {
  return spec && Array.isArray(spec.open_questions)
    ? spec.open_questions.length
    : 0
}

/**
 * An open question the plan cannot settle from evidence must be carried forward
 * as deferred or escalated, never answered by assumption and never hardened
 * into an acceptance criterion. Prose appended to the inherited specification
 * text is invisible to every downstream stage, so the disposition record is
 * what makes the unmade decision auditable.
 */
function openQuestionDispositionIssues(
  input: HandlerInput,
  data: Record<string, unknown>,
  criteria: unknown[],
  productSpec: Record<string, unknown> | null,
): HandlerResult['issues'] {
  const issues: HandlerResult['issues'] = []
  const questionCount = openQuestionCount(productSpec)

  if (questionCount === 0) {
    return issues
  }

  const dispositions = Array.isArray(data.open_question_dispositions)
    ? data.open_question_dispositions
    : []

  if (dispositions.length === 0) {
    return [
      issue(
        'plan.disposition_missing',
        'data.open_question_dispositions is required when the ratified ' +
          'specification carries open questions',
      ),
    ]
  }

  const allowed = sharedEnum(
    input.root,
    'plan',
    'data.open_question_dispositions[].disposition',
  )
  const questionIds = openQuestionIds(productSpec)
  const reported = new Set<string>()
  const unsettled = new Set<string>()

  for (const [index, entry] of dispositions.entries()) {
    if (!isRecord(entry) || typeof entry.id !== 'string') {
      issues.push(
        issue(
          'plan.disposition_shape',
          `open_question_dispositions[${index + 1}] MUST name the question id`,
        ),
      )
      continue
    }

    if (reported.has(entry.id)) {
      issues.push(
        issue(
          'plan.disposition_duplicate',
          `Duplicate disposition for question ${entry.id}`,
        ),
      )
    }

    reported.add(entry.id)

    const disposition =
      typeof entry.disposition === 'string' ? entry.disposition : ''

    if (!allowed.has(disposition)) {
      issues.push(
        issue(
          'plan.disposition_value',
          `Disposition for ${entry.id} MUST be one of ${[...allowed].join(', ')}`,
        ),
      )
    }

    if (disposition === 'deferred' || disposition === 'escalated') {
      unsettled.add(entry.id)
    }

    if (typeof entry.answer !== 'string' || entry.answer.trim().length === 0) {
      issues.push(
        issue(
          'plan.disposition_answer',
          `Disposition for ${entry.id} MUST state the answer or the decision ` +
            `still required`,
        ),
      )
    }

    const evidence = Array.isArray(entry.evidence) ? entry.evidence : []
    const validEvidence =
      evidence.length > 0 &&
      evidence.every(
        (item) => typeof item === 'string' && item.trim().length > 0,
      )

    if (disposition === 'resolved' && !validEvidence) {
      issues.push(
        issue(
          'plan.disposition_evidence',
          `Question ${entry.id} resolved by the plan MUST cite non-empty ` +
            `evidence`,
        ),
      )
    }
  }

  for (const id of questionIds) {
    if (!reported.has(id)) {
      issues.push(
        issue(
          'plan.disposition_missing',
          `Open question ${id} MUST have a recorded disposition`,
        ),
      )
    }
  }

  if (questionIds.length > 0) {
    const known = new Set(questionIds)

    for (const id of reported) {
      if (!known.has(id)) {
        issues.push(
          issue(
            'plan.disposition_unknown',
            `Disposition names unknown open question: ${id}`,
          ),
        )
      }
    }
  } else if (dispositions.length < questionCount) {
    // The intake wrote unlabeled questions, so coverage is countable only.
    issues.push(
      issue(
        'plan.disposition_missing',
        `The specification carries ${questionCount} open questions and the ` +
          `plan records ${dispositions.length} dispositions`,
      ),
    )
  }

  // A criterion that cites an unsettled question asserts the answer the plan
  // just said it does not have.
  for (const item of criteria) {
    if (!isRecord(item) || typeof item.id !== 'string') {
      continue
    }

    const mapsTo = Array.isArray(item.maps_to) ? item.maps_to : []

    for (const mapped of mapsTo) {
      if (typeof mapped === 'string' && unsettled.has(mapped)) {
        issues.push(
          issue(
            'plan.criterion_assumes_answer',
            `Criterion ${item.id} maps to ${mapped}, which the plan recorded ` +
              `as unresolved`,
          ),
        )
      }
    }
  }

  return issues
}

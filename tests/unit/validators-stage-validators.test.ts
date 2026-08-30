import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { validateAssessment } from '../../src/lib/validators/assessment.js'
import {
  isSpotfixDiffExempt,
  validateImplementationClaims,
  validatePlanTrace,
  validateReleaseOutput,
  validateSharedFieldContract,
  validateSpotfixOutcome,
  validateTargetInstructionCoverage,
  validateVerifyOutput,
} from '../../src/lib/validators/stage-validators.js'
import { createFixture } from '../helpers.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'

/**
 * Bare validator fixture root carrying the shared field-contract document.
 * Validators read the document from the installation root only; production
 * code deliberately has no fallback to the checkout that started the run,
 * so each fixture ships its own copy.
 */
function installFieldContract(root: string): void {
  const contractRelative = 'library/schemas/stage-output-requirements.json'

  mkdirSync(path.join(root, 'library/schemas'), { recursive: true })
  writeFileSync(
    path.join(root, contractRelative),
    readFileSync(path.join(process.cwd(), contractRelative)),
  )
}

function validatorFixtureRoot(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix))

  installFieldContract(root)

  return root
}

function writePlanOutput(
  root: string,
  runId: string,
  criterionIds: string[],
  planAttempt = 1,
): void {
  const outputsDir = path.join(root, 'runtime/logs/workflows', runId, 'outputs')

  mkdirSync(outputsDir, { recursive: true })
  writeFileSync(
    path.join(outputsDir, `plan-${planAttempt}-test.json`),
    `${JSON.stringify({
      data: {
        acceptance_criteria: criterionIds.map((id) => ({ id })),
      },
    })}\n`,
  )
}

function writeAssessment(
  root: string,
  runId: string,
  invocationId: string,
  verdict: 'pass' | 'fail' | 'escalate',
): void {
  const assessmentsDir = path.join(
    root,
    'runtime/logs/workflows',
    runId,
    'assessments',
  )

  mkdirSync(assessmentsDir, { recursive: true })
  writeFileSync(
    path.join(assessmentsDir, `${invocationId}.assessment.json`),
    `${JSON.stringify({ invocation_id: invocationId, verdict })}\n`,
  )
}

test('plan trace rejects criteria without maps_to', () => {
  const root = validatorFixtureRoot('pan-plan-')
  const target = 'output.json'
  const absolute = path.join(root, target)

  mkdirSync(root, { recursive: true })
  writeFileSync(
    absolute,
    `${JSON.stringify({
      data: {
        acceptance_criteria: [
          {
            id: 'AC-01',
            verification: { method: 'unit', expected: 'pass' },
          },
        ],
      },
    })}\n`,
  )

  const result = validatePlanTrace({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'PLAN-001',
      requirement_id: 'plan-trace',
      registry_id: 'PLAN-TRACE-VALIDATE-001',
      arguments: {},
    },
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some((issue) => issue.code === 'plan.maps_to_missing'),
  )
})

const planTraceRequirement = {
  policy_id: 'PLAN-001',
  requirement_id: 'plan-trace',
  registry_id: 'PLAN-TRACE-VALIDATE-001',
  arguments: {},
} as const

function writePlanWithQuestions(
  root: string,
  target: string,
  openQuestions: string[],
  dispositions: unknown[],
  criteria: unknown[] = [
    {
      id: 'AC-01',
      maps_to: ['US-1'],
      verification: { method: 'unit test', expected: 'passes' },
    },
  ],
): void {
  writeFileSync(
    path.join(root, target),
    `${JSON.stringify({
      data: {
        engineering_plan: {
          approach: 'Smallest coherent change.',
          components: [],
          files: [],
          risks: [],
          validation: [],
        },
        product_spec: {
          user_stories: [{ id: 'US-1' }],
          open_questions: openQuestions,
        },
        acceptance_criteria: criteria,
        open_question_dispositions: dispositions,
      },
    })}\n`,
  )
}

test('plan trace accepts dispositions that cite evidence', () => {
  const root = validatorFixtureRoot('pan-plan-disposition-')
  const target = 'output.json'

  writePlanWithQuestions(
    root,
    target,
    ['Q1: What exact contract did the prior change remove?'],
    [
      {
        id: 'Q1',
        disposition: 'resolved',
        answer: 'It removed three gated picker options.',
        evidence: ['git show 9dc16a053 lists the three removed options.'],
      },
    ],
  )

  const result = validatePlanTrace({
    root,
    targetPath: target,
    requirement: planTraceRequirement,
  })

  assert.equal(result.status, 'passed', JSON.stringify(result.issues))

  const noQuestions = 'no-questions.json'

  writePlanWithQuestions(root, noQuestions, [], [])

  const noQuestionsResult = validatePlanTrace({
    root,
    targetPath: noQuestions,
    requirement: planTraceRequirement,
  })

  assert.equal(
    noQuestionsResult.status,
    'passed',
    JSON.stringify(noQuestionsResult.issues),
  )
})

test('plan trace requires a disposition for every open question', () => {
  const root = validatorFixtureRoot('pan-plan-disposition-missing-')
  const target = 'output.json'

  writePlanWithQuestions(
    root,
    target,
    ['Q1: First question?', 'Q2: Second question?'],
    [
      {
        id: 'Q1',
        disposition: 'resolved',
        answer: 'Answered.',
        evidence: ['docs/design.md names the contract.'],
      },
    ],
  )

  const result = validatePlanTrace({
    root,
    targetPath: target,
    requirement: planTraceRequirement,
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === 'plan.disposition_missing' &&
        issue.message.includes('Q2'),
    ),
    JSON.stringify(result.issues),
  )
})

test('plan trace rejects a resolved question with no evidence', () => {
  const root = validatorFixtureRoot('pan-plan-disposition-evidence-')
  const target = 'output.json'

  writePlanWithQuestions(
    root,
    target,
    ['Q1: What did the prior change remove?'],
    [
      {
        id: 'Q1',
        disposition: 'resolved',
        answer: 'Inferred from the current tree.',
        evidence: [],
      },
    ],
  )

  const result = validatePlanTrace({
    root,
    targetPath: target,
    requirement: planTraceRequirement,
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some((issue) => issue.code === 'plan.disposition_evidence'),
  )
})

test('plan trace rejects a criterion asserting an unresolved answer', () => {
  const root = validatorFixtureRoot('pan-plan-disposition-assumed-')
  const target = 'output.json'

  // The livelock shape: the plan admits it does not know, then ratifies the
  // guess as an acceptance criterion anyway.
  writePlanWithQuestions(
    root,
    target,
    ['Q4: Which value wins when the explicit request and the cohort disagree?'],
    [
      {
        id: 'Q4',
        disposition: 'escalated',
        answer: 'The operator must choose the precedence rule.',
        evidence: [],
      },
    ],
    [
      {
        id: 'AC-01',
        maps_to: ['US-1', 'Q4'],
        verification: { method: 'unit test', expected: 'explicit wins' },
      },
    ],
  )

  const result = validatePlanTrace({
    root,
    targetPath: target,
    requirement: planTraceRequirement,
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'plan.criterion_assumes_answer',
    ),
    JSON.stringify(result.issues),
  )
})

test('implementation validator binds acceptance coverage to accepted plan', () => {
  const root = validatorFixtureRoot('pan-impl-accepted-plan-')
  const runId = 'run-impl-accepted-plan'
  const target = `runtime/logs/workflows/${runId}/outputs/implement-1-test.json`
  const absolute = path.join(root, target)
  const acceptedInvocation = 'plan-1-accepted'
  const rejectedInvocation = 'plan-2-rejected'
  const acceptedOutput = `runtime/logs/workflows/${runId}/outputs/plan-1-test.json`
  const rejectedOutput = `runtime/logs/workflows/${runId}/outputs/plan-2-test.json`

  mkdirSync(path.dirname(absolute), { recursive: true })
  writePlanOutput(root, runId, ['AC-OLD'], 1)
  writePlanOutput(root, runId, ['AC-NEW'], 2)
  writeAssessment(root, runId, acceptedInvocation, 'pass')
  writeAssessment(root, runId, rejectedInvocation, 'fail')
  writeFileSync(
    absolute,
    `${JSON.stringify({
      data: {
        implementation: {
          changed_files: [],
          tests_added: [],
          notes: [],
        },
        acceptance_results: [
          {
            id: 'AC-OLD',
            result: 'pass',
            evidence: ['tests/unit/validators-stage-validators.test.ts'],
          },
        ],
      },
    })}\n`,
  )

  const result = validateImplementationClaims({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'DEV-001',
      requirement_id: 'implementation-claims',
      registry_id: 'IMPLEMENTATION-CLAIMS-VALIDATE-001',
      arguments: {},
    },
    runState: {
      stage_history: [
        {
          stage: 'plan',
          outcome: 'success',
          invocation_id: acceptedInvocation,
          output_path: acceptedOutput,
        },
        {
          stage: 'plan',
          outcome: 'success',
          invocation_id: rejectedInvocation,
          output_path: rejectedOutput,
        },
      ],
    },
  })

  assert.equal(result.status, 'passed')
  assert.ok(
    !result.issues.some((issue) => issue.code === 'acceptance.coverage'),
  )
  assert.ok(!result.issues.some((issue) => issue.code === 'acceptance.unknown'))
})

test('implementation validator rejects missing plan acceptance coverage', () => {
  const root = validatorFixtureRoot('pan-impl-coverage-')
  const runId = 'run-impl-coverage'
  const target = `runtime/logs/workflows/${runId}/outputs/implement-1-test.json`
  const absolute = path.join(root, target)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writePlanOutput(root, runId, ['AC-01', 'AC-02'])
  // AC-02 is planned but unreported, and AC-99 is reported but never planned.
  writeFileSync(
    absolute,
    `${JSON.stringify({
      data: {
        implementation: {
          changed_files: [],
          tests_added: [],
          notes: [],
        },
        acceptance_results: [
          { id: 'AC-01', result: 'pass', evidence: ['x'] },
          { id: 'AC-99', result: 'pass', evidence: ['y'] },
        ],
      },
    })}\n`,
  )

  const result = validateImplementationClaims({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'DEV-001',
      requirement_id: 'implementation-claims',
      registry_id: 'IMPLEMENTATION-CLAIMS-VALIDATE-001',
      arguments: {},
    },
  })

  assert.equal(result.status, 'failed')
  assert.ok(result.issues.some((issue) => issue.code === 'acceptance.coverage'))
  assert.ok(result.issues.some((issue) => issue.code === 'acceptance.unknown'))
})

test('implementation validator rejects opaque acceptance evidence', () => {
  const root = validatorFixtureRoot('pan-impl-evidence-shape-')
  const target = 'runtime/logs/workflows/run/outputs/implement.json'
  const absolute = path.join(root, target)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(
    absolute,
    `${JSON.stringify({
      data: {
        implementation: {
          changed_files: [],
          tests_added: [],
          notes: [],
        },
        acceptance_results: [
          { id: 'AC-01', result: 'pass', evidence: ['opaque'] },
        ],
      },
    })}\n`,
  )

  const result = validateImplementationClaims({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'DEV-001',
      requirement_id: 'implementation-claims',
      registry_id: 'IMPLEMENTATION-CLAIMS-VALIDATE-001',
      arguments: {},
    },
  })

  assert.ok(
    result.issues.some((entry) => entry.code === 'acceptance.evidence_shape'),
  )
})

test('shared stage field contract has registered validator ownership', () => {
  // The validator reads only checked-in files, so the checkout that runs
  // the test is the fixture.
  const root = process.cwd()
  const result = validateSharedFieldContract({
    root,
    targetPath: 'library/schemas/stage-output-requirements.json',
    requirement: {
      policy_id: 'CONTRACT-001',
      requirement_id: 'shared-stage-field-contract',
      registry_id: 'FIELD-CONTRACT-VALIDATE-001',
      arguments: {},
    },
  })

  assert.equal(result.status, 'passed')
})

test('implementation retry requires explicit remediation evidence', () => {
  const root = validatorFixtureRoot('pan-impl-remediation-')
  const target = 'output.json'

  writeFileSync(
    path.join(root, target),
    `${JSON.stringify({
      data: {
        implementation: {
          changed_files: [],
          tests_added: [],
          notes: [],
        },
        acceptance_results: [
          { id: 'AC-01', result: 'pass', evidence: ['verified'] },
        ],
      },
    })}\n`,
  )

  const result = validateImplementationClaims({
    root,
    targetPath: target,
    invocation: { attempt: 2 },
    requirement: {
      policy_id: 'DEV-001',
      requirement_id: 'implementation-claims',
      registry_id: 'IMPLEMENTATION-CLAIMS-VALIDATE-001',
      arguments: {},
    },
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'implementation.remediation_missing',
    ),
  )
})

test('implementation retry accepts targeted remediation evidence', () => {
  const root = validatorFixtureRoot('pan-impl-remediation-pass-')
  const target = 'output.json'

  writeFileSync(
    path.join(root, target),
    `${JSON.stringify({
      data: {
        implementation: {
          changed_files: [],
          tests_added: [],
          notes: [],
          remediation: [
            {
              cause: 'implement.lint reported a new diagnostic',
              action: 'Corrected the offending implementation path',
              evidence: ['runtime/logs/workflows/run/evidence/lint.log'],
            },
          ],
        },
        acceptance_results: [
          { id: 'AC-01', result: 'pass', evidence: ['verified'] },
        ],
      },
    })}\n`,
  )

  const result = validateImplementationClaims({
    root,
    targetPath: target,
    invocation: { attempt: 2 },
    requirement: {
      policy_id: 'DEV-001',
      requirement_id: 'implementation-claims',
      registry_id: 'IMPLEMENTATION-CLAIMS-VALIDATE-001',
      arguments: {},
    },
  })

  assert.ok(
    !result.issues.some((issue) =>
      issue.code.startsWith('implementation.remediation'),
    ),
  )
})

test('implementation validator fails closed when git is unavailable', () => {
  const root = validatorFixtureRoot('pan-impl-git-')
  const target = 'output.json'
  const absolute = path.join(root, target)

  mkdirSync(root, { recursive: true })
  writeFileSync(
    absolute,
    `${JSON.stringify({
      data: {
        implementation: {
          changed_files: ['src/example.ts'],
          tests_added: [],
          notes: [],
        },
        acceptance_results: [{ id: 'AC-01', result: 'pass', evidence: ['x'] }],
      },
    })}\n`,
  )

  const result = validateImplementationClaims({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'DEV-001',
      requirement_id: 'implementation-claims',
      registry_id: 'IMPLEMENTATION-CLAIMS-VALIDATE-001',
      arguments: {},
    },
  })

  assert.equal(result.status, 'failed')
  assert.ok(result.issues.some((issue) => issue.code === 'git.unavailable'))
})

test('release validator requires structured change-list entries', () => {
  const root = validatorFixtureRoot('pan-release-change-list-')
  const target = 'output.json'

  writeFileSync(
    path.join(root, target),
    `${JSON.stringify({
      data: {
        release: {
          summary: 'ready',
          change_list: ['src/example.ts'],
          validation: [],
          rollback: 'revert commit',
          waivers: [],
          follow_up_cases: [],
          governance_artifact_review: {
            issues_reviewed: [],
            repairs: [],
            escalations: [],
            summary: 'No issues.',
          },
          deferred_acceptance_criteria: [],
          commit_message: 'Release',
          pr_body: 'Release',
        },
      },
    })}\n`,
  )

  const result = validateReleaseOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'SHIP-001',
      requirement_id: 'release-validate',
      registry_id: 'RELEASE-VALIDATE-001',
      arguments: {},
    },
  })

  assert.ok(
    result.issues.some((issue) => issue.code === 'release.change_list_shape'),
  )
})

test('release validator diffs the declared workspace instead of its dirty parent', () => {
  const root = validatorFixtureRoot('pan-release-worktree-')
  const workspaceRoot = path.join(root, 'declared-worktree')
  const target = 'output.json'
  const changedFile = 'src/example.ts'

  execFileSync('git', ['init'], { cwd: root })
  writeFileSync(path.join(root, 'parent.txt'), 'before\n')
  execFileSync('git', ['add', 'parent.txt'], { cwd: root })
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Pancreator Tests',
      '-c',
      'user.email=tests@example.com',
      'commit',
      '-m',
      'parent baseline',
    ],
    { cwd: root },
  )
  writeFileSync(path.join(root, 'parent.txt'), 'dirty parent\n')

  mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true })
  execFileSync('git', ['init'], { cwd: workspaceRoot })
  writeFileSync(
    path.join(workspaceRoot, changedFile),
    'export const value = 1\n',
  )
  execFileSync('git', ['add', changedFile], { cwd: workspaceRoot })
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Pancreator Tests',
      '-c',
      'user.email=tests@example.com',
      'commit',
      '-m',
      'workspace baseline',
    ],
    { cwd: workspaceRoot },
  )
  writeFileSync(
    path.join(workspaceRoot, changedFile),
    'export const value = 2\n',
  )

  writeFileSync(
    path.join(root, target),
    `${JSON.stringify({
      data: {
        release: {
          summary: 'ready',
          change_list: [
            {
              path: changedFile,
              kind: 'modified',
              description: 'Updates the example value.',
            },
          ],
          validation: [],
          rollback: 'revert commit',
          waivers: [],
          follow_up_cases: [],
          governance_artifact_review: {
            issues_reviewed: [],
            repairs: [],
            escalations: [],
            summary: 'No issues.',
          },
          deferred_acceptance_criteria: [],
          commit_message: 'Release',
          pr_body: 'Release',
        },
      },
    })}\n`,
  )

  const result = validateReleaseOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'SHIP-001',
      requirement_id: 'release-validate',
      registry_id: 'RELEASE-VALIDATE-001',
      arguments: {},
    },
    runState: {
      workspace_root: 'declared-worktree',
    },
  })
  const issueCodes = new Set(result.issues.map((entry) => entry.code))

  assert.equal(issueCodes.has('release.change_list_shape'), false)
  assert.equal(issueCodes.has('release.change_not_in_diff'), false)
  assert.equal(issueCodes.has('release.diff_not_disclosed'), false)
})

test('release validator rejects unknown validation fingerprints', () => {
  const root = validatorFixtureRoot('pan-release-fp-')
  const target = 'output.json'
  const absolute = path.join(root, target)

  mkdirSync(root, { recursive: true })
  writeFileSync(
    absolute,
    `${JSON.stringify({
      data: {
        release: {
          summary: 'ready',
          change_list: [],
          validation: [
            {
              stage: 'review',
              workspace_fingerprint: 'fp-not-in-history',
              evidence_path: 'missing/path.json',
            },
          ],
          rollback: 'revert commit',
          waivers: [],
          follow_up_cases: [],
        },
      },
    })}\n`,
  )

  const result = validateReleaseOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'SHIP-001',
      requirement_id: 'release-validate',
      registry_id: 'RELEASE-VALIDATE-001',
      arguments: {},
    },
    runState: {
      stage_history: [
        {
          stage: 'review',
          workspace_fingerprint: 'fp-review',
        },
      ],
    },
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'release.validation_fingerprint_unknown',
    ),
  )
  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'release.validation_evidence_missing',
    ),
  )
})

test('self-development release validator requires a real next-version bump', () => {
  const root = createFixture()
  const target = 'output.json'
  const currentVersion = readFileSync(path.join(root, 'VERSION'), 'utf8').trim()
  const baselineCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim()

  writeFileSync(
    path.join(root, target),
    `${JSON.stringify({
      data: {
        release: {
          summary: 'ready',
          versioning: {
            current_version: currentVersion,
            recommendation: 'patch',
            proposed_version: currentVersion,
            baseline_commit: baselineCommit,
            rationale: 'fixture',
            compatibility: 'backward compatible',
            updated_files: [
              'CHANGELOG.md',
              'README.md',
              'VERSION',
              'docs/embedded-installation.md',
              'package-lock.json',
              'package.json',
            ],
            release_index_action: 'Index after the release commit exists.',
          },
          change_list: [],
          validation: [],
          rollback: 'revert commit',
          waivers: [],
          follow_up_cases: [],
        },
      },
    })}\n`,
  )

  const result = validateReleaseOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'VERSION-001',
      requirement_id: 'release-validate',
      registry_id: 'RELEASE-VALIDATE-001',
      arguments: {},
    },
    runState: { stage_history: [] },
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'release.proposed_version_mismatch',
    ),
  )

  writeFileSync(
    path.join(root, target),
    `${JSON.stringify({
      data: {
        release: {
          summary: 'ready',
          versioning: {
            current_version: '0.0.0',
            recommendation: 'patch',
            proposed_version: '0.0.1',
            baseline_commit: baselineCommit,
            rationale: '',
            compatibility: '',
            updated_files: [
              'CHANGELOG.md',
              'README.md',
              'VERSION',
              'docs/embedded-installation.md',
              'package-lock.json',
              'package.json',
              'src/index.ts',
            ],
            release_index_action: '',
          },
          change_list: [],
          validation: [],
          rollback: 'revert commit',
          waivers: [],
          follow_up_cases: [],
        },
      },
    })}\n`,
  )

  const historyResult = validateReleaseOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'VERSION-001',
      requirement_id: 'release-validate',
      registry_id: 'RELEASE-VALIDATE-001',
      arguments: {},
    },
    runState: { stage_history: [] },
  })

  assert.equal(historyResult.status, 'failed')
  for (const code of [
    'release.current_version_mismatch',
    'release.baseline_version_mismatch',
    'release.rationale_missing',
    'release.compatibility_missing',
    'release.index_action_missing',
    'release.updated_file_out_of_scope',
  ]) {
    assert.ok(
      historyResult.issues.some((issue) => issue.code === code),
      code,
    )
  }
})

test('release validator rejects waiver fingerprint mismatch', () => {
  const root = validatorFixtureRoot('pan-release-waiver-')
  const target = 'output.json'
  const absolute = path.join(root, target)
  const artifactPath =
    'runtime/logs/workflows/run-1/artifacts/markdown/review-waiver.md'

  mkdirSync(path.dirname(path.join(root, artifactPath)), { recursive: true })
  writeFileSync(path.join(root, artifactPath), '# waiver\n')
  writeFileSync(
    absolute,
    `${JSON.stringify({
      data: {
        release: {
          summary: 'ready',
          change_list: [],
          validation: [],
          rollback: 'revert commit',
          waivers: [
            {
              waiver_id: 'waiver-review',
              workspace_fingerprint: 'fp-wrong',
            },
          ],
          follow_up_cases: [],
        },
      },
    })}\n`,
  )

  const result = validateReleaseOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'SHIP-001',
      requirement_id: 'release-validate',
      registry_id: 'RELEASE-VALIDATE-001',
      arguments: {},
    },
    invocation: {
      workspace_before: {
        fingerprint: 'fp-actual',
      },
    },
    runState: {
      stage_history: [
        {
          stage: 'review',
          invocation_id: 'review-1',
          workspace_fingerprint: 'fp-actual',
        },
      ],
      operator_gate_waivers: [
        {
          waiver_id: 'waiver-review',
          stage: 'review',
          source_invocation_id: 'review-1',
          source_attempt: 1,
          workspace_fingerprint: 'fp-actual',
          artifact_path: artifactPath,
          source_evidence_path: artifactPath,
          criterion_ids: ['review.complete'],
          note: 'accepted risk',
          deferred_acceptance_criteria: [],
          timestamp: '2026-06-26T12:00:00.000Z',
        },
      ],
    },
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'release.waiver_fingerprint_mismatch',
    ),
  )
})

test('release validator ignores waivers superseded by a later attempt', () => {
  const root = validatorFixtureRoot('pan-release-stale-waiver-')
  const target = 'output.json'
  const absolute = path.join(root, target)
  const artifactPath =
    'runtime/logs/workflows/run-1/artifacts/markdown/review-waiver.md'

  mkdirSync(path.dirname(path.join(root, artifactPath)), { recursive: true })
  writeFileSync(path.join(root, artifactPath), '# waiver\n')
  writeFileSync(
    absolute,
    `${JSON.stringify({
      data: {
        release: {
          summary: 'ready',
          change_list: [],
          validation: [],
          rollback: 'revert commit',
          waivers: [],
          follow_up_cases: [],
        },
      },
    })}\n`,
  )

  const result = validateReleaseOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'SHIP-001',
      requirement_id: 'release-validate',
      registry_id: 'RELEASE-VALIDATE-001',
      arguments: {},
    },
    invocation: {
      workspace_before: {
        fingerprint: 'fp-current',
      },
    },
    runState: {
      stage_history: [
        {
          stage: 'review',
          invocation_id: 'review-1',
          workspace_fingerprint: 'fp-old',
        },
        {
          stage: 'review',
          invocation_id: 'review-2',
          workspace_fingerprint: 'fp-current',
        },
      ],
      operator_gate_waivers: [
        {
          waiver_id: 'waiver-review-old',
          stage: 'review',
          source_invocation_id: 'review-1',
          source_attempt: 1,
          workspace_fingerprint: 'fp-old',
          artifact_path: artifactPath,
          source_evidence_path: artifactPath,
          criterion_ids: ['review.complete'],
          note: 'superseded',
          deferred_acceptance_criteria: [],
          timestamp: '2026-06-26T12:00:00.000Z',
        },
      ],
    },
  })

  assert.ok(
    !result.issues.some((issue) => issue.code === 'release.waiver_undisclosed'),
  )
})

test('assessment validator requires exact judgment criterion coverage', () => {
  const root = validatorFixtureRoot('pan-assess-')
  const target = 'assessment.json'
  const absolute = path.join(root, target)

  mkdirSync(root, { recursive: true })
  writeFileSync(
    absolute,
    `${JSON.stringify({
      schema_version: 1,
      assessment_id: 'a1',
      invocation_id: 'p1',
      verdict: 'pass',
      summary: 'ok',
      criteria: [
        {
          id: 'plan.complete_mapping',
          result: 'pass',
          evidence: ['x'],
          explanation: 'ok',
        },
      ],
    })}\n`,
  )

  const result = validateAssessment({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'ORCH-001',
      requirement_id: 'assessment',
      registry_id: 'ASSESSMENT-VALIDATE-001',
      arguments: {},
    },
    invocation: {
      rubric: [
        { id: 'plan.complete_mapping', type: 'judgment' },
        { id: 'plan.implementation_ready', type: 'judgment' },
      ],
    },
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'assessment.missing_criterion',
    ),
  )
})

const SPOTFIX_OUTCOME = `# Spotfix outcome

Validation cycle 1 completed with npm run lint.
`

function writeSpotfixChangedFiles(root: string, relativePaths: string[]): void {
  const forceAdd: string[] = []

  for (const relativePath of relativePaths) {
    const absolute = path.join(root, relativePath)

    mkdirSync(path.dirname(absolute), { recursive: true })
    writeFileSync(absolute, `fixture ${relativePath}\n`)

    if (relativePath.startsWith('.cursor/')) {
      forceAdd.push(relativePath)
    }
  }

  const ordinary = relativePaths.filter((file) => !file.startsWith('.cursor/'))

  if (ordinary.length > 0) {
    execFileSync('git', ['add', ...ordinary], { cwd: root })
  }

  if (forceAdd.length > 0) {
    execFileSync('git', ['add', '-f', ...forceAdd], { cwd: root })
  }
}

test('spotfix diff_bounded exempts WORK-001 documentation and projection files', () => {
  const root = createFixture()
  const target = 'runtime/inbox/spotfix-outcome.md'

  writeSpotfixChangedFiles(root, [
    'docs/one.md',
    'library/personas/two.md',
    'tests/three.test.ts',
    'library/workflows/note.md',
  ])
  writeFileSync(path.join(root, target), SPOTFIX_OUTCOME)

  const result = validateSpotfixOutcome({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'SPOT-001',
      requirement_id: 'spotfix-validate',
      registry_id: 'SPOTFIX-VALIDATE-001',
      arguments: {},
    },
  })

  assert.equal(result.status, 'passed')
  assert.ok(
    !result.issues.some((issue) => issue.code === 'spotfix.diff_bounded'),
  )
})

test('spotfix diff_bounded still fails when more than three implementation files change', () => {
  const root = createFixture()
  const target = 'runtime/inbox/spotfix-outcome.md'

  writeSpotfixChangedFiles(root, [
    'src/one.ts',
    'src/two.ts',
    'src/three.ts',
    'src/four.ts',
  ])
  writeFileSync(path.join(root, target), SPOTFIX_OUTCOME)

  const result = validateSpotfixOutcome({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'SPOT-001',
      requirement_id: 'spotfix-validate',
      registry_id: 'SPOTFIX-VALIDATE-001',
      arguments: {},
    },
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some((issue) => issue.code === 'spotfix.diff_bounded'),
  )
})

test('spotfix diff_bounded does not exempt implementation files under test-like directories', () => {
  const files = [
    'src/.test.fixtures/one.ts',
    'src/.test.fixtures/two.ts',
    'src/.test.fixtures/three.ts',
    'src/.test.fixtures/four.ts',
  ]

  for (const file of files) {
    assert.equal(isSpotfixDiffExempt(file), false, file)
  }
  assert.ok(files.filter((file) => !isSpotfixDiffExempt(file)).length > 3)
})

test('spotfix diff_bounded exempts projected .cursor paths', () => {
  const files = [
    'docs/one.md',
    'tests/two.test.ts',
    'src/one.ts',
    'src/two.ts',
    'src/three.ts',
    '.cursor/rules/four.mdc',
  ]

  assert.equal(isSpotfixDiffExempt('docs/one.md'), true)
  assert.equal(isSpotfixDiffExempt('tests/two.test.ts'), true)
  assert.equal(isSpotfixDiffExempt('.cursor/rules/four.mdc'), true)
  assert.equal(isSpotfixDiffExempt('src/one.ts'), false)
  assert.equal(isSpotfixDiffExempt('src/two.ts'), false)
  assert.equal(isSpotfixDiffExempt('src/three.ts'), false)
  assert.equal(files.filter((file) => !isSpotfixDiffExempt(file)).length, 3)
})

test('spotfix diff_bounded counts only non-exempt files in mixed diffs', () => {
  const files = [
    'docs/one.md',
    'tests/two.test.ts',
    'library/workflows/note.md',
    'src/one.ts',
    'src/two.ts',
  ]

  assert.equal(isSpotfixDiffExempt('docs/one.md'), true)
  assert.equal(isSpotfixDiffExempt('tests/two.test.ts'), true)
  assert.equal(isSpotfixDiffExempt('library/workflows/note.md'), true)
  assert.equal(isSpotfixDiffExempt('src/one.ts'), false)
  assert.equal(isSpotfixDiffExempt('src/two.ts'), false)
  assert.equal(files.filter((file) => !isSpotfixDiffExempt(file)).length, 2)
})

test('implementation validator resolves the file portion of "path :: case" test entries', () => {
  const root = validatorFixtureRoot('pan-impl-test-entry-')
  const runId = 'run-impl-test-entry'
  const target = `runtime/logs/workflows/${runId}/outputs/implement-1-test.json`
  const absolute = path.join(root, target)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writePlanOutput(root, runId, ['AC-01'])
  mkdirSync(path.join(root, 'tests'), { recursive: true })
  writeFileSync(path.join(root, 'tests', 'sample.test.ts'), 'test\n')
  writeFileSync(path.join(root, 'tests', 'test_provenance.py'), 'test\n')
  writeFileSync(
    absolute,
    `${JSON.stringify({
      data: {
        implementation: {
          changed_files: [],
          tests_added: [
            'tests/sample.test.ts :: a named case inside the file',
            'tests/missing.test.ts :: another case',
            // Run 63315 workers repeatedly submitted this native pytest form
            // and the parser treated the entire node id as a path.
            'tests/test_provenance.py::test_clo_fixture_validates',
            'tests/test_provenance.py::TestSave::test_rejects_invalid',
            'tests/test_provenance.py :: display form of the same file',
            'tests/gone.py::test_case',
          ],
          notes: [],
        },
        acceptance_results: [{ id: 'AC-01', result: 'pass', evidence: ['x'] }],
      },
    })}\n`,
  )

  const result = validateImplementationClaims({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'DEV-001',
      requirement_id: 'implementation-claims',
      registry_id: 'IMPLEMENTATION-CLAIMS-VALIDATE-001',
      arguments: {},
    },
  })

  // The ' :: ' display convention and the native `path::case` form resolve to
  // the same file, so only the missing files are reported.
  const missing = result.issues.filter(
    (issue) => issue.code === 'claim.test_missing',
  )

  assert.equal(missing.length, 2)

  const missingDisplay = missing.find((issue) =>
    /tests\/missing\.test\.ts/u.test(issue.message),
  )
  const missingNative = missing.find((issue) =>
    /tests\/gone\.py/u.test(issue.message),
  )

  assert.ok(missingDisplay)
  assert.doesNotMatch(missingDisplay.message, /tests\/sample\.test\.ts :: /u)
  assert.ok(missingNative)
  assert.match(missingNative.message, /Entries MUST be/u)
})

test('target instruction coverage demands final-line read evidence per path', () => {
  // The validator needs only an instruction file and the JSON output, so a
  // bare temporary directory is enough.
  const root = mkdtempSync(path.join(tmpdir(), 'pan-target-coverage-'))
  const target = 'runtime/output.json'

  writeFileSync(
    path.join(root, 'AGENTS.md'),
    '# Target instructions\n\nRead this file before changing src/.\n',
  )
  const requirement = {
    policy_id: 'DEV-001',
    requirement_id: 'target-instruction-coverage',
    registry_id: 'TARGET-INSTRUCTION-COVERAGE-VALIDATE-001',
    arguments: {},
  }
  const invocation = {
    workspace_before: { kind: 'filesystem' },
    inputs: {
      target_instructions: {
        changed_paths: ['src/base.ts'],
        read_paths: ['AGENTS.md'],
      },
    },
  }
  const agentsLines = readFileSync(path.join(root, 'AGENTS.md'), 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
  const finalLine = agentsLines[agentsLines.length - 1]

  mkdirSync(path.join(root, 'runtime'), { recursive: true })

  writeFileSync(
    path.join(root, target),
    `${JSON.stringify({
      target_instruction_evidence: { read_paths: [] },
    })}\n`,
  )

  const omitted = validateTargetInstructionCoverage({
    root,
    targetPath: target,
    requirement,
    invocation,
  })

  assert.equal(omitted.status, 'failed')
  assert.ok(
    omitted.issues.some(
      (item) =>
        item.code === 'TARGET_INSTRUCTION_COVERAGE_MISSING' &&
        item.message.includes('AGENTS.md'),
    ),
  )

  // A path list alone is copyable from the card, so it is not read evidence.
  writeFileSync(
    path.join(root, target),
    `${JSON.stringify({
      target_instruction_evidence: { read_paths: ['AGENTS.md'] },
    })}\n`,
  )

  const withoutReads = validateTargetInstructionCoverage({
    root,
    targetPath: target,
    requirement,
    invocation,
  })

  assert.equal(withoutReads.status, 'failed')
  assert.ok(
    withoutReads.issues.some(
      (item) => item.code === 'TARGET_INSTRUCTION_READ_EVIDENCE_MISSING',
    ),
  )

  // A wrong quote fails: the line validates against the file on disk.
  writeFileSync(
    path.join(root, target),
    `${JSON.stringify({
      target_instruction_evidence: {
        read_paths: ['AGENTS.md'],
        reads: [{ path: 'AGENTS.md', final_line: 'not the closing line' }],
      },
    })}\n`,
  )

  const misquoted = validateTargetInstructionCoverage({
    root,
    targetPath: target,
    requirement,
    invocation,
  })

  assert.equal(misquoted.status, 'failed')
  assert.ok(
    misquoted.issues.some(
      (item) => item.code === 'TARGET_INSTRUCTION_READ_EVIDENCE_MISMATCH',
    ),
  )

  // The verbatim closing line of the file passes.
  writeFileSync(
    path.join(root, target),
    `${JSON.stringify({
      target_instruction_evidence: {
        read_paths: ['AGENTS.md'],
        reads: [{ path: 'AGENTS.md', final_line: finalLine }],
      },
    })}\n`,
  )

  const quoted = validateTargetInstructionCoverage({
    root,
    targetPath: target,
    requirement,
    invocation,
  })

  assert.equal(quoted.status, 'passed', JSON.stringify(quoted.issues))
})

function verifyRequirement() {
  return {
    policy_id: 'VERIFY-001',
    requirement_id: 'verify',
    registry_id: 'VERIFY-VALIDATE-001',
    arguments: {},
  }
}

function writeVerifyOutput(
  root: string,
  target: string,
  verify: Record<string, unknown>,
  result = 'success',
): void {
  const absolute = path.join(root, target)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, `${JSON.stringify({ result, data: { verify } })}\n`)
}

const passingQaCase = {
  id: 'TP-01',
  steps: 'Run the fixture',
  expected: 'advance',
  actual: 'advance',
  result: 'pass',
}

test('verify validator rejects a passing verdict with a blocker finding', () => {
  const root = validatorFixtureRoot('pan-verify-blocker-')
  const target = 'output.json'

  writeVerifyOutput(root, target, {
    verdict: 'pass',
    findings: [
      {
        id: 'VF-1',
        severity: 'blocker',
        source: 'qa',
        statement: 'The run stalls.',
        evidence: ['fixture'],
      },
    ],
    qa_cases: [passingQaCase],
    acceptance_results: [{ id: 'AC-01', result: 'pass' }],
  })

  const result = validateVerifyOutput({
    root,
    targetPath: target,
    requirement: verifyRequirement(),
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some((item) => item.code === 'verify.verdict_inconsistent'),
  )

  const warnless = 'warnless.json'

  writeVerifyOutput(root, warnless, {
    verdict: 'pass_with_warnings',
    findings: [],
    qa_cases: [passingQaCase],
    acceptance_results: [{ id: 'AC-01', result: 'pass' }],
  })

  const warnlessResult = validateVerifyOutput({
    root,
    targetPath: warnless,
    requirement: verifyRequirement(),
  })

  assert.equal(warnlessResult.status, 'failed')
  assert.ok(
    warnlessResult.issues.some(
      (item) => item.code === 'verify.verdict_inconsistent',
    ),
  )
})

test('verify validator requires rationale and guidance for fail_severe', () => {
  const root = validatorFixtureRoot('pan-verify-severe-')
  const target = 'output.json'

  writeVerifyOutput(
    root,
    target,
    {
      verdict: 'fail_severe',
      findings: [
        {
          id: 'VF-1',
          severity: 'blocker',
          source: 'review',
          statement: 'The approach cannot meet AC-01.',
          evidence: ['fixture'],
        },
      ],
      qa_cases: [{ ...passingQaCase, actual: 'stalled', result: 'fail' }],
      acceptance_results: [{ id: 'AC-01', result: 'fail' }],
    },
    'failure',
  )

  const bare = validateVerifyOutput({
    root,
    targetPath: target,
    requirement: verifyRequirement(),
  })

  const bareCodes = bare.issues.map((item) => item.code)

  assert.equal(bare.status, 'failed')
  assert.ok(bareCodes.includes('verify.remediation_guidance'))
  assert.ok(bareCodes.includes('verify.severity_rationale'))

  writeVerifyOutput(
    root,
    target,
    {
      verdict: 'fail_severe',
      findings: [
        {
          id: 'VF-1',
          severity: 'blocker',
          source: 'review',
          statement: 'The approach cannot meet AC-01.',
          evidence: ['fixture'],
        },
      ],
      qa_cases: [{ ...passingQaCase, actual: 'stalled', result: 'fail' }],
      acceptance_results: [{ id: 'AC-01', result: 'fail' }],
      remediation_guidance: 'Rerun the fixture; it stalls before ship.',
      severity_rationale: 'The chosen approach cannot satisfy AC-01.',
    },
    'failure',
  )

  const complete = validateVerifyOutput({
    root,
    targetPath: target,
    requirement: verifyRequirement(),
  })

  assert.equal(complete.status, 'passed', JSON.stringify(complete.issues))
})

test('verify validator binds acceptance coverage to the accepted plan', () => {
  const root = validatorFixtureRoot('pan-verify-plan-coverage-')
  const runId = 'run-verify-coverage'
  const target = `runtime/logs/workflows/${runId}/outputs/verify-1-test.json`

  writePlanOutput(root, runId, ['AC-01', 'AC-02'])
  writeVerifyOutput(root, target, {
    verdict: 'pass',
    findings: [],
    qa_cases: [passingQaCase],
    acceptance_results: [{ id: 'AC-01', result: 'pass' }],
  })

  const result = validateVerifyOutput({
    root,
    targetPath: target,
    requirement: verifyRequirement(),
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (item) =>
        item.code === 'verify.acceptance_missing' &&
        item.message.includes('AC-02'),
    ),
  )
})

test('verify validator requires a citation for each current gate evidence reference', () => {
  const root = validatorFixtureRoot('pan-verify-gate-citation-')
  const target = 'output.json'
  const invocation = {
    inputs: {
      references: [
        {
          path: 'runtime/logs/workflows/run/evidence/implement-1.fast.log',
          description: 'Passed `fast` repository-check gate evidence',
          gate_evidence: {
            profile: 'fast',
            fingerprint: 'fp-1',
            current: true,
          },
        },
        {
          path: 'runtime/logs/workflows/run/evidence/pre-implementation-static.json',
          description: 'Passed `static` repository-check gate evidence',
          gate_evidence: {
            profile: 'static',
            fingerprint: 'fp-0',
            current: false,
          },
        },
      ],
    },
  }

  writeVerifyOutput(root, target, {
    verdict: 'pass',
    findings: [],
    qa_cases: [passingQaCase],
    acceptance_results: [{ id: 'AC-01', result: 'pass' }],
    gate_evidence_citations: [{ profile: 'fast', fingerprint: '' }],
  })

  const missing = validateVerifyOutput({
    root,
    targetPath: target,
    requirement: verifyRequirement(),
    invocation,
  })
  const missingCodes = missing.issues.map((item) => item.code)

  assert.equal(missing.status, 'failed')
  assert.ok(missingCodes.includes('verify.gate_citation_shape'))
  assert.ok(
    missing.issues.some(
      (item) =>
        item.code === 'verify.gate_citation_missing' &&
        item.message.includes('`fast`') &&
        item.message.includes('fp-1'),
    ),
  )
  // The superseded static evidence is not current, so it needs no citation.
  assert.ok(
    !missing.issues.some(
      (item) =>
        item.code === 'verify.gate_citation_missing' &&
        item.message.includes('`static`'),
    ),
  )

  writeVerifyOutput(root, target, {
    verdict: 'pass',
    findings: [],
    qa_cases: [passingQaCase],
    acceptance_results: [{ id: 'AC-01', result: 'pass' }],
    gate_evidence_citations: [
      {
        profile: 'fast',
        fingerprint: 'fp-1',
        evidence_path:
          'runtime/logs/workflows/run/evidence/implement-1.fast.log',
      },
    ],
  })

  const cited = validateVerifyOutput({
    root,
    targetPath: target,
    requirement: verifyRequirement(),
    invocation,
  })

  assert.equal(cited.status, 'passed', JSON.stringify(cited.issues))
})

test('verify validator rejects a QA case whose steps rerun a configured profile', () => {
  const root = validatorFixtureRoot('pan-verify-profile-rerun-')
  const target = 'output.json'

  mkdirSync(path.join(root, 'runtime'), { recursive: true })
  writeFileSync(
    path.join(root, 'runtime', 'repository-checks.json'),
    `${JSON.stringify({
      schema_version: 1,
      setup: [],
      profiles: {
        fast: { description: 'fast', probes: [], commands: ['npm test'] },
        static: {
          description: 'static',
          probes: [],
          commands: ['npm run lint'],
        },
      },
    })}\n`,
  )

  const cases = [
    {
      ...passingQaCase,
      id: 'TP-CMD',
      steps: 'Run `npm test` and read the summary',
    },
    {
      ...passingQaCase,
      id: 'TP-PAN',
      steps: 'Run ./bin/pan repository-check static',
    },
    {
      ...passingQaCase,
      id: 'TP-OK',
      steps: 'Run npm run test:unit -- --grep gate',
    },
  ]

  writeVerifyOutput(root, target, {
    verdict: 'pass',
    findings: [],
    qa_cases: cases,
    acceptance_results: [{ id: 'AC-01', result: 'pass' }],
  })

  const result = validateVerifyOutput({
    root,
    targetPath: target,
    requirement: verifyRequirement(),
  })
  const reruns = result.issues.filter(
    (item) => item.code === 'verify.case_reruns_profile',
  )

  assert.equal(result.status, 'failed')
  assert.deepEqual(reruns.map((item) => item.message.split(' ')[2]).sort(), [
    'TP-CMD',
    'TP-PAN',
  ])
  assert.ok(reruns.some((item) => item.message.includes('`fast`')))
  assert.ok(reruns.some((item) => item.message.includes('`static`')))
})

test('plan trace rejects a test-plan case that reruns a profile', () => {
  const root = validatorFixtureRoot('pan-plan-profile-rerun-')
  const target = 'output.json'

  mkdirSync(path.join(root, 'runtime'), { recursive: true })
  writeFileSync(
    path.join(root, 'runtime', 'repository-checks.json'),
    `${JSON.stringify({
      schema_version: 1,
      setup: [],
      profiles: {
        fast: { description: 'fast', probes: [], commands: ['npm test'] },
      },
    })}\n`,
  )
  writeFileSync(
    path.join(root, target),
    `${JSON.stringify({
      data: {
        acceptance_criteria: [
          {
            id: 'AC-01',
            maps_to: ['US-01'],
            verification: { method: 'test', expected: 'passes' },
          },
        ],
        product_spec: { user_stories: [{ id: 'US-01' }] },
        test_plan: [
          { id: 'TP-SUITE', criterion: 'AC-01', action: 'Run npm test' },
          {
            id: 'TP-LITERAL',
            criterion: 'AC-01',
            action: 'Run pan repository-check secondary',
          },
          {
            id: 'TP-FOCUSED',
            criterion: 'AC-01',
            action: 'Run node --test dist/tests/unit/plan.test.js',
          },
        ],
      },
    })}\n`,
  )

  const result = validatePlanTrace({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'PLAN-001',
      requirement_id: 'plan',
      registry_id: 'PLAN-TRACE-VALIDATE-001',
      arguments: {},
    },
  })
  const reruns = result.issues.filter(
    (item) => item.code === 'plan.case_reruns_profile',
  )

  assert.equal(result.status, 'failed')
  assert.deepEqual(reruns.map((item) => item.message.split(' ')[2]).sort(), [
    'TP-LITERAL',
    'TP-SUITE',
  ])
  assert.ok(reruns.some((item) => item.message.includes('`fast`')))
  assert.ok(reruns.some((item) => item.message.includes('`secondary`')))
})

function claimsValidatorInput(
  root: string,
  target: string,
  invocation?: Record<string, unknown>,
) {
  return {
    root,
    targetPath: target,
    requirement: {
      policy_id: 'DEV-001',
      requirement_id: 'implementation-claims',
      registry_id: 'IMPLEMENTATION-CLAIMS-VALIDATE-001',
      arguments: {},
    },
    ...(invocation ? { invocation } : {}),
  }
}

function writeImplementOutput(
  root: string,
  target: string,
  testsAdded: unknown[],
): void {
  const absolute = path.join(root, target)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(
    absolute,
    `${JSON.stringify({
      data: {
        implementation: {
          changed_files: [],
          tests_added: testsAdded,
          notes: [],
        },
        acceptance_results: [
          { id: 'AC-01', result: 'pass', evidence: ['fixture evidence'] },
        ],
      },
    })}\n`,
  )
}

function contractIssues(issues: Array<{ code: string; message: string }>) {
  return issues.filter(
    (issue) => issue.code === 'implementation.tests_added_contract_missing',
  )
}

test('tests_added requires a contract for a new test file and accepts one that names it', () => {
  const root = createFixture()
  const target =
    'runtime/logs/workflows/run-contract/outputs/implement-1-test.json'
  const before = gitWorkspaceSnapshot(root)

  mkdirSync(path.join(root, 'tests/unit'), { recursive: true })
  writeFileSync(
    path.join(root, 'tests/unit/fresh.test.ts'),
    "test('one', () => {})\nit('two', () => {})\n",
  )

  // A bare string still parses as { path } and fails only because the delta
  // requires a contract.
  writeImplementOutput(root, target, ['tests/unit/fresh.test.ts'])

  const bare = validateImplementationClaims(
    claimsValidatorInput(root, target, { workspace_before: before }),
  )
  const missing = contractIssues(bare.issues)

  assert.equal(bare.status, 'failed')
  assert.equal(missing.length, 1)
  assert.match(
    missing[0].message,
    /tests\/unit\/fresh\.test\.ts is a new test file with 2 test call site\(s\)/u,
  )
  assert.ok(!bare.issues.some((issue) => issue.code === 'claim.entry_shape'))

  writeImplementOutput(root, target, [
    {
      path: 'tests/unit/fresh.test.ts',
      contract: 'A fresh file proves the fixture accepts a contract.',
    },
  ])

  const named = validateImplementationClaims(
    claimsValidatorInput(root, target, { workspace_before: before }),
  )

  assert.equal(named.status, 'passed', JSON.stringify(named.issues))

  // An entry object without a path is a shape defect, not a missing contract.
  writeImplementOutput(root, target, [{ contract: 'no path' }])

  const malformed = validateImplementationClaims(
    claimsValidatorInput(root, target, { workspace_before: before }),
  )

  assert.ok(
    malformed.issues.some((issue) => issue.code === 'claim.entry_shape'),
  )
})

test('tests_added requires a contract for a net-positive delta and ignores unchanged tests', () => {
  const root = createFixture()
  const target =
    'runtime/logs/workflows/run-delta/outputs/implement-1-test.json'

  mkdirSync(path.join(root, 'tests/unit'), { recursive: true })
  writeFileSync(
    path.join(root, 'tests/unit/grown.test.ts'),
    "test('one', () => {})\n",
  )
  writeFileSync(
    path.join(root, 'tests/unit/steady.test.ts'),
    "test('steady', () => {})\n",
  )
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync(
    'git',
    ['-c', 'user.email=f@e.com', '-c', 'user.name=F', 'commit', '-qm', 'tests'],
    {
      cwd: root,
    },
  )

  const before = gitWorkspaceSnapshot(root)

  // A source change with no test change needs nothing.
  writeFileSync(path.join(root, 'src/base.ts'), 'export const base = false\n')
  writeImplementOutput(root, target, [])

  const untouched = validateImplementationClaims(
    claimsValidatorInput(root, target, { workspace_before: before }),
  )

  assert.equal(untouched.status, 'passed', JSON.stringify(untouched.issues))

  // Rewording an existing test keeps the count flat: still nothing required.
  writeFileSync(
    path.join(root, 'tests/unit/steady.test.ts'),
    "test('steady renamed', () => {})\n",
  )

  const reworded = validateImplementationClaims(
    claimsValidatorInput(root, target, { workspace_before: before }),
  )

  assert.equal(contractIssues(reworded.issues).length, 0)

  // Two new call sites in a tracked file need one covering entry.
  writeFileSync(
    path.join(root, 'tests/unit/grown.test.ts'),
    "test('one', () => {})\ntest('two', () => {})\ntest.skip('three', () => {})\n",
  )

  const grown = validateImplementationClaims(
    claimsValidatorInput(root, target, { workspace_before: before }),
  )
  const missing = contractIssues(grown.issues)

  assert.equal(missing.length, 1)
  assert.match(
    missing[0].message,
    /tests\/unit\/grown\.test\.ts gained 2 net test call site\(s\)/u,
  )

  // An empty contract does not cover the delta; a sentence does.
  writeImplementOutput(root, target, [
    { path: 'tests/unit/grown.test.ts', contract: '  ' },
  ])
  assert.equal(
    contractIssues(
      validateImplementationClaims(
        claimsValidatorInput(root, target, { workspace_before: before }),
      ).issues,
    ).length,
    1,
  )

  writeImplementOutput(root, target, [
    {
      path: 'tests/unit/grown.test.ts::two',
      contract: 'The grown file proves a second contract.',
    },
  ])

  const covered = validateImplementationClaims(
    claimsValidatorInput(root, target, { workspace_before: before }),
  )

  assert.equal(covered.status, 'passed', JSON.stringify(covered.issues))

  // Without an invocation snapshot the cumulative working-tree diff is the
  // observable delta and reports the same file.
  writeImplementOutput(root, target, [])

  const cumulative = validateImplementationClaims(
    claimsValidatorInput(root, target),
  )

  assert.equal(contractIssues(cumulative.issues).length, 1)
})

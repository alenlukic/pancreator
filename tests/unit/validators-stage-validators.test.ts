import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { validateAssessment } from '../../src/lib/validators/assessment.js'
import {
  validateImplementationClaims,
  validatePlanTrace,
  validateReleaseOutput,
  validateSharedFieldContract,
  validateSpotfixOutcome,
  validateTargetInstructionCoverage,
  validateVerifyOutput,
} from '../../src/lib/validators/stage-validators.js'
import { createFixture } from '../helpers.js'

/**
 * Bare validator fixture root carrying the shared field-contract document.
 * Validators read the document from the installation root only; production
 * code deliberately has no fallback to the launching checkout, so each
 * fixture ships its own copy.
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

test('plan trace ignores dispositions when the spec has no open questions', () => {
  const root = validatorFixtureRoot('pan-plan-disposition-none-')
  const target = 'output.json'

  writePlanWithQuestions(root, target, [], [])

  const result = validatePlanTrace({
    root,
    targetPath: target,
    requirement: planTraceRequirement,
  })

  assert.equal(result.status, 'passed', JSON.stringify(result.issues))
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
  writeFileSync(
    absolute,
    `${JSON.stringify({
      data: {
        implementation: {
          changed_files: [],
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
  assert.ok(result.issues.some((issue) => issue.code === 'acceptance.coverage'))
})

test('implementation validator rejects unknown acceptance ids', () => {
  const root = validatorFixtureRoot('pan-impl-unknown-')
  const runId = 'run-impl-unknown'
  const target = `runtime/logs/workflows/${runId}/outputs/implement-1-test.json`
  const absolute = path.join(root, target)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writePlanOutput(root, runId, ['AC-01'])
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
  const root = createFixture()
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

test('the verify field contract declares blocking validator ownership', () => {
  const root = createFixture()
  const contract = JSON.parse(
    readFileSync(
      path.join(root, 'library/schemas/stage-output-requirements.json'),
      'utf8',
    ),
  ) as {
    stages: Record<
      string,
      { validators: Array<{ registry_id: string; enforcement: string }> }
    >
  }

  assert.deepEqual(contract.stages.verify?.validators, [
    { registry_id: 'VERIFY-VALIDATE-001', enforcement: 'blocks' },
  ])
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
})

test('self-development release validator binds metadata to Git history and scope', () => {
  const root = createFixture()
  const target = 'output.json'
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
  for (const code of [
    'release.current_version_mismatch',
    'release.baseline_version_mismatch',
    'release.rationale_missing',
    'release.compatibility_missing',
    'release.index_action_missing',
    'release.updated_file_out_of_scope',
  ]) {
    assert.ok(
      result.issues.some((issue) => issue.code === code),
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
  const root = createFixture()
  const target = 'runtime/inbox/spotfix-outcome.md'

  writeSpotfixChangedFiles(root, [
    'src/.test.fixtures/one.ts',
    'src/.test.fixtures/two.ts',
    'src/.test.fixtures/three.ts',
    'src/.test.fixtures/four.ts',
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

test('spotfix diff_bounded exempts projected .cursor paths', () => {
  const root = createFixture()
  const target = 'runtime/inbox/spotfix-outcome.md'

  writeSpotfixChangedFiles(root, [
    'docs/one.md',
    'tests/two.test.ts',
    'src/one.ts',
    'src/two.ts',
    'src/three.ts',
    '.cursor/rules/four.mdc',
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

test('spotfix diff_bounded counts only non-exempt files in mixed diffs', () => {
  const root = createFixture()
  const target = 'runtime/inbox/spotfix-outcome.md'

  writeSpotfixChangedFiles(root, [
    'docs/one.md',
    'tests/two.test.ts',
    'library/workflows/note.md',
    'src/one.ts',
    'src/two.ts',
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

test('implementation validator resolves the file portion of "path :: case" test entries', () => {
  const root = validatorFixtureRoot('pan-impl-test-entry-')
  const runId = 'run-impl-test-entry'
  const target = `runtime/logs/workflows/${runId}/outputs/implement-1-test.json`
  const absolute = path.join(root, target)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writePlanOutput(root, runId, ['AC-01'])
  mkdirSync(path.join(root, 'tests'), { recursive: true })
  writeFileSync(path.join(root, 'tests', 'sample.test.ts'), 'test\n')
  writeFileSync(
    absolute,
    `${JSON.stringify({
      data: {
        implementation: {
          changed_files: [],
          tests_added: [
            'tests/sample.test.ts :: a named case inside the file',
            'tests/missing.test.ts :: another case',
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

  // The existing file passes through the '::' convention; only the genuinely
  // missing file is reported, by its file portion.
  const missing = result.issues.filter(
    (issue) => issue.code === 'claim.test_missing',
  )

  assert.equal(missing.length, 1)
  assert.match(missing[0].message, /tests\/missing\.test\.ts/u)
  assert.doesNotMatch(missing[0].message, /tests\/sample\.test\.ts :: /u)
})

test('implementation validator resolves native pytest node ids without spaces', () => {
  const root = validatorFixtureRoot('pan-impl-pytest-node-')
  const runId = 'run-impl-pytest-node'
  const target = `runtime/logs/workflows/${runId}/outputs/implement-1-test.json`
  const absolute = path.join(root, target)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writePlanOutput(root, runId, ['AC-01'])
  mkdirSync(path.join(root, 'tests'), { recursive: true })
  writeFileSync(path.join(root, 'tests', 'test_provenance.py'), 'test\n')
  writeFileSync(
    absolute,
    `${JSON.stringify({
      data: {
        implementation: {
          changed_files: [],
          tests_added: [
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
  const missing = result.issues.filter(
    (issue) => issue.code === 'claim.test_missing',
  )

  // `path::case` and `path :: case` resolve to the same file; only the file
  // that truly does not exist is reported, with the accepted format named in
  // the message so a retry can self-correct.
  assert.equal(missing.length, 1)
  assert.match(missing[0].message, /tests\/gone\.py/u)
  assert.match(missing[0].message, /Entries MUST be/u)
})

test('target instruction coverage names omitted instruction paths', () => {
  const root = createFixture()
  const target = 'runtime/output.json'

  mkdirSync(path.join(root, 'runtime'), { recursive: true })
  writeFileSync(
    path.join(root, target),
    `${JSON.stringify({
      target_instruction_evidence: { read_paths: [] },
    })}\n`,
  )

  const result = validateTargetInstructionCoverage({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'DEV-001',
      requirement_id: 'target-instruction-coverage',
      registry_id: 'TARGET-INSTRUCTION-COVERAGE-VALIDATE-001',
      arguments: {},
    },
    invocation: {
      inputs: {
        target_instructions: {
          changed_paths: ['src/base.ts'],
          read_paths: ['AGENTS.md'],
        },
      },
    },
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (item) =>
        item.code === 'TARGET_INSTRUCTION_COVERAGE_MISSING' &&
        item.message.includes('AGENTS.md'),
    ),
  )
})

test('target instruction coverage demands final-line read evidence per path', () => {
  const root = createFixture()
  const target = 'runtime/output.json'
  const requirement = {
    policy_id: 'DEV-001',
    requirement_id: 'target-instruction-coverage',
    registry_id: 'TARGET-INSTRUCTION-COVERAGE-VALIDATE-001',
    arguments: {},
  }
  const invocation = {
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
})

test('verify validator requires a warning finding for pass_with_warnings', () => {
  const root = validatorFixtureRoot('pan-verify-warnless-')
  const target = 'output.json'

  writeVerifyOutput(root, target, {
    verdict: 'pass_with_warnings',
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
    result.issues.some((item) => item.code === 'verify.verdict_inconsistent'),
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

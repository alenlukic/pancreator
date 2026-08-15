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
  validateQaOutput,
  validateReleaseOutput,
  validateReviewOutput,
  validateSharedFieldContract,
  validateSpotfixOutcome,
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

test('review validator rejects findings without evidence', () => {
  const root = validatorFixtureRoot('pan-review-finding-shape-')
  const runId = 'run-review-finding-shape'
  const target = `runtime/logs/workflows/${runId}/outputs/review-1-test.json`
  const absolute = path.join(root, target)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writePlanOutput(root, runId, ['AC-01'])
  writeFileSync(
    absolute,
    `${JSON.stringify({
      data: {
        review: {
          verdict: 'fail',
          findings: [
            {
              id: 'f1',
              severity: 'high',
              remediation_stage: 'implement',
              resolution: 'unresolved',
            },
          ],
          acceptance_results: [{ id: 'AC-01', result: 'pass' }],
        },
      },
    })}\n`,
  )

  const result = validateReviewOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'REVIEW-001',
      requirement_id: 'review',
      registry_id: 'REVIEW-VALIDATE-001',
      arguments: {},
    },
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some((issue) => issue.code === 'review.finding_evidence'),
  )
})

test('review validator rejects summary-only findings', () => {
  const root = validatorFixtureRoot('pan-review-summary-only-')
  const runId = 'run-review-summary-only'
  const target = `runtime/logs/workflows/${runId}/outputs/review-1-test.json`
  const absolute = path.join(root, target)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writePlanOutput(root, runId, ['AC-01'])
  writeFileSync(
    absolute,
    `${JSON.stringify({
      data: {
        review: {
          verdict: 'fail',
          findings: [
            {
              id: 'f1',
              severity: 'medium',
              remediation_stage: 'implement',
              resolution: 'unresolved',
              summary: 'Observed a maintainability risk.',
            },
          ],
          acceptance_results: [{ id: 'AC-01', result: 'pass' }],
        },
      },
    })}\n`,
  )

  const result = validateReviewOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'REVIEW-001',
      requirement_id: 'review',
      registry_id: 'REVIEW-VALIDATE-001',
      arguments: {},
    },
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some((issue) => issue.code === 'review.finding_evidence'),
  )
})

test('review validator rejects pass verdict with failed acceptance', () => {
  const root = validatorFixtureRoot('pan-review-')
  const target = 'output.json'
  const absolute = path.join(root, target)

  mkdirSync(root, { recursive: true })
  writeFileSync(
    absolute,
    `${JSON.stringify({
      data: {
        review: {
          verdict: 'pass',
          findings: [],
          acceptance_results: [{ id: 'AC-01', result: 'fail' }],
        },
      },
    })}\n`,
  )

  const result = validateReviewOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'REVIEW-001',
      requirement_id: 'review',
      registry_id: 'REVIEW-VALIDATE-001',
      arguments: {},
    },
  })

  assert.equal(result.status, 'failed')
})

test('review validator binds acceptance coverage to accepted plan', () => {
  const root = validatorFixtureRoot('pan-review-accepted-plan-')
  const runId = 'run-review-accepted-plan'
  const target = `runtime/logs/workflows/${runId}/outputs/review-1-test.json`
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
        review: {
          verdict: 'fail',
          findings: [
            {
              id: 'f1',
              severity: 'high',
              remediation_stage: 'implement',
              resolution: 'unresolved',
              evidence: ['runtime/logs/workflows/example.md'],
            },
          ],
          acceptance_results: [{ id: 'AC-OLD', result: 'pass' }],
        },
      },
    })}\n`,
  )

  const result = validateReviewOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'REVIEW-001',
      requirement_id: 'review',
      registry_id: 'REVIEW-VALIDATE-001',
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
    !result.issues.some((issue) => issue.code === 'review.acceptance_missing'),
  )
  assert.ok(
    !result.issues.some((issue) => issue.code === 'review.acceptance_unknown'),
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

test('review and QA field contracts declare advisory enforcement', () => {
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
  const reviewPolicy = JSON.parse(
    readFileSync(
      path.join(root, 'governance/policies/REVIEW-001.json'),
      'utf8',
    ),
  ) as { requirements: Array<{ enforcement: string }> }
  const testPolicy = JSON.parse(
    readFileSync(path.join(root, 'governance/policies/TEST-001.json'), 'utf8'),
  ) as { requirements: Array<{ enforcement: string }> }

  assert.deepEqual(contract.stages.review?.validators, [
    { registry_id: 'REVIEW-VALIDATE-001', enforcement: 'advises' },
  ])
  assert.deepEqual(contract.stages.test?.validators, [
    { registry_id: 'QA-VALIDATE-001', enforcement: 'advises' },
  ])
  assert.equal(reviewPolicy.requirements[0]?.enforcement, 'advisory')
  assert.equal(testPolicy.requirements[0]?.enforcement, 'advisory')
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

test('review validator accepts disclosed reviewer remediation', () => {
  const root = validatorFixtureRoot('pan-review-remediation-')
  const target = 'output.json'

  writeFileSync(
    path.join(root, target),
    `${JSON.stringify({
      data: {
        review: {
          verdict: 'pass',
          findings: [
            {
              id: 'f1',
              severity: 'medium',
              remediation_stage: 'review',
              resolution: 'resolved_in_review',
              changed_files: ['src/example.ts'],
              evidence: ['Focused test passes after the local fix'],
            },
          ],
          acceptance_results: [{ id: 'AC-01', result: 'pass' }],
          maintenance_assessment:
            'Bounded issue repaired without structural change.',
        },
      },
    })}\n`,
  )

  const result = validateReviewOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'REVIEW-001',
      requirement_id: 'review',
      registry_id: 'REVIEW-VALIDATE-001',
      arguments: {},
    },
  })

  assert.equal(result.status, 'passed')
})

test('review validator routes unresolved findings to implementation', () => {
  const root = validatorFixtureRoot('pan-review-unresolved-')
  const target = 'output.json'

  writeFileSync(
    path.join(root, target),
    `${JSON.stringify({
      data: {
        review: {
          verdict: 'pass',
          findings: [
            {
              id: 'f1',
              severity: 'high',
              remediation_stage: 'implement',
              resolution: 'unresolved',
              evidence: ['The fix requires a public API redesign'],
            },
          ],
          acceptance_results: [{ id: 'AC-01', result: 'pass' }],
          maintenance_assessment: 'Structural issue remains.',
        },
      },
    })}\n`,
  )

  const result = validateReviewOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'REVIEW-001',
      requirement_id: 'review',
      registry_id: 'REVIEW-VALIDATE-001',
      arguments: {},
    },
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some((issue) => issue.code === 'review.verdict_inconsistent'),
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

test('review validator rejects duplicate and unknown acceptance ids', () => {
  const root = validatorFixtureRoot('pan-review-coverage-')
  const runId = 'run-review-coverage'
  const target = `runtime/logs/workflows/${runId}/outputs/review-1-test.json`
  const absolute = path.join(root, target)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writePlanOutput(root, runId, ['AC-01', 'AC-02'])
  writeFileSync(
    absolute,
    `${JSON.stringify({
      data: {
        review: {
          verdict: 'fail',
          findings: [
            {
              id: 'f1',
              severity: 'high',
              remediation_stage: 'implement',
              resolution: 'unresolved',
            },
          ],
          acceptance_results: [
            { id: 'AC-01', result: 'pass' },
            { id: 'AC-01', result: 'fail' },
            { id: 'AC-99', result: 'pass' },
          ],
        },
      },
    })}\n`,
  )

  const result = validateReviewOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'REVIEW-001',
      requirement_id: 'review',
      registry_id: 'REVIEW-VALIDATE-001',
      arguments: {},
    },
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some((issue) => issue.code === 'review.acceptance_duplicate'),
  )
  assert.ok(
    result.issues.some((issue) => issue.code === 'review.acceptance_unknown'),
  )
  assert.ok(
    result.issues.some((issue) => issue.code === 'review.acceptance_missing'),
  )
})

test('qa validator binds acceptance coverage to accepted plan', () => {
  const root = validatorFixtureRoot('pan-qa-accepted-plan-')
  const runId = 'run-qa-accepted-plan'
  const target = `runtime/logs/workflows/${runId}/outputs/test-1-test.json`
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
        qa_report: {
          verdict: 'pass',
          cases: [
            {
              id: 'QA-01',
              steps: 'Run validator against accepted plan fixture',
              expected: 'Coverage checks target accepted criteria',
              actual: 'Coverage checks target accepted criteria',
              result: 'pass',
            },
          ],
          defects: [],
          acceptance_results: [
            {
              id: 'AC-OLD',
              result: 'pass',
              evidence: ['fixture'],
            },
          ],
        },
      },
    })}\n`,
  )

  const result = validateQaOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'TEST-001',
      requirement_id: 'qa-validate',
      registry_id: 'QA-VALIDATE-001',
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
    !result.issues.some((issue) => issue.code === 'qa.acceptance_coverage'),
  )
})

test('qa validator accepts pytest node ids and slash-bearing observations', () => {
  const root = validatorFixtureRoot('pan-qa-evidence-')
  const runId = 'run-qa-evidence'
  const target = `runtime/logs/workflows/${runId}/outputs/test-1-test.json`
  const absolute = path.join(root, target)

  mkdirSync(path.dirname(absolute), { recursive: true })
  mkdirSync(path.join(root, 'tests'), { recursive: true })
  writePlanOutput(root, runId, ['AC-01'])
  writeFileSync(path.join(root, 'tests', 'sample_test.py'), '# fixture\n')
  writeFileSync(
    absolute,
    `${JSON.stringify({
      data: {
        qa_report: {
          verdict: 'pass',
          cases: [
            {
              id: 'QA-01',
              steps: 'Run the focused test and inspect helper branches',
              expected: 'Both branches pass',
              actual: 'Both branches pass',
              result: 'pass',
            },
          ],
          defects: [],
          acceptance_results: [
            {
              id: 'AC-01',
              result: 'pass',
              evidence: [
                'tests/sample_test.py::test_case',
                'Direct helper output for true/false branches',
              ],
            },
          ],
        },
      },
    })}\n`,
  )

  const result = validateQaOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'TEST-001',
      requirement_id: 'qa-validate',
      registry_id: 'QA-VALIDATE-001',
      arguments: {},
    },
  })

  assert.equal(result.status, 'passed')
  assert.ok(
    !result.issues.some((issue) => issue.code === 'qa.evidence_missing'),
  )
})

test('embedded evidence paths resolve from the workspace root', () => {
  const targetRoot = validatorFixtureRoot('pan-embedded-evidence-')
  const installationRoot = path.join(targetRoot, '.pancreator')
  const runId = 'run-embedded-evidence'
  const target = `runtime/logs/workflows/${runId}/outputs/test-1-test.json`
  const testFile = path.join(
    targetRoot,
    'tests',
    'track_metadata',
    'test_label.py',
  )

  mkdirSync(installationRoot, { recursive: true })
  installFieldContract(installationRoot)
  mkdirSync(path.dirname(testFile), { recursive: true })
  writeFileSync(testFile, 'def test_example():\n    assert True\n')
  writePlanOutput(installationRoot, runId, ['AC-01'])
  writeFileSync(
    path.join(installationRoot, target),
    `${JSON.stringify({
      data: {
        qa_report: {
          verdict: 'pass',
          cases: [
            {
              id: 'QA-01',
              steps: 'Run pytest',
              expected: 'pass',
              actual: 'pass',
              result: 'pass',
            },
          ],
          defects: [],
          acceptance_results: [
            {
              id: 'AC-01',
              result: 'pass',
              evidence: [
                'tests/track_metadata/test_label.py',
                'tests/track_metadata/test_label.py::test_example',
              ],
            },
          ],
        },
      },
    })}\n`,
  )

  const sharedInput = {
    root: installationRoot,
    targetPath: target,
    requirement: {
      policy_id: 'TEST-001',
      requirement_id: 'qa-validate',
      registry_id: 'QA-VALIDATE-001',
      arguments: {},
    },
    runState: {
      workspace_root: '..',
    },
  }

  const qaResult = validateQaOutput(sharedInput)

  assert.equal(qaResult.status, 'passed')
  assert.ok(
    !qaResult.issues.some((issue) => issue.code === 'qa.evidence_missing'),
  )

  const implementationTarget = `runtime/logs/workflows/${runId}/outputs/implement-1-test.json`

  writeFileSync(
    path.join(installationRoot, implementationTarget),
    `${JSON.stringify({
      data: {
        implementation: {
          changed_files: [],
          tests_added: ['tests/track_metadata/test_label.py'],
          notes: [],
        },
        acceptance_results: [
          {
            id: 'AC-01',
            result: 'pass',
            evidence: ['tests/track_metadata/test_label.py::test_example'],
          },
        ],
      },
    })}\n`,
  )

  const implementationResult = validateImplementationClaims({
    ...sharedInput,
    targetPath: implementationTarget,
    requirement: {
      policy_id: 'DEV-001',
      requirement_id: 'implementation-claims',
      registry_id: 'IMPLEMENTATION-CLAIMS-VALIDATE-001',
      arguments: {},
    },
  })

  assert.equal(implementationResult.status, 'passed')
  assert.ok(
    !implementationResult.issues.some(
      (issue) => issue.code === 'claim.test_missing',
    ),
  )
})

test('harness-relative evidence still resolves from the installation root', () => {
  const targetRoot = validatorFixtureRoot('pan-harness-evidence-')
  const installationRoot = path.join(targetRoot, '.pancreator')
  const runId = 'run-harness-evidence'
  const target = `runtime/logs/workflows/${runId}/outputs/test-1-test.json`
  const harnessEvidence = path.join(
    installationRoot,
    'runtime/logs/workflows',
    runId,
    'evidence',
    'full.json',
  )

  mkdirSync(path.dirname(harnessEvidence), { recursive: true })
  installFieldContract(installationRoot)
  writeFileSync(harnessEvidence, '{}\n')
  writePlanOutput(installationRoot, runId, ['AC-01'])
  writeFileSync(
    path.join(installationRoot, target),
    `${JSON.stringify({
      data: {
        qa_report: {
          verdict: 'pass',
          cases: [
            {
              id: 'QA-01',
              steps: 'Inspect harness evidence',
              expected: 'present',
              actual: 'present',
              result: 'pass',
            },
          ],
          defects: [],
          acceptance_results: [
            {
              id: 'AC-01',
              result: 'pass',
              evidence: [
                `runtime/logs/workflows/${runId}/evidence/full.json`,
                'https://example.com/report',
              ],
            },
          ],
        },
      },
    })}\n`,
  )

  const result = validateQaOutput({
    root: installationRoot,
    targetPath: target,
    requirement: {
      policy_id: 'TEST-001',
      requirement_id: 'qa-validate',
      registry_id: 'QA-VALIDATE-001',
      arguments: {},
    },
    runState: {
      workspace_root: '..',
    },
  })

  assert.equal(result.status, 'passed')
  assert.ok(
    !result.issues.some((issue) => issue.code === 'qa.evidence_missing'),
  )
})

test('qa validator still rejects explicitly declared missing evidence paths', () => {
  const root = validatorFixtureRoot('pan-qa-missing-evidence-')
  const runId = 'run-qa-missing-evidence'
  const target = `runtime/logs/workflows/${runId}/outputs/test-1-test.json`
  const absolute = path.join(root, target)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writePlanOutput(root, runId, ['AC-01'])
  writeFileSync(
    absolute,
    `${JSON.stringify({
      data: {
        qa_report: {
          verdict: 'pass',
          cases: [
            {
              id: 'QA-01',
              steps: 'Inspect evidence',
              expected: 'Evidence exists',
              actual: 'Evidence is missing',
              result: 'pass',
            },
          ],
          defects: [],
          acceptance_results: [
            {
              id: 'AC-01',
              result: 'pass',
              evidence: ['path:tests/missing.py'],
            },
          ],
        },
      },
    })}\n`,
  )

  const result = validateQaOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'TEST-001',
      requirement_id: 'qa-validate',
      registry_id: 'QA-VALIDATE-001',
      arguments: {},
    },
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === 'qa.evidence_missing' &&
        issue.message.includes('tests/missing.py'),
    ),
  )
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
  const preservedErrors = JSON.parse(
    readFileSync(
      path.join(
        process.cwd(),
        'tests/fixtures/harness-repair/ship-validation-errors.json',
      ),
      'utf8',
    ),
  ) as { errors: string[] }

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

  assert.ok(
    preservedErrors.errors.some((entry) => entry.includes('[object Object]')),
  )
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

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
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
} from '../../src/lib/validators/stage-validators.js'

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
  const root = mkdtempSync(path.join(tmpdir(), 'pan-plan-'))
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
  const root = mkdtempSync(path.join(tmpdir(), 'pan-review-finding-shape-'))
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
  const root = mkdtempSync(path.join(tmpdir(), 'pan-review-summary-only-'))
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
  const root = mkdtempSync(path.join(tmpdir(), 'pan-review-'))
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
  const root = mkdtempSync(path.join(tmpdir(), 'pan-review-accepted-plan-'))
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
  const root = mkdtempSync(path.join(tmpdir(), 'pan-impl-accepted-plan-'))
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
        acceptance_results: [{ id: 'AC-OLD', result: 'pass', evidence: ['x'] }],
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
  const root = mkdtempSync(path.join(tmpdir(), 'pan-impl-coverage-'))
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
  const root = mkdtempSync(path.join(tmpdir(), 'pan-impl-unknown-'))
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

test('implementation validator fails closed when git is unavailable', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pan-impl-git-'))
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
  const root = mkdtempSync(path.join(tmpdir(), 'pan-review-coverage-'))
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
  const root = mkdtempSync(path.join(tmpdir(), 'pan-qa-accepted-plan-'))
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

test('release validator rejects unknown validation fingerprints', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pan-release-fp-'))
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

test('release validator rejects waiver fingerprint mismatch', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pan-release-waiver-'))
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
    runState: {
      operator_gate_waivers: [
        {
          waiver_id: 'waiver-review',
          workspace_fingerprint: 'fp-actual',
          artifact_path: artifactPath,
          source_evidence_path: artifactPath,
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

test('assessment validator requires exact judgment criterion coverage', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pan-assess-'))
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

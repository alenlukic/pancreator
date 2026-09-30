import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { validateAssessment } from '../../src/lib/validators/assessment.js'
import {
  isSpotfixDiffExempt,
  validateImplementationClaims,
  validateSpotfixOutcome,
  validateTargetInstructionCoverage,
} from '../../src/lib/validators/stage-validators.js'
import { createFixture } from '../helpers.js'
import { createTestTempDirectory } from '../temp.js'
import {
  validatorFixtureRoot,
  writePlanOutput,
} from './validators-stage-validators-helpers.js'

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

test('implementation retry requires explicit remediation evidence', () => {
  const root = validatorFixtureRoot('pan-impl-remediation-')
  const target = 'output.json'

  const writeOutput = (
    remediation?: Array<{
      cause: string
      action: string
      evidence: string[]
    }>,
  ) => {
    writeFileSync(
      path.join(root, target),
      `${JSON.stringify({
        data: {
          implementation: {
            changed_files: [],
            tests_added: [],
            notes: [],
            ...(remediation ? { remediation } : {}),
          },
          acceptance_results: [
            { id: 'AC-01', result: 'pass', evidence: ['verified'] },
          ],
        },
      })}\n`,
    )

    return validateImplementationClaims({
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
  }

  const missing = writeOutput()

  assert.equal(missing.status, 'failed')
  assert.ok(
    missing.issues.some(
      (issue) => issue.code === 'implementation.remediation_missing',
    ),
  )

  const supplied = writeOutput([
    {
      cause: 'implement.lint reported a new diagnostic',
      action: 'Corrected the offending implementation path',
      evidence: ['runtime/logs/workflows/run/evidence/lint.log'],
    },
  ])

  assert.ok(
    !supplied.issues.some((issue) =>
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
  writeFileSync(path.join(root, target), SPOTFIX_OUTCOME)

  const validateStaging = (changedFiles: string[]) => {
    writeSpotfixChangedFiles(root, changedFiles)

    return validateSpotfixOutcome({
      root,
      targetPath: target,
      requirement: {
        policy_id: 'SPOT-001',
        requirement_id: 'spotfix-validate',
        registry_id: 'SPOTFIX-VALIDATE-001',
        arguments: {},
      },
    })
  }

  const exempt = validateStaging([
    'docs/one.md',
    'library/personas/two.md',
    'tests/three.test.ts',
    'library/workflows/note.md',
  ])

  assert.equal(exempt.status, 'passed')
  assert.ok(
    !exempt.issues.some((issue) => issue.code === 'spotfix.diff_bounded'),
  )

  const overBound = validateStaging([
    'src/one.ts',
    'src/two.ts',
    'src/three.ts',
    'src/four.ts',
  ])

  assert.equal(overBound.status, 'failed')
  assert.ok(
    overBound.issues.some((issue) => issue.code === 'spotfix.diff_bounded'),
  )
})

test('spotfix diff_bounded exempts projected .cursor paths', () => {
  const files = [
    'docs/one.md',
    'tests/two.test.ts',
    'src/one.ts',
    'src/two.ts',
    'src/three.ts',
    '.cursor/rules/four.mdc',
    '.cursor/agents/reviewer.json',
  ]

  assert.equal(isSpotfixDiffExempt('docs/one.md'), true)
  assert.equal(isSpotfixDiffExempt('tests/two.test.ts'), true)
  assert.equal(isSpotfixDiffExempt('.cursor/rules/four.mdc'), true)
  assert.equal(isSpotfixDiffExempt('.cursor/agents/reviewer.json'), true)
  assert.equal(isSpotfixDiffExempt('src/one.ts'), false)
  assert.equal(isSpotfixDiffExempt('src/two.ts'), false)
  assert.equal(isSpotfixDiffExempt('src/three.ts'), false)
  assert.equal(files.filter((file) => !isSpotfixDiffExempt(file)).length, 3)

  // A test-like directory inside an implementation tree stays unexempt, so
  // four such files still exceed the three-file bound.
  const testLike = [
    'src/.test.fixtures/one.ts',
    'src/.test.fixtures/two.ts',
    'src/.test.fixtures/three.ts',
    'src/.test.fixtures/four.ts',
  ]

  for (const file of testLike) {
    assert.equal(isSpotfixDiffExempt(file), false, file)
  }
  assert.ok(testLike.filter((file) => !isSpotfixDiffExempt(file)).length > 3)
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
  const root = createTestTempDirectory('pan-target-coverage-')
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

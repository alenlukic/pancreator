import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  validatePlanTrace,
  validateSharedFieldContract,
} from '../../src/lib/validators/stage-validators.js'
import { createFixture, writeJson } from '../helpers.js'
import { createTestTempDirectory } from '../temp.js'
import {
  installFieldContract,
  validatorFixtureRoot,
} from './validators-stage-validators-helpers.js'

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

test('plan trace accepts defined constraint ids and rejects undefined ones', () => {
  const root = createFixture()
  const target = 'output.json'
  const write = (mapsTo: string[]): void => {
    writeFileSync(
      path.join(root, target),
      `${JSON.stringify({
        data: {
          product_spec: {
            user_stories: [],
            constraints: [{ id: 'C-1' }],
            out_of_scope: [{ id: 'OOS-1' }],
          },
          acceptance_criteria: [
            {
              id: 'AC-01',
              maps_to: mapsTo,
              verification: { method: 'unit', expected: 'pass' },
            },
          ],
          engineering_plan: { files: [] },
          test_plan: [],
          open_question_dispositions: [],
          verification_recommendation: { level: 'light', reason: 'focused' },
        },
      })}
`,
    )
  }

  write(['C-1', 'OOS-1'])
  const accepted = validatePlanTrace({
    root,
    targetPath: target,
    requirement: planTraceRequirement,
  })

  assert.equal(
    accepted.issues.some((issue) => issue.code === 'plan.maps_to_unknown'),
    false,
    JSON.stringify(accepted.issues),
  )

  write(['C-2'])
  const rejected = validatePlanTrace({
    root,
    targetPath: target,
    requirement: planTraceRequirement,
  })

  assert.ok(
    rejected.issues.some(
      (issue) =>
        issue.code === 'plan.maps_to_unknown' && issue.message.includes('C-2'),
    ),
  )
})

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
      proof: 'test',
    },
  ],
  testPlan: unknown[] = [],
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
        test_plan: testPlan,
        open_question_dispositions: dispositions,
      },
    })}\n`,
  )
}

test('plan trace refuses a criterion no assigned worker may produce', () => {
  const root = validatorFixtureRoot('pan-plan-producer-')
  const target = 'output.json'

  writePlanWithQuestions(
    root,
    target,
    [],
    [],
    [
      {
        id: 'AC-01',
        maps_to: ['US-1'],
        verification: {
          method: 'Render the implement invocation card with `pan prepare`.',
          expected: 'The card names the resolved gate bound.',
        },
      },
    ],
  )

  const result = validatePlanTrace({
    root,
    targetPath: target,
    requirement: planTraceRequirement,
  })

  assert.equal(result.status, 'failed')

  const unproducible = result.issues.filter(
    (issue) => issue.code === 'plan.criterion_unproducible',
  )

  assert.equal(unproducible.length, 1)
  assert.match(unproducible[0].message, /AC-01/u)
  assert.match(unproducible[0].message, /pan context card/u)

  // The read-only render is a producer the assigned workers may run.
  const producible = 'producible.json'

  writePlanWithQuestions(
    root,
    producible,
    [],
    [],
    [
      {
        id: 'AC-01',
        maps_to: ['US-1'],
        verification: {
          method: 'Render the implement card with `pan context card <run-id>`.',
          expected: 'The card names the resolved gate bound.',
        },
        proof: 'review',
      },
    ],
  )

  assert.deepEqual(
    validatePlanTrace({
      root,
      targetPath: producible,
      requirement: planTraceRequirement,
    }).issues,
    [],
  )
})

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

test('plan trace validates pan commands against the shared CLI option grammar', () => {
  const root = validatorFixtureRoot('pan-plan-command-grammar-')
  const invalid = 'invalid-command.json'
  const valid = 'valid-command.json'

  writePlanWithQuestions(root, invalid, [], [], undefined, [
    {
      id: 'TP-INVALID',
      command: './bin/pan governance card --mode harden --output-path <file>',
    },
  ])
  writePlanWithQuestions(root, valid, [], [], undefined, [
    {
      id: 'TP-VALID',
      command: './bin/pan governance card --mode harden --out <file>',
    },
  ])

  const invalidResult = validatePlanTrace({
    root,
    targetPath: invalid,
    requirement: planTraceRequirement,
  })
  const commandIssue = invalidResult.issues.find(
    (item) => item.code === 'plan.case_invalid_pan_invocation',
  )

  assert.ok(commandIssue)
  assert.match(commandIssue.message, /--output-path/u)
  assert.match(commandIssue.message, /Accepted:.*--out/u)

  const validResult = validatePlanTrace({
    root,
    targetPath: valid,
    requirement: planTraceRequirement,
  })

  assert.equal(validResult.status, 'passed', JSON.stringify(validResult.issues))
})

test('plan trace accepts a read-only configuration verification method', () => {
  const root = validatorFixtureRoot('pan-plan-configuration-profile-')
  const target = 'output.json'

  mkdirSync(path.join(root, 'runtime'), { recursive: true })
  writeFileSync(
    path.join(root, 'runtime', 'repository-checks.json'),
    `${JSON.stringify({
      schema_version: 1,
      setup: [],
      profiles: {
        configuration: {
          description: 'read-only configuration validation',
          probes: [],
          commands: ['npm run validate'],
        },
      },
    })}\n`,
  )
  writePlanWithQuestions(root, target, [], [], undefined, [
    {
      id: 'TP-CONFIG',
      criterion: 'AC-01',
      action: 'Run pan repository-check configuration',
    },
  ])

  const result = validatePlanTrace({
    root,
    targetPath: target,
    requirement: planTraceRequirement,
  })

  assert.equal(result.status, 'passed', JSON.stringify(result.issues))
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

test('plan file paths resolve against the workspace root', () => {
  const root = createTestTempDirectory('plan-trace-root-')
  const workspace = createTestTempDirectory('pan-workspace-')
  const targetFile = path.join(workspace, 'app', 'model.py')

  const sibling = createTestTempDirectory('pan-sibling-repo-')
  const siblingFile = path.join(sibling, 'model.py')

  const outputRelative = 'runtime/logs/workflows/x/outputs/plan.json'

  installFieldContract(root)
  mkdirSync(path.dirname(targetFile), { recursive: true })
  writeFileSync(targetFile, 'x = 1\n')
  writeFileSync(siblingFile, 'print("sibling")\n')
  writeJson(path.join(root, outputRelative), {
    data: {
      engineering_plan: {
        approach: 'Fixture',
        components: ['app'],
        files: [
          { path: 'app/model.py', status: 'modified', purpose: 'core' },
          { path: siblingFile, status: 'modified', purpose: 'core' },
          {
            path: '../nonexistent/app/model.py',
            status: 'modified',
            purpose: 'core',
          },
        ],
        risks: [],
        validation: ['tests'],
      },
      acceptance_criteria: [
        {
          id: 'AC-01',
          criterion: 'Works',
          maps_to: ['US-01'],
          verification: { method: 'test', expected: 'passes' },
        },
      ],
    },
  })

  const result = validatePlanTrace({
    root,
    targetPath: outputRelative,
    requirement: {
      policy_id: 'PLAN-002',
      requirement_id: 'plan-trace-validate',
      registry_id: 'PLAN-TRACE-VALIDATE-001',
      arguments: {},
    },
    runState: { workspace_root: workspace },
  })
  const missing = result.issues.filter(
    (item) => item.code === 'plan.file_missing',
  )

  assert.ok(!result.issues.some((item) => item.code === 'plan.file_path_shape'))
  assert.ok(
    !missing.some(
      (item) =>
        item.message.includes('app/model.py') &&
        !item.message.includes('../nonexistent'),
    ),
  )
  assert.ok(!missing.some((item) => item.message.includes(siblingFile)))
  assert.ok(
    missing.some((item) =>
      item.message.includes('../nonexistent/app/model.py'),
    ),
  )
})

test('plan trace enforces every required plan file child', () => {
  const root = validatorFixtureRoot('pan-plan-file-fields-')
  const target = 'output.json'

  writeFileSync(path.join(root, 'existing.ts'), 'export const value = 1\n')

  for (const field of ['path', 'status', 'purpose'] as const) {
    const file: Partial<Record<'path' | 'status' | 'purpose', string>> = {
      path: 'existing.ts',
      status: 'modified',
      purpose: 'Update the existing fixture.',
    }

    delete file[field]
    writeJson(path.join(root, target), {
      data: {
        acceptance_criteria: [],
        engineering_plan: { files: [file] },
        test_plan: [],
        open_question_dispositions: [],
        verification_recommendation: {
          level: 'light',
          reason: 'The fixture change is bounded.',
        },
      },
    })

    const result = validatePlanTrace({
      root,
      targetPath: target,
      requirement: planTraceRequirement,
    })
    const expectedCode =
      field === 'status' ? 'plan.file_status' : 'plan.file_required'

    assert.ok(
      result.issues.some(
        (item) =>
          item.code === expectedCode &&
          item.message.includes(`files[0].${field}`),
      ),
      `${field}: ${JSON.stringify(result.issues)}`,
    )
  }
})

test('plan field contract declares every validator-enforced shape', () => {
  const root = createFixture()
  const contractPath = 'library/schemas/stage-output-requirements.json'
  const source = JSON.parse(
    readFileSync(path.join(root, contractPath), 'utf8'),
  ) as {
    stages: {
      plan: {
        validators: Array<{ enforced_fields?: string[] }>
        fields: Array<{ path: string }>
      }
    }
  }

  const declared = new Set(source.stages.plan.fields.map((field) => field.path))
  const enforced = new Set(
    source.stages.plan.validators.flatMap(
      (validator) => validator.enforced_fields ?? [],
    ),
  )

  for (const fieldPath of [
    'data.acceptance_criteria[].id',
    'data.acceptance_criteria[].maps_to',
    'data.acceptance_criteria[].verification',
    'data.engineering_plan.files[]',
    'data.engineering_plan.files[].path',
    'data.engineering_plan.files[].status',
    'data.engineering_plan.files[].purpose',
    'data.test_plan[]',
    'data.open_question_dispositions[].id',
    'data.open_question_dispositions[].answer',
    'data.open_question_dispositions[].disposition',
    'data.open_question_dispositions[].evidence',
    'data.verification_recommendation',
  ]) {
    assert.ok(declared.has(fieldPath), `${fieldPath} is not declared`)
    assert.ok(enforced.has(fieldPath), `${fieldPath} is not enforced`)
  }

  const result = validateSharedFieldContract({
    root,
    targetPath: contractPath,
    requirement: {
      policy_id: 'CONTRACT-001',
      requirement_id: 'shared-stage-field-contract',
      registry_id: 'FIELD-CONTRACT-VALIDATE-001',
      arguments: {},
    },
  })

  assert.equal(result.status, 'passed', JSON.stringify(result.issues))
})

test('plan trace requires one proof type per criterion and a case only for live criteria', () => {
  const root = validatorFixtureRoot('pan-plan-proof-')
  const target = 'output.json'
  const criterion = (id: string, proof?: string) => ({
    id,
    maps_to: ['US-1'],
    verification: { method: 'unit test', expected: 'passes' },
    ...(proof === undefined ? {} : { proof }),
  })
  const codes = (): string[] =>
    validatePlanTrace({
      root,
      targetPath: target,
      requirement: planTraceRequirement,
    }).issues.map((item) => item.code)

  writePlanWithQuestions(
    root,
    target,
    [],
    [],
    [criterion('AC-01'), criterion('AC-02', 'manual')],
  )
  assert.deepEqual(codes(), ['plan.proof_missing', 'plan.proof_missing'])

  // A test, review, or observe criterion needs no test-plan case.
  writePlanWithQuestions(
    root,
    target,
    [],
    [],
    [
      criterion('AC-01', 'test'),
      criterion('AC-02', 'review'),
      criterion('AC-03', 'observe'),
      criterion('AC-04', 'live'),
    ],
  )
  assert.deepEqual(codes(), ['plan.live_case_missing'])

  writePlanWithQuestions(
    root,
    target,
    [],
    [],
    [criterion('AC-01', 'test'), criterion('AC-04', 'live')],
    [
      {
        id: 'TP-01',
        criterion: 'AC-04',
        setup: 'Open the rendered page in an isolated browser.',
        action: 'Select the new panel.',
        expected: 'The panel renders.',
      },
    ],
  )
  assert.deepEqual(codes(), [])
})

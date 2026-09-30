import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { validateVerifyOutput } from '../../src/lib/validators/stage-validators.js'
import { writeJson } from '../helpers.js'
import { scaffoldStageOutput } from '../../src/lib/requirements/scaffold.js'
import type { Invocation } from '../../src/lib/types.js'
import {
  passingQaCase,
  validatorFixtureRoot,
  verifyRequirement,
  writePlanOutput,
  writeVerifyOutput,
} from './validators-stage-validators-helpers.js'

test('a finding filled from the verify scaffold passes shape validation', () => {
  const root = validatorFixtureRoot('pan-verify-scaffold-')
  const target = 'output.json'

  const invocation = {
    invocation_id: 'verify-1',
    rubric: [],
    output: {
      path: target,
      required_data: {
        verify: 'object',
        'verify.verdict': 'string',
        'verify.findings': 'array',
        'verify.qa_cases': 'array',
        'verify.acceptance_results': 'array',
      },
    },
  } as unknown as Invocation

  const scaffold = scaffoldStageOutput(root, invocation, target).output
  const verify = (scaffold.data as Record<string, unknown>).verify as Record<
    string,
    unknown
  >

  verify.verdict = 'pass_with_warnings'
  verify.findings = [
    {
      id: 'VF-1',
      severity: 'low',
      source: 'review',
      statement: 'The fixture records one non-blocking observation.',
      evidence: ['tests/integration/validators-stage-validators.test.ts'],
    },
  ]
  verify.qa_cases = [passingQaCase]
  verify.acceptance_results = [{ id: 'AC-01', result: 'pass' }]
  writeJson(path.join(root, target), scaffold)

  const result = validateVerifyOutput({
    root,
    targetPath: target,
    requirement: verifyRequirement(),
  })

  assert.equal(result.status, 'passed', JSON.stringify(result.issues))
})

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

// HR3-009: a returning verification had nowhere to say that a case result
// came from the earlier visit, so the only compliant option was to execute
// every case again over code the remediation never touched.
test('verify validator accepts a carried case citation and rejects a malformed one', () => {
  const root = validatorFixtureRoot('pan-verify-carried-case-')
  const carried = {
    ...passingQaCase,
    id: 'TP-02',
    carried_from: {
      invocation_id: 'verify-1',
      workspace_fingerprint: 'fp-prior',
    },
  }

  writeVerifyOutput(root, 'carried.json', {
    verdict: 'pass',
    findings: [],
    qa_cases: [passingQaCase, carried],
    acceptance_results: [{ id: 'AC-01', result: 'pass' }],
  })

  const wellFormed = validateVerifyOutput({
    root,
    targetPath: 'carried.json',
    requirement: verifyRequirement(),
  })

  assert.equal(wellFormed.status, 'passed', JSON.stringify(wellFormed.issues))

  // A citation that names no fingerprint cannot say which workspace the
  // carried result was observed against, which is the whole point of it.
  writeVerifyOutput(root, 'malformed.json', {
    verdict: 'pass',
    findings: [],
    qa_cases: [
      { ...carried, carried_from: { invocation_id: 'verify-1' } },
      { ...passingQaCase, id: 'TP-03', carried_from: {} },
      {
        ...passingQaCase,
        id: 'TP-04',
        carried_from: {
          invocation_id: '   ',
          workspace_fingerprint: 'fp-prior',
        },
      },
    ],
    acceptance_results: [{ id: 'AC-01', result: 'pass' }],
  })

  const malformed = validateVerifyOutput({
    root,
    targetPath: 'malformed.json',
    requirement: verifyRequirement(),
  })

  assert.equal(malformed.status, 'failed')
  assert.deepEqual(
    malformed.issues
      .filter((item) => item.code === 'verify.case_carried_from_shape')
      .map((item) => item.message.split(' ')[2]),
    ['TP-02', 'TP-03', 'TP-04'],
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

test('verify validator accepts a blocked output with reason and missing paths only', () => {
  const root = validatorFixtureRoot('pan-verify-blocked-')
  const target = 'output.json'

  const validateBlocked = (verify: Record<string, unknown>) => {
    writeFileSync(
      path.join(root, target),
      `${JSON.stringify({ result: 'blocked', data: { verify } })}\n`,
    )

    return validateVerifyOutput({
      root,
      targetPath: target,
      requirement: verifyRequirement(),
    })
  }

  const accepted = validateBlocked({
    blocking_reason: 'Required model evidence reports are missing.',
    missing_evidence_paths: [
      'runtime/logs/workflows/run/evidence/model-evidence-review.json',
      'runtime/logs/workflows/run/evidence/model-evidence-qa.json',
    ],
  })

  assert.equal(accepted.status, 'passed', JSON.stringify(accepted.issues))

  const withProductField = validateBlocked({
    blocking_reason: 'Evidence missing.',
    missing_evidence_paths: ['runtime/missing.json'],
    verdict: 'fail_remedial',
  })

  assert.equal(withProductField.status, 'failed')
  assert.ok(
    withProductField.issues.some(
      (item) => item.code === 'verify.blocked_forbidden_field',
    ),
  )
})

test('verify validator owes qa_cases only on a visit that runs QA', () => {
  const root = validatorFixtureRoot('pan-verify-qa-conditional-')
  const target = 'output.json'
  const worker = (role: string) => ({ role, persona: role, scope: 'fixture' })
  const codes = (invocation?: Record<string, unknown>): string[] =>
    validateVerifyOutput({
      root,
      targetPath: target,
      requirement: verifyRequirement(),
      ...(invocation ? { invocation } : {}),
    }).issues.map((item) => item.code)

  writeVerifyOutput(root, target, {
    verdict: 'pass',
    findings: [],
    acceptance_results: [{ id: 'AC-01', result: 'pass' }],
    dimensions: Object.fromEntries(
      ['review', 'qa'].map((role) => [
        role,
        { summary: `Fixture ${role} dimension.`, evidence: ['fixture'] },
      ]),
    ),
  })

  assert.deepEqual(codes({ evidence_workers: [worker('review')] }), [])
  assert.deepEqual(
    codes({ evidence_workers: [worker('review'), worker('qa')] }),
    ['verify.qa_cases_missing'],
  )
  assert.deepEqual(
    codes({
      scoped_return: { dimensions: [worker('review'), worker('qa')] },
    }),
    ['verify.qa_cases_missing'],
  )
  // Without a card the validator cannot tell, so it keeps the requirement.
  assert.deepEqual(codes(), ['verify.qa_cases_missing'])
})

test('verify validator accepts an observe result only for an observe criterion', () => {
  const root = validatorFixtureRoot('pan-verify-observe-')
  const runId = 'run-verify-observe'
  const planPath = `runtime/logs/workflows/${runId}/outputs/plan-1-test.json`
  const target = `runtime/logs/workflows/${runId}/outputs/verify-1-test.json`

  writeJson(path.join(root, planPath), {
    data: {
      acceptance_criteria: [
        { id: 'AC-01', proof: 'test' },
        { id: 'AC-02', proof: 'observe' },
      ],
    },
  })

  const runState = {
    stage_history: [
      { stage: 'plan', outcome: 'success', output_path: planPath },
    ],
  }
  const validate = (results: Array<{ id: string; result: string }>) => {
    writeVerifyOutput(root, target, {
      verdict: 'pass',
      findings: [],
      acceptance_results: results.map((item) => ({
        ...item,
        evidence: ['fixture'],
      })),
    })

    return validateVerifyOutput({
      root,
      targetPath: target,
      requirement: verifyRequirement(),
      invocation: { evidence_workers: [{ role: 'review' }] },
      runState,
    })
  }

  const deferred = validate([
    { id: 'AC-01', result: 'pass' },
    { id: 'AC-02', result: 'observe' },
  ])

  // A deferred criterion is not a failure, so the pass verdict stands.
  assert.equal(deferred.status, 'passed', JSON.stringify(deferred.issues))

  const misused = validate([
    { id: 'AC-01', result: 'observe' },
    { id: 'AC-02', result: 'observe' },
  ])

  assert.deepEqual(
    misused.issues.map((item) => item.code),
    ['verify.acceptance_observe_unproven'],
  )
  assert.match(misused.issues[0].message, /AC-01 has proof test/u)

  // An observe criterion owes a post-ship observation, so a graded result
  // that would drop it from the ship packet is refused.
  const graded = validate([
    { id: 'AC-01', result: 'pass' },
    { id: 'AC-02', result: 'pass' },
  ])

  assert.deepEqual(
    graded.issues.map((item) => item.code),
    ['verify.acceptance_observe_required'],
  )
  assert.match(graded.issues[0].message, /AC-02 has proof observe/u)
})

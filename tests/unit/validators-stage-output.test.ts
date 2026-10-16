import assert from 'node:assert/strict'
import test from 'node:test'

import { validateStageOutput } from '../../src/lib/validation.js'
import {
  blockingCriterionStateErrors,
  effectiveOutcome,
  submissionGateSkipReason,
} from '../../src/lib/engine/submit-helpers.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { sharedFixture } from '../fixture-template.js'
import type { Invocation, StageOutput } from '../../src/lib/types.js'

function fixtureInvocation(
  root: string,
  stageSlug: string,
  invocationId: string,
): { invocation: Invocation; stage: ReturnType<typeof stageBySlug> } {
  const workflow = loadWorkflow(root, 'delivery')
  const stage = stageBySlug(workflow, stageSlug)

  return {
    stage,
    invocation: {
      $operator: {
        headline: 'Test',
        summary: 'Test',
        next_action: 'Submit',
      },
      schema_version: 1,
      invocation_id: invocationId,
      run_id: 'run-test',
      attempt: 1,
      created_at: new Date().toISOString(),
      workspace_root: '.',
      workflow: {
        slug: workflow.slug,
        snapshot_path: 'x',
        snapshot_sha256: 'y',
      },
      stage: {
        slug: stage.slug,
        title: stage.title,
        persona: stage.persona,
        model: 'test',
        model_config: 'test',
        workspace_policy: stage.workspace_policy,
        gate: stage.gate,
      },
      prompt: 'Do work',
      inputs: { references: [] },
      policies: [],
      rubric: stage.criteria,
      output: {
        path: 'runtime/logs/workflows/run-test/outputs/out.json',
        template: 'library/templates/stage-output.example.json',
        schema: 'library/schemas/stage-output.schema.json',
        required_data: stage.required_data ?? {},
        operator_brief: {
          source_path:
            'runtime/logs/workflows/run-test/artifacts/json/out.brief.json',
          rendered_path:
            'runtime/logs/workflows/run-test/artifacts/html/out.html',
          schema: 'library/schemas/operator-brief.schema.json',
          renderer: 'pan briefs render',
          profile: 'implementation',
          required_headings: ['summary', 'changes', 'acceptance'],
        },
      },
      boundaries: [],
      workspace_before: { kind: 'git', fingerprint: 'abc', entries: [] },
    },
  }
}

test('gate skip reasons retain rejection precedence and permit valid pending claims', () => {
  const root = sharedFixture()
  const { stage, invocation } = fixtureInvocation(root, 'implement', 'skip')
  const output = baseOutput(invocation, stage)
  const reason = (
    attestation: string[] = [],
    validators: string[] = [],
    blocking: string[] = [],
    submitted: unknown = output,
  ) =>
    submissionGateSkipReason(
      stage,
      output,
      submitted,
      attestation,
      validators,
      blocking,
    )

  for (const result of ['failure', 'blocked'] as const) {
    assert.equal(
      reason(['bad attestation'], ['harness validator claims failed'], [], {
        result,
      }),
      `the stage reported result '${result}'`,
    )
  }
  assert.equal(
    reason(['bad attestation'], ['harness validator claims failed']),
    'the invocation read attestation failed',
  )
  assert.equal(
    reason(
      [],
      [
        'harness validator claims failed',
        'harness validator claims failed',
        'harness validator artifacts failed',
      ],
    ),
    'harness validator claims, artifacts rejected the output',
  )
  const hard = stage.criteria.find((criterion) => criterion.hard)
  assert.ok(hard)
  const claim = output.criteria.find((criterion) => criterion.id === hard.id)
  assert.ok(claim)
  claim.result = 'fail'
  assert.equal(
    reason([], [], ['invalid criterion']),
    `hard criterion '${hard.id}' was self-evaluated as failed`,
  )
  claim.result = 'pass'
  assert.equal(
    reason([], [], ['invalid criterion']),
    'a blocking artifact or stage-output validator rejected the output',
  )
  for (const criterion of output.criteria) {
    if (
      stage.criteria.find((item) => item.id === criterion.id)?.type === 'shell'
    ) {
      criterion.result = 'pending_harness'
    }
  }
  assert.equal(reason(), null)
  assert.equal(reason([], [], [], { result: 'invalid' }), null)
})

function baseOutput(
  invocation: Invocation,
  stage: ReturnType<typeof stageBySlug>,
): StageOutput {
  return {
    schema_version: 1,
    invocation_id: invocation.invocation_id,
    result: 'success',
    summary: 'Fixture output',
    artifacts: [],
    criteria: stage.criteria.map((criterion) => ({
      id: criterion.id,
      result: 'pass',
      evidence: [
        'runtime/logs/workflows/run-test/artifacts/markdown/evidence.md',
      ],
      explanation: 'Fixture evidence',
    })),
    risks: [],
    unknowns: [],
    data: {},
  }
}

/** The operator-brief artifacts every ship output must declare. */
function briefArtifacts(invocation: Invocation) {
  const brief = invocation.output.operator_brief

  assert.ok(brief)

  return [
    { path: brief.rendered_path, description: 'Rendered brief' },
    { path: brief.source_path, description: 'Brief source' },
  ]
}

/** Brief paths the harness renders after submission, not before it. */
function pendingBriefPaths(invocation: Invocation) {
  return {
    pendingArtifactPaths: briefArtifacts(invocation).map((item) => item.path),
  }
}

test('strict stage output rejects pass claims without evidence', () => {
  const root = sharedFixture()
  const { invocation, stage } = fixtureInvocation(
    root,
    'implement',
    'implement-1-test',
  )
  const output = baseOutput(invocation, stage)
  const brief = invocation.output.operator_brief

  assert.ok(brief)
  const passCriterion = output.criteria.find((item) => item.result === 'pass')

  assert.ok(passCriterion)
  passCriterion.evidence = []

  const validation = validateStageOutput(root, stage, invocation, output)

  assert.match(
    validation.errors.join('\n'),
    /pass claim MUST include evidence/u,
  )

  const misdeclared = baseOutput(invocation, stage)

  misdeclared.artifacts = [
    {
      path: 'runtime/logs/workflows/run-test/artifacts/markdown/summary.md',
      description: 'Legacy Markdown summary',
    },
    {
      path: brief.source_path,
      description: 'Brief source',
    },
  ]

  assert.match(
    validateStageOutput(root, stage, invocation, misdeclared).errors.join('\n'),
    /artifacts\[0\]\.path MUST equal rendered operator brief path/u,
  )

  brief.source_transient = true
  const transient = baseOutput(invocation, stage)

  transient.artifacts = [
    {
      path: brief.rendered_path,
      description: 'Rendered brief',
    },
  ]

  const withoutSource = validateStageOutput(root, stage, invocation, transient)

  assert.doesNotMatch(
    withoutSource.errors.join('\n'),
    /artifacts\[1\]|MUST NOT list transient/u,
  )

  transient.artifacts.push({
    path: brief.source_path,
    description: 'Transient source',
  })

  const withSource = validateStageOutput(root, stage, invocation, transient)

  assert.match(
    withSource.errors.join('\n'),
    /MUST NOT list transient operator brief source/u,
  )
})

// Run 63308 finding F-03: a stage-output issue took its code from a lookup
// keyed by the message text, so a reword degraded the identifier to the
// generic `stage_output.invalid` with nothing reporting the loss. Every issue
// now carries the code its raising site assigned.
test('every stage output issue carries the code its raising site assigned', () => {
  const root = sharedFixture()
  const { invocation, stage } = fixtureInvocation(
    root,
    'implement',
    'implement-1-codes',
  )
  const output = baseOutput(invocation, stage) as unknown as Record<
    string,
    unknown
  >

  output.schema_version = 2
  output.invocation_id = 'another-invocation'
  output.result = 'partial'
  output.summary = '   '
  output.risks = 'not an array'
  output.data = 'not an object'
  output.platform_guidance_conflicts = [{ guidance: 'Plan mode' }]
  output.artifacts = [{ path: 'runtime/absent.html', description: '' }]

  const validation = validateStageOutput(
    root,
    stage,
    invocation,
    output,
    pendingBriefPaths(invocation),
  )
  const codes = new Set(validation.issues.map((issue) => issue.code))

  assert.ok(validation.issues.length > 0)
  assert.deepEqual(
    validation.issues.filter((issue) => issue.code === 'stage_output.invalid'),
    [],
    'no issue may degrade to the generic code',
  )
  assert.ok(validation.issues.every((issue) => issue.code.includes('.')))

  for (const code of [
    'stage_output.schema_version',
    'stage_output.invocation_id',
    'stage_output.result',
    'stage_output.summary',
    'stage_output.risks',
    'stage_output.data',
    'stage_output.platform_guidance_conflict_shape',
    'artifact.description',
  ]) {
    assert.ok(codes.has(code), `${code} MUST be reported: ${[...codes]}`)
  }

  // Every issue's code and message stay paired, so rewording one message
  // cannot move a code onto another issue.
  assert.equal(
    validation.errors.join('\n'),
    validation.issues.map((issue) => issue.message).join('\n'),
  )
})

test('strict stage output rejects success with failed self-evaluation', () => {
  const root = sharedFixture()
  const { invocation, stage } = fixtureInvocation(
    root,
    'verify',
    'verify-1-test',
  )
  const output = baseOutput(invocation, stage)

  output.criteria[0].result = 'fail'

  const validation = validateStageOutput(root, stage, invocation, output)

  assert.match(validation.errors.join('\n'), /contradicts failed criterion/u)
})

test('stage output rejects an unevaluated criterion on every result', () => {
  const root = sharedFixture()
  const { invocation, stage } = fixtureInvocation(
    root,
    'verify',
    'verify-1-unevaluated',
  )

  for (const result of ['success', 'failure', 'blocked'] as const) {
    const output = baseOutput(invocation, stage)
    const criterion = output.criteria.find(
      (item) => item.id === 'verify.tests_correct',
    )

    assert.ok(criterion)
    output.result = result
    criterion.result = 'unevaluated'

    const validation = validateStageOutput(root, stage, invocation, output)
    const matches = validation.issues.filter(
      (issue) => issue.code === 'criterion.unevaluated',
    )

    assert.equal(
      matches.length,
      1,
      `${result} reported ${matches.length} times`,
    )
    assert.match(matches[0].message, /remains unevaluated/u)
  }
})

test('pending_harness survives normalization only for resolved harness shells', () => {
  const root = sharedFixture()
  const { invocation, stage } = fixtureInvocation(root, 'implement', 'pending')

  delete invocation.output.operator_brief
  const output = baseOutput(invocation, stage)
  output.data = {
    implementation: { changed_files: [], tests_added: [], notes: [] },
    acceptance_results: [],
  }
  const shell = stage.criteria.find((criterion) => criterion.type === 'shell')

  assert.ok(shell)
  const claim = output.criteria.find((criterion) => criterion.id === shell.id)

  assert.ok(claim)
  claim.result = 'pending_harness'
  claim.evidence = []
  const validation = validateStageOutput(root, stage, invocation, output)

  assert.deepEqual(validation.errors, [])
  assert.equal(
    validation.output.criteria.find((criterion) => criterion.id === shell.id)
      ?.result,
    'pending_harness',
  )

  for (const type of ['judgment', 'state'] as const) {
    const invalidStage = {
      ...stage,
      criteria: stage.criteria.map((criterion) =>
        criterion.id === shell.id ? { ...criterion, type } : criterion,
      ),
    }
    const invalid = validateStageOutput(root, invalidStage, invocation, output)

    assert.ok(
      invalid.issues.some(
        (issue) => issue.code === 'criterion.pending_harness',
      ),
    )
    assert.ok(blockingCriterionStateErrors(invalid.issues).length > 0)
  }

  const unassigned = {
    ...invocation,
    rubric: invocation.rubric.filter((criterion) => criterion.id !== shell.id),
  }

  assert.ok(
    validateStageOutput(root, stage, unassigned, output).issues.some(
      (issue) => issue.code === 'criterion.pending_harness',
    ),
  )

  output.criteria.push({
    id: 'unknown.pending',
    result: 'pending_harness',
    explanation: '',
    evidence: [],
  })
  assert.ok(
    blockingCriterionStateErrors(
      validateStageOutput(root, stage, invocation, output).issues,
    ).some((message) => message.includes('unknown.pending')),
  )
})

test('pending harness outcomes require terminal deterministic evidence', () => {
  const root = sharedFixture()
  const { invocation, stage } = fixtureInvocation(root, 'implement', 'settle')
  const output = baseOutput(invocation, stage)
  const shell = stage.criteria.find((criterion) => criterion.type === 'shell')

  assert.ok(shell)
  output.criteria = output.criteria.map((claim) =>
    claim.id === shell.id ? { ...claim, result: 'pending_harness' } : claim,
  )
  const result = {
    id: shell.id,
    type: 'shell' as const,
    hard: true,
    passed: true,
    workspace_fingerprint: 'unit-fingerprint',
  }

  assert.equal(effectiveOutcome(stage, output, [], []), 'failure')
  assert.equal(
    effectiveOutcome(stage, output, [], [{ ...result, skipped: true }]),
    'failure',
  )
  assert.equal(
    effectiveOutcome(stage, output, [], [{ ...result, type: 'state' }]),
    'failure',
  )
  assert.equal(effectiveOutcome(stage, output, [], [result, result]), 'failure')
  assert.equal(effectiveOutcome(stage, output, [], [result]), 'success')
  assert.equal(
    effectiveOutcome(stage, output, [], [{ ...result, passed: false }]),
    'failure',
  )
  assert.equal(
    effectiveOutcome(
      stage,
      output,
      [],
      [{ ...result, passed: false, disabled: true }],
    ),
    'success',
  )
  assert.equal(
    output.criteria.find((claim) => claim.id === shell.id)?.result,
    'pending_harness',
  )
})

test('shell unevaluated remains scaffold-only on every declared outcome', () => {
  const root = sharedFixture()
  const { invocation, stage } = fixtureInvocation(
    root,
    'implement',
    'unfinished',
  )
  const output = baseOutput(invocation, stage)
  const shell = stage.criteria.find((criterion) => criterion.type === 'shell')

  assert.ok(shell)
  const claim = output.criteria.find((criterion) => criterion.id === shell.id)

  assert.ok(claim)
  claim.result = 'unevaluated'

  for (const result of ['success', 'failure', 'blocked'] as const) {
    output.result = result
    assert.ok(
      validateStageOutput(root, stage, invocation, output).issues.some(
        (issue) => issue.code === 'criterion.unevaluated',
      ),
    )
  }
})

test('stage output rejects a skipped criterion on success', () => {
  // The remediate stage carries a shell gate (`implement.lint`); verify no
  // longer declares one, because no verify gate runs a repository profile.
  const root = sharedFixture()
  const { invocation, stage } = fixtureInvocation(
    root,
    'remediate',
    'remediate-1-skipped-success',
  )
  const output = baseOutput(invocation, stage)
  const criterion = output.criteria.find((item) => item.id === 'implement.lint')

  assert.ok(criterion)
  criterion.result = 'skipped'

  const validation = validateStageOutput(root, stage, invocation, output)

  assert.deepEqual(
    validation.issues
      .filter((issue) => issue.code === 'criterion.skipped_on_success')
      .map((issue) => issue.message),
    ["A success result cannot skip criterion 'implement.lint'"],
  )
})

test('stage output rejects a skipped judgment criterion on failure', () => {
  const root = sharedFixture()
  const { invocation, stage } = fixtureInvocation(
    root,
    'remediate',
    'remediate-1-skipped-judgment',
  )
  const output = baseOutput(invocation, stage)
  const criterion = output.criteria.find(
    (item) => item.id === 'remediate.addresses_verdict',
  )

  assert.ok(criterion)
  output.result = 'failure'
  criterion.result = 'skipped'

  const validation = validateStageOutput(root, stage, invocation, output)

  assert.match(
    validation.errors.join('\n'),
    /remediate\.addresses_verdict' MUST NOT be skipped on a failure result unless it is a shell criterion/u,
  )

  criterion.result = 'pass'
  const shellCriterion = output.criteria.find(
    (item) => item.id === 'implement.lint',
  )

  assert.ok(shellCriterion)
  shellCriterion.result = 'skipped'

  const shellValidation = validateStageOutput(root, stage, invocation, output)

  assert.doesNotMatch(
    shellValidation.errors.join('\n'),
    /implement\.lint' MUST NOT be skipped on a failure result/u,
  )
})

test('stage output accepts a platform guidance conflict list and rejects a bare entry', () => {
  const root = sharedFixture()
  const { invocation, stage } = fixtureInvocation(
    root,
    'implement',
    'implement-1',
  )
  const stated = validateStageOutput(root, stage, invocation, {
    ...baseOutput(invocation, stage),
    platform_guidance_conflicts: [
      {
        guidance: 'Plan mode: do not edit files',
        covered_step: 'implement the accepted change',
        authority_followed: 'the implement invocation card and DEV-001',
      },
    ],
  })

  // OPERATOR-001 gives the conflict statement a field, so the validator must
  // accept it.
  assert.ok(
    !stated.errors.some((message) =>
      message.includes('platform_guidance_conflicts'),
    ),
    stated.errors.join('\n'),
  )
  assert.equal(stated.output.platform_guidance_conflicts?.length, 1)

  const bare = validateStageOutput(root, stage, invocation, {
    ...baseOutput(invocation, stage),
    platform_guidance_conflicts: [{ guidance: 'Plan mode' }],
  })

  assert.ok(
    bare.errors.some((message) =>
      /platform_guidance_conflicts\[0\] MUST name guidance, covered_step, and authority_followed/u.test(
        message,
      ),
    ),
  )
})

/**
 * A ship stage that cannot reach release preparation has to report the
 * precondition it lacks. Requiring the release packet on that result left the
 * honest report unsubmittable, so the stage failed on ten absent fields
 * instead of naming the one thing the operator had to supply.
 */
test('a blocked ship output declares its precondition instead of a release packet', () => {
  const root = sharedFixture()
  const { invocation, stage } = fixtureInvocation(root, 'ship', 'ship-1-test')
  const undeclared = validateStageOutput(
    root,
    stage,
    invocation,
    {
      ...baseOutput(invocation, stage),
      result: 'blocked',
      artifacts: briefArtifacts(invocation),
    },
    pendingBriefPaths(invocation),
  )

  assert.deepEqual(
    undeclared.errors.filter((message) => message.includes('data.release.')),
    [],
    'a blocked result owes no release field',
  )
  assert.deepEqual(
    undeclared.errors.filter((message) => message.includes('data.blocked.')),
    [],
  )

  const declared = validateStageOutput(
    root,
    stage,
    invocation,
    {
      ...baseOutput(invocation, stage),
      result: 'blocked',
      artifacts: briefArtifacts(invocation),
      data: {
        blocked: {
          missing_precondition: 'The managed worktree has no fetched main.',
          supplying_command: 'pan release sync --worktree w --run run-test',
        },
      },
    },
    pendingBriefPaths(invocation),
  )

  assert.deepEqual(declared.errors, [], declared.errors.join('\n'))
})

test('a structured unanswered operator question validates', () => {
  const root = sharedFixture()
  const { invocation, stage } = fixtureInvocation(root, 'ship', 'ship-question')
  const validation = validateStageOutput(
    root,
    stage,
    invocation,
    {
      ...baseOutput(invocation, stage),
      result: 'blocked',
      artifacts: briefArtifacts(invocation),
      operator_question: {
        question: 'Which credential may this run use?',
        reason: 'cursor/ask_question was unavailable.',
        evidence: [
          'The required credential is absent from the repository .env.',
        ],
      },
      data: {
        blocked: {
          missing_precondition: 'An authorized credential is unavailable.',
          supplying_command:
            'Provide the credential through the approved secret store.',
        },
      },
    },
    pendingBriefPaths(invocation),
  )

  assert.deepEqual(validation.errors, [], validation.errors.join('\n'))
})

test('a successful coordinator output does not owe verification or artifact-review fields', () => {
  const root = sharedFixture()
  const { invocation, stage } = fixtureInvocation(root, 'ship', 'ship-2-test')
  const output = baseOutput(invocation, stage)

  output.artifacts = briefArtifacts(invocation)
  output.data = {
    release: {
      summary: 'Fixture release',
      change_list: [],
      validation: [],
      waivers: [],
      follow_up_cases: [],
      governance_artifact_review: {
        summary: 'No issues',
        issues_reviewed: [],
        repairs: [],
        escalations: [],
      },
    },
  }

  const validation = validateStageOutput(
    root,
    stage,
    invocation,
    output,
    pendingBriefPaths(invocation),
  )

  assert.deepEqual(validation.errors, [])
})

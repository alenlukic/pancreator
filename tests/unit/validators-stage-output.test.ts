import assert from 'node:assert/strict'
import test from 'node:test'

import { validateStageOutput } from '../../src/lib/validation.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { createFixture } from '../fixture-template.js'
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
  const root = createFixture()
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
  const root = createFixture()
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
  const root = createFixture()
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
  const root = createFixture()
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

test('stage output rejects a skipped criterion on success', () => {
  // The remediate stage carries a shell gate (`implement.lint`); verify no
  // longer declares one, because no verify gate runs a repository profile.
  const root = createFixture()
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
  const root = createFixture()
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
  const root = createFixture()
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
  const root = createFixture()
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
    [
      'data.blocked.missing_precondition MUST be a non-empty string when ' +
        'the ship result is blocked',
      'data.blocked.supplying_command MUST be a non-empty string when the ' +
        'ship result is blocked',
    ],
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

test('a successful ship output still owes every release field', () => {
  const root = createFixture()
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

  assert.deepEqual(validation.errors, ['data.release.rollback MUST be string'])
})

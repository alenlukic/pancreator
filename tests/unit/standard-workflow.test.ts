import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  composeDesignWorkflow,
  workflowSupportsDesignComposition,
} from '../../src/lib/design-composition.js'
import { resolvePolicies } from '../../src/lib/policies.js'
import {
  orderedWorkerActions,
  renderEvidenceWorkerBrief,
  renderSupervisorProcedureMarkdown,
} from '../../src/lib/render.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { sharedFixture } from '../fixture-template.js'
import { baseInvocation, delegatedInvocation } from './render-helpers.js'

test('the standard workflow plans with an operator gate then parallel implement and verify', () => {
  const workflow = loadWorkflow(sharedFixture(), 'standard')

  assert.equal(workflow.start_stage, 'plan')
  assert.deepEqual(
    workflow.stages.map((stage) => stage.slug),
    ['plan', 'implement', 'verify', 'remediate', 'ship'],
  )

  const plan = stageBySlug(workflow, 'plan')

  assert.equal(plan.persona, 'planner')
  assert.equal(plan.gate, 'operator')
  assert.equal(plan.workspace_policy, 'runtime_only')
  assert.equal(plan.transitions.success, 'implement')
  assert.ok(plan.required_data?.test_scenarios)
  assert.equal(plan.required_data?.['interface_contract.interfaces'], 'array')
  assert.equal(plan.required_data?.cohort_plan, undefined)

  const implement = stageBySlug(workflow, 'implement')

  assert.equal(implement.persona, 'coder')
  assert.equal(implement.gate, 'next_stage')
  assert.equal(implement.workspace_policy, 'source_allowed')
  assert.equal(implement.transitions.success, 'verify')
  assert.deepEqual(
    implement.evidence_workers?.map((worker) => worker.role),
    ['implement', 'test-author'],
  )
  assert.deepEqual(
    implement.evidence_workers?.map((worker) => worker.persona),
    ['coder', 'test-author'],
  )
  assert.equal(implement.required_data?.['marshaling.edits'], undefined)
  assert.ok(
    implement.criteria.some(
      (criterion) => criterion.id === 'standard.contract_alignment',
    ),
  )
  assert.match(
    implement.evidence_workers?.[1]?.scope ?? '',
    /Do not build, compile, or run tests/u,
  )

  const verify = stageBySlug(workflow, 'verify')

  assert.equal(verify.workspace_policy, 'read_only')
  assert.equal(verify.gate, 'stage_verdict')
  assert.deepEqual(
    verify.evidence_workers?.map((worker) => worker.role),
    ['review', 'qa'],
  )
})

test('standard design composition prepends design and appends design evidence', () => {
  const root = sharedFixture()
  const base = loadWorkflow(root, 'standard')

  assert.equal(workflowSupportsDesignComposition(base), true)

  const composed = composeDesignWorkflow(root, base)

  assert.equal(composed.start_stage, 'design')
  assert.deepEqual(
    composed.stages.map((stage) => stage.slug),
    ['design', 'plan', 'implement', 'verify', 'remediate', 'ship'],
  )

  const verify = stageBySlug(composed, 'verify')

  assert.deepEqual(
    verify.evidence_workers?.map((worker) => worker.role),
    ['review', 'qa', 'design-review', 'design-qa'],
  )
})

test('standard implement resolves scenario and engineering policies and names no policy id', () => {
  const root = sharedFixture()
  const coder = resolvePolicies(root, {
    persona: 'coder',
    workflow: 'standard',
    stage: 'implement',
  }).map((policy) => policy.id)
  const author = resolvePolicies(root, {
    persona: 'test-author',
    workflow: 'standard',
    stage: 'implement',
  }).map((policy) => policy.id)

  assert.ok(coder.includes('DEV-001'))
  assert.ok(coder.includes('SCENARIO-001'))
  assert.ok(author.includes('SCENARIO-001'))
  assert.ok(author.includes('ENG-001'))

  const prompt = readFileSync(
    path.join(root, 'library/workflows/standard/prompts/implement.md'),
    'utf8',
  )

  assert.equal(
    /\b[A-Z][A-Z0-9]*-\d{3}\b/u.test(prompt),
    false,
    'the stage prompt MUST NOT restate a policy identifier',
  )
})

test('standard implement launches the implementer and test author in one watch', () => {
  const root = sharedFixture()
  const invocation = baseInvocation(root, 'standard', 'implement')

  invocation.delegation = delegatedInvocation(root).delegation
  assert.ok(invocation.delegation)
  invocation.delegation.watch_command =
    './bin/pan watch run-fixture --invocation inv-fixture'
  invocation.evidence_workers = [
    {
      persona: 'coder',
      role: 'implement',
      scope: 'Implement production code.',
      agent: 'pan-coder',
      model: 'implement-model',
      brief_path: 'runtime/logs/workflows/run-fixture/briefs/implement.md',
      evidence_path: 'runtime/logs/workflows/run-fixture/evidence/implement.md',
    },
    {
      persona: 'test-author',
      role: 'test-author',
      scope: 'Write tests from the plan.',
      agent: 'pan-test-author',
      model: 'test-author-model',
      brief_path: 'runtime/logs/workflows/run-fixture/briefs/test-author.md',
      evidence_path:
        'runtime/logs/workflows/run-fixture/evidence/test-author.md',
    },
  ]

  invocation.stage.workspace_policy = 'source_allowed'
  const brief = renderEvidenceWorkerBrief(
    invocation,
    invocation.evidence_workers[1]!,
  )
  assert.match(brief, /source-allowed/u)
  assert.match(brief, /marshal-test:/u)
  assert.match(brief, /data\.interface_contract/u)
  assert.match(brief, /passes evidence delivery only/u)
  assert.doesNotMatch(brief, /workspace is read-only/u)
  const actions = orderedWorkerActions(invocation)

  assert.deepEqual(
    actions.map((action) => [action.role, action.persona, action.agent]),
    [
      ['evidence', 'coder', 'pan-coder'],
      ['evidence', 'test-author', 'pan-test-author'],
      ['stage', 'coder', 'pan-coder'],
    ],
  )

  const procedure = renderSupervisorProcedureMarkdown(invocation)

  assert.match(procedure, /single message so they run concurrently/u)
  assert.ok(
    procedure.includes(
      '`./bin/pan watch run-fixture --invocation inv-fixture --until-evidence-complete`',
    ),
    procedure,
  )
  assert.ok(procedure.includes('1. `pan-coder`'), procedure)
  assert.ok(procedure.includes('2. `pan-test-author`'), procedure)
})

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { isRecord, readJson } from '../../src/lib/io.js'
import { finalizePlanningReferences } from '../../src/lib/cohorts/specifications.js'
import { policyDeliveryPlan } from '../../src/lib/projection.js'
import {
  renderInvocationMarkdown,
  invocationPolicyPointers,
} from '../../src/lib/render/invocation-markdown.js'
import {
  planningCriterionView,
  planningViewConflicts,
} from '../../src/lib/render/contract.js'
import { scaffoldDataFromRequiredData } from '../../src/lib/requirements/scaffold.js'
import type { HandlerInput } from '../../src/lib/requirements/types.js'
import {
  validateChildSpecifications,
  validateCohortPlan,
} from '../../src/lib/validators/cohort-plan.js'
import {
  validatePlanTrace,
  traceRegistryIds,
} from '../../src/lib/validators/stage/plan-trace.js'
import { validateInvocationMarkdown } from '../../src/lib/validation/invocation-markdown.js'
import { sharedFixture } from '../fixture-template.js'
import { createTestTempDirectory } from '../temp.js'
import { baseInvocation } from '../unit/render-helpers.js'

interface RetainedPlan {
  provenance: Record<string, unknown>
  initial_product_spec: Record<string, unknown>
  data: Record<string, unknown>
  specifications: Record<string, string>
}

function retained(name: string): RetainedPlan {
  const value = readJson(
    path.join(
      process.cwd(),
      `tests/fixtures/g01-planning/${name}-repairs.json`,
    ),
  )
  assert.ok(
    isRecord(value) &&
      isRecord(value.data) &&
      isRecord(value.specifications) &&
      isRecord(value.initial_product_spec) &&
      isRecord(value.provenance),
  )
  const specifications: Record<string, string> = {}
  for (const [file, content] of Object.entries(value.specifications)) {
    assert.equal(typeof content, 'string')
    if (typeof content === 'string') specifications[file] = content
  }
  return {
    data: value.data,
    initial_product_spec: value.initial_product_spec,
    provenance: value.provenance,
    specifications,
  }
}

function replay(name: string) {
  const fixture = retained(name)
  const root = createTestTempDirectory(`g01-${name}-`)
  const harness = sharedFixture()
  for (const directory of ['library', 'governance']) {
    symlinkSync(
      path.join(harness, directory),
      path.join(root, directory),
      'dir',
    )
  }
  mkdirSync(path.join(root, 'runtime'), { recursive: true })
  writeFileSync(
    path.join(root, 'runtime/repository-checks.json'),
    readFileSync(path.join(harness, 'runtime/repository-checks.json')),
  )
  for (const [file, content] of Object.entries(fixture.specifications)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), content)
  }
  const targetPath = 'output.json'
  assert.ok(
    isRecord(fixture.data.cohort_plan) &&
      typeof fixture.data.cohort_plan.parent_spec_path === 'string',
  )
  const runId = fixture.data.cohort_plan.parent_spec_path.split('/')[3]
  const invocationId = 'g01-plan-replay'
  finalizePlanningReferences(
    root,
    {
      run_id: runId,
      workflow_slug: 'planning',
      status: 'running',
      current_stage: 'plan',
      pending_action: {
        type: 'invoke_agent',
        persona: 'planner',
        path: 'card.md',
      },
      current_invocation: {
        id: invocationId,
        json_path: 'card.json',
        markdown_path: 'card.md',
        output_path: targetPath,
      },
      stage_history: [],
    },
    { invocation_id: invocationId, result: 'success', data: fixture.data },
    invocationId,
  )
  const write = (data: Record<string, unknown>) =>
    writeFileSync(path.join(root, targetPath), JSON.stringify({ data }))
  write(fixture.data)
  const input: HandlerInput = {
    root,
    targetPath,
    runState: { workspace_root: process.cwd() },
    requirement: {
      policy_id: 'PLAN-002',
      requirement_id: 'plan-trace-validate',
      registry_id: 'PLAN-TRACE-VALIDATE-001',
      arguments: {},
    },
  }
  return { ...fixture, root, input, write }
}

for (const name of ['three', 'seven']) {
  test(`G01 retained ${name}-repair plan passes registered handlers without product rewrites`, () => {
    const fixture = replay(name)
    for (const productSpec of [
      fixture.data.product_spec,
      fixture.initial_product_spec,
    ]) {
      const data = { ...fixture.data, product_spec: productSpec }
      fixture.write(data)
      for (const handler of [
        validatePlanTrace,
        validateCohortPlan,
        validateChildSpecifications,
      ]) {
        const result = handler(fixture.input)
        assert.equal(
          result.status,
          'passed',
          `${handler.name}: ${JSON.stringify(result.issues)}`,
        )
      }
      assert.deepEqual(readJson(path.join(fixture.root, 'output.json')), {
        data,
      })
      for (const [file, content] of Object.entries(fixture.specifications)) {
        const authored = (text: string) =>
          text.replace(
            /^\s*-\s+(?:Content digest|Reference status):.*$/gmu,
            '- Reference metadata: <harness>',
          )
        assert.equal(
          authored(readFileSync(path.join(fixture.root, file), 'utf8')),
          authored(content),
        )
      }
    }
  })

  test(`G01 ${name}-repair benchmark reports reproducible bytes and unavailable new execution metrics`, (t) => {
    const fixture = retained(name)
    const invocation = baseInvocation(sharedFixture(), 'planning', 'plan')
    invocation.stage.persona_executor = 'cursor'
    const inline = renderInvocationMarkdown(invocation)
    invocation.policy_delivery = policyDeliveryPlan(
      sharedFixture(),
      invocation.policies,
      {
        executor: 'cursor',
        mode: 'self_development',
        host: 'cursor',
      },
    )
    const pointed = renderInvocationMarkdown(invocation)
    assert.ok(Buffer.byteLength(pointed) < Buffer.byteLength(inline))
    const productBytes =
      Buffer.byteLength(JSON.stringify(fixture.data)) +
      Object.values(fixture.specifications).reduce(
        (sum, content) => sum + Buffer.byteLength(content),
        0,
      )
    const measurement = {
      fixture: name,
      method:
        'UTF-8 bytes of rendered planning card plus unchanged compact structured data and exact specification bytes',
      cursor: {
        before_bytes: Buffer.byteLength(inline) + productBytes,
        after_bytes: Buffer.byteLength(pointed) + productBytes,
      },
      copilot: {
        before_bytes: Buffer.byteLength(inline) + productBytes,
        after_bytes: Buffer.byteLength(inline) + productBytes,
        reason: 'No executor injection proof: full policies remain inline.',
      },
      historical: fixture.provenance.historical,
      new_execution: {
        calls: 'unavailable: deterministic replay only',
        compactions: 'unavailable: deterministic replay only',
        executor_duration: 'unavailable: deterministic replay only',
      },
      estimates:
        'Historical percentage and minute estimates overlap; no combined savings is calculated.',
    }
    assert.deepEqual(fixture.data, retained(name).data)
    t.diagnostic(JSON.stringify(measurement, null, 2))
  })
}

test('G01 trace and ownership checks reject unknown, missing, duplicate, and unowned declarations', () => {
  const fixture = replay('three')
  assert.ok(isRecord(fixture.data.product_spec))
  const original = fixture.data.product_spec
  const mutations = [
    { ...original, constraints: ['Missing identifier'] },
    {
      ...original,
      constraints: [
        { id: 'C-1', statement: 'One' },
        { id: 'C-1', statement: 'Two' },
      ],
    },
    { ...original, user_stories: [{ id: 'US-999', story: 'Unowned story' }] },
  ]
  for (const product_spec of mutations) {
    fixture.write({ ...fixture.data, product_spec })
    assert.equal(validatePlanTrace(fixture.input).status, 'failed')
    assert.equal(validateChildSpecifications(fixture.input).status, 'failed')
  }
  assert.ok(Array.isArray(fixture.data.acceptance_criteria))
  const criteria = fixture.data.acceptance_criteria.map((entry) =>
    isRecord(entry)
      ? { ...entry, maps_to: ['US-999', 'C-999', 'OOS-999'] }
      : entry,
  )
  fixture.write({ ...fixture.data, acceptance_criteria: criteria })
  const codes = validatePlanTrace(fixture.input).issues.map(
    (entry) => entry.code,
  )
  assert.ok(codes.includes('plan.maps_to_unknown'))
  for (const invalid of [null, '', 42, 'unknown']) {
    fixture.write({
      ...fixture.data,
      acceptance_criteria: fixture.data.acceptance_criteria.map((entry) =>
        isRecord(entry) ? { ...entry, maps_to: [invalid] } : entry,
      ),
    })
    assert.equal(validatePlanTrace(fixture.input).status, 'failed')
  }
  fixture.write({
    ...fixture.data,
    acceptance_criteria: [
      fixture.data.acceptance_criteria[0],
      fixture.data.acceptance_criteria[0],
    ],
  })
  assert.ok(
    validatePlanTrace(fixture.input).issues.some(
      (entry) => entry.code === 'plan.duplicate_criterion',
    ),
  )
})

test('G01 new scaffold registries demonstrate explicit identifier objects', () => {
  const data = scaffoldDataFromRequiredData(
    Object.fromEntries(
      ['user_stories', 'constraints', 'out_of_scope', 'open_questions'].map(
        (key) => [`product_spec.${key}`, 'array' as const],
      ),
    ),
  )
  assert.ok(isRecord(data.product_spec))
  for (const collection of Object.values(data.product_spec)) {
    assert.ok(Array.isArray(collection) && isRecord(collection[0]))
    assert.match(String(collection[0].id), /^(?:US|C|OOS|Q)-/u)
  }
})

test('G01 registered trace and cohort handlers accept the same object, prefix, and keyed registry matrix', () => {
  const fixture = replay('three')
  assert.ok(isRecord(fixture.data.product_spec))
  const original = fixture.data.product_spec
  for (const shape of ['objects', 'keyed', ':', '.', '-', '—', '–', ')']) {
    const product_spec = { ...original }
    for (const key of [
      'user_stories',
      'constraints',
      'out_of_scope',
      'open_questions',
    ]) {
      const collection = original[key]
      assert.ok(Array.isArray(collection))
      const entries = collection.map((entry) => {
        const [id] = traceRegistryIds([entry])
        assert.ok(id)
        const text =
          typeof entry === 'string'
            ? entry
            : isRecord(entry)
              ? (entry.statement ?? entry.description ?? entry.story)
              : null
        assert.equal(typeof text, 'string')
        return { id, statement: String(text) }
      })
      product_spec[key] =
        shape === 'objects'
          ? entries
          : shape === 'keyed'
            ? Object.fromEntries(
                entries.map(({ id, statement }) => [id, { statement }]),
              )
            : entries.map(
                ({ id, statement }) => `  ${id} ${shape} ${statement}`,
              )
    }
    const data = { ...fixture.data, product_spec }
    const before = structuredClone(data)
    fixture.write(data)
    for (const handler of [validatePlanTrace, validateChildSpecifications]) {
      const result = handler(fixture.input)
      assert.equal(
        result.status,
        'passed',
        `${shape}: ${JSON.stringify(result.issues)}`,
      )
    }
    assert.deepEqual(data, before)
    assert.deepEqual(readJson(path.join(fixture.root, 'output.json')), {
      data: before,
    })
  }
})

test('G01 derived criterion views detect statement, proof, unknown-id, and duplicate conflicts', () => {
  const criteria = [
    { id: 'AC-1', statement: 'Preserve the product facts.', proof: 'test' },
  ]
  const data = { acceptance_criteria: criteria }
  const view = `## Acceptance criteria\n${planningCriterionView(criteria)}\n## Dependencies\nNone.\n`
  assert.deepEqual(planningViewConflicts(data, view), [])
  for (const changed of [
    view.replace('product facts', 'new scope'),
    view.replace('proof: test', 'proof: review'),
    view.replace('[proof: test] ', ''),
    `${view}\n${view.replace('product facts', 'contradictory facts')}`,
    view.replace('AC-1', 'AC-999'),
    view.replace(
      '## Dependencies',
      `${planningCriterionView(criteria)}\n## Dependencies`,
    ),
  ])
    assert.notDeepEqual(planningViewConflicts(data, changed), [])
  assert.deepEqual(
    planningViewConflicts(
      data,
      view.replace('product facts.', 'product\n  facts.'),
    ),
    [],
  )
  const fixture = replay('three')
  const child = Object.keys(fixture.specifications).find(
    (file) => file.includes('child') || !file.includes('parent'),
  )
  assert.ok(child)
  writeFileSync(
    path.join(fixture.root, child),
    fixture.specifications[child].replace('[proof: test]', '[proof: review]'),
  )
  assert.ok(
    validatePlanTrace(fixture.input).issues.some(
      (entry) => entry.code === 'plan.view_conflict',
    ),
  )
})

for (const [label, identifier, heading, statement] of [
  [
    'bold identifier',
    '**AC-1**',
    '## Acceptance criteria',
    'Preserve the product facts.',
  ],
  [
    'italic identifier',
    '*AC-1*',
    '## Acceptance criteria',
    'Preserve the product facts.',
  ],
  [
    'backtick identifier',
    '`AC-1`',
    '## Acceptance criteria',
    'Preserve the product facts.',
  ],
  [
    'indented heading',
    'AC-1',
    '  ## Acceptance criteria  ',
    'Preserve the product facts.',
  ],
  [
    'wrapped statement',
    '**AC-1**',
    '  ## Acceptance criteria',
    'Preserve the product\n  facts.',
  ],
] as const) {
  test(`G01 criterion views reject contradictory statements with ${label}`, () => {
    const data = {
      acceptance_criteria: [
        { id: 'AC-1', statement: 'Preserve the product facts.', proof: 'test' },
      ],
    }
    const view = `${heading}\n1. ${identifier} [proof: test] ${statement}\n## Dependencies\n1. AC-999 [proof: test] Outside the acceptance section.\n`
    assert.deepEqual(planningViewConflicts(data, view), [])
    assert.deepEqual(
      planningViewConflicts(data, view.replace('product', 'contradictory')),
      ['AC-1'],
    )
  })
}

test('G01 criterion views stop at accepted indented headings', () => {
  const data = {
    acceptance_criteria: [
      { id: 'AC-1', statement: 'Preserve the product facts.', proof: 'test' },
    ],
  }
  assert.deepEqual(
    planningViewConflicts(
      data,
      '## Acceptance criteria\n1. AC-1 [proof: test] Preserve the product facts.\n  ## Dependencies\n1. AC-999 [proof: test] Outside the acceptance section.\n',
    ),
    [],
  )
})

test('G01 policy bodies require the matching executor and digest; nonplanning cards stay compatible', () => {
  const root = sharedFixture()
  const invocation = baseInvocation(root, 'planning', 'plan')
  invocation.stage.persona_executor = 'cursor'
  invocation.policy_delivery = policyDeliveryPlan(root, invocation.policies, {
    executor: 'cursor',
    mode: 'self_development',
    host: 'cursor',
  })
  const valid = renderInvocationMarkdown(invocation)
  assert.ok(invocationPolicyPointers(invocation).size > 0)
  assert.equal(validateInvocationMarkdown(invocation, valid).passed, true)
  const pointer = Object.entries(invocation.policy_delivery).find(
    ([, entry]) => entry.mode === 'pointer',
  )
  assert.ok(pointer)
  invocation.stage.persona_executor = 'copilot'
  const copilot = renderInvocationMarkdown(invocation)
  assert.equal(invocationPolicyPointers(invocation).size, 0)
  assert.ok(Buffer.byteLength(copilot) > Buffer.byteLength(valid))
  assert.equal(validateInvocationMarkdown(invocation, copilot).passed, true)
  assert.equal(validateInvocationMarkdown(invocation, valid).passed, false)
  for (const policy of invocation.policies)
    assert.ok(copilot.includes(policy.summary))
  invocation.stage.persona_executor = 'cursor'
  const [id, delivery] = pointer
  assert.equal(delivery.mode, 'pointer')
  if (delivery.mode === 'pointer') {
    invocation.policy_delivery[id] = { ...delivery, sha256: '0'.repeat(64) }
    assert.equal(invocationPolicyPointers(invocation).has(id), false)
    const stale = renderInvocationMarkdown(invocation)
    assert.equal(validateInvocationMarkdown(invocation, stale).passed, true)
    assert.equal(validateInvocationMarkdown(invocation, valid).passed, false)
    const policy = invocation.policies.find((entry) => entry.id === id)
    assert.ok(policy)
    assert.ok(stale.includes(policy.summary))
    assert.equal(
      validateInvocationMarkdown(invocation, stale.replace(policy.summary, ''))
        .passed,
      false,
    )
    invocation.policy_delivery[id] = { ...delivery, target: '' }
    assert.equal(invocationPolicyPointers(invocation).has(id), false)
    assert.equal(
      validateInvocationMarkdown(
        invocation,
        renderInvocationMarkdown(invocation),
      ).passed,
      true,
    )
  }
  invocation.policy_delivery = {}
  assert.equal(invocationPolicyPointers(invocation).size, 0)
  assert.equal(
    validateInvocationMarkdown(invocation, renderInvocationMarkdown(invocation))
      .passed,
    true,
  )
  const nonplanning = baseInvocation(root, 'delivery', 'implement')
  nonplanning.policy_delivery = {
    legacy: { mode: 'pointer', target: 'legacy-rule', sha256: 'legacy' },
  }
  assert.equal(
    invocationPolicyPointers(nonplanning).get('legacy')?.target,
    'legacy-rule',
  )
})

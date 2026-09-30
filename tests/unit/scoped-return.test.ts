import assert from 'node:assert/strict'
import test from 'node:test'

import {
  evaluateScopedReturn,
  type ScopedReturnFacts,
} from '../../src/lib/context.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'

const DECLARED = [
  { role: 'review', persona: 'reviewer', scope: 'Review scope.' },
  { role: 'qa', persona: 'qa-tester', scope: 'QA scope.' },
]

function facts(overrides: Partial<ScopedReturnFacts> = {}): ScopedReturnFacts {
  return {
    limits: {
      max_paths: 3,
      max_findings: 2,
      excluded_path_globs: ['governance/**'],
      dimensions: ['review', 'qa'],
    },
    declared: DECLARED,
    remediation_invocation_id: 'inv-remediate',
    routing: {
      invocation_id: 'inv-verify',
      verdict: 'fail_remedial',
      findings: [{ id: 'V-01', severity: 'high', source: 'qa' }],
    },
    blast_radius: ['src/lib/a.ts', 'tests/unit/a.test.ts'],
    deleted_paths: [],
    ...overrides,
  }
}

test('a small bounded repair scopes the return visit to the stage worker', () => {
  const decision = evaluateScopedReturn(facts())

  assert.ok(decision.scoped)
  assert.deepEqual(decision.scoped.blast_radius, [
    'src/lib/a.ts',
    'tests/unit/a.test.ts',
  ])
  assert.equal(decision.scoped.routing_invocation_id, 'inv-verify')
  assert.deepEqual(
    decision.scoped.dimensions.map((dimension) => dimension.role),
    ['review', 'qa'],
  )

  // A remediation the entry gate routed has no verify verdict behind it.
  assert.ok(evaluateScopedReturn(facts({ routing: null })).scoped)
  // Blocker-severity findings stay bounded by the finding limit only: a
  // failing verdict almost always carries one.
  assert.ok(
    evaluateScopedReturn(
      facts({
        routing: {
          invocation_id: 'inv-verify',
          verdict: 'fail_remedial',
          findings: [{ id: 'V-01', severity: 'blocker', source: 'qa' }],
        },
      }),
    ).scoped,
  )
})

test('every limit keeps the three-agent topology when it is exceeded', () => {
  const cases: Array<[string, Partial<ScopedReturnFacts>, RegExp]> = [
    [
      'four paths',
      {
        blast_radius: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
      },
      /changed 4 paths, above the limit of 3/u,
    ],
    ['no changed path', { blast_radius: [] }, /recorded no changed path/u],
    [
      'a governance path',
      { blast_radius: ['governance/policies/VERIFY-001.json'] },
      /changed governance\/policies\/VERIFY-001\.json/u,
    ],
    [
      'a deleted test',
      { deleted_paths: ['tests/unit/old.test.ts'] },
      /deletes tests: tests\/unit\/old\.test\.ts/u,
    ],
    [
      'fail_severe',
      {
        routing: {
          invocation_id: 'inv-verify',
          verdict: 'fail_severe',
          findings: [],
        },
      },
      /fail_severe/u,
    ],
    [
      'three findings',
      {
        routing: {
          invocation_id: 'inv-verify',
          verdict: 'fail_remedial',
          findings: [
            { id: 'V-01', severity: 'high', source: 'qa' },
            { id: 'V-02', severity: 'high', source: 'review' },
            { id: 'V-03', severity: 'low', source: 'review' },
          ],
        },
      },
      /3 findings, above the limit of 2/u,
    ],
    [
      'a design-composed stage',
      {
        declared: [
          ...DECLARED,
          {
            role: 'design-review',
            persona: 'design-reviewer',
            scope: 'Design scope.',
          },
        ],
      },
      /does not cover: design-review/u,
    ],
  ]

  for (const [name, overrides, reason] of cases) {
    const decision = evaluateScopedReturn(facts(overrides))

    assert.equal(decision.scoped, null, name)
    assert.match(decision.scoped === null ? decision.reason : '', reason, name)
  }
})

test('both delivery verify stages declare the scoped return limits', () => {
  for (const workflowName of ['delivery', 'delivery-chunk']) {
    const verify = stageBySlug(
      loadWorkflow(process.cwd(), workflowName),
      'verify',
    )

    assert.deepEqual(verify.scoped_return, {
      max_paths: 3,
      max_findings: 2,
      excluded_path_globs: ['governance/**'],
      dimensions: ['review', 'qa'],
    })
  }
})

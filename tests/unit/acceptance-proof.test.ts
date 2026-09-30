import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  ACCEPTANCE_PROOF_TYPES,
  acceptanceCriterionLines,
  acceptanceProofsFromMarkdown,
  isUserFacingPath,
  liveCriteriaDecision,
  runDeclaredChangePaths,
} from '../../src/lib/acceptance-proof.js'
import { createTestTempDirectory } from '../temp.js'

test('the proof types match the shared field contract enum', () => {
  const contract = JSON.parse(
    readFileSync(
      path.join(
        process.cwd(),
        'library/schemas/stage-output-requirements.json',
      ),
      'utf8',
    ),
  ) as {
    stages: { plan: { fields: Array<{ path: string; enum?: string[] }> } }
  }
  const field = contract.stages.plan.fields.find(
    (entry) => entry.path === 'data.acceptance_criteria[].proof',
  )

  assert.deepEqual(field?.enum, [...ACCEPTANCE_PROOF_TYPES])
})

test('criterion lines of the acceptance section carry their proof tags', () => {
  const spec = [
    '# Child specification',
    '',
    '## Acceptance criteria',
    '',
    '1. AC-001 [proof: live] The page renders the panel.',
    '2. **AC-002** [proof: Test] The parser accepts the field.',
    '- AC-003 The wording names the policy.',
    '3. AC-004 [proof: manual] An unknown tag.',
    'A line that names AC-005 without a list marker.',
    '',
    '## Validation',
    '',
    '1. AC-009 [proof: live] Outside the section.',
  ].join('\n')

  assert.deepEqual(acceptanceCriterionLines(spec), [
    { id: 'AC-001', tag: 'live' },
    { id: 'AC-002', tag: 'test' },
    { id: 'AC-003', tag: null },
    { id: 'AC-004', tag: 'manual' },
  ])
  assert.deepEqual(
    [...acceptanceProofsFromMarkdown(spec)],
    [
      ['AC-001', 'live'],
      ['AC-002', 'test'],
      ['AC-003', null],
      ['AC-004', null],
    ],
  )
})

test('QA runs for a live criterion or unknown proofs and skips otherwise', () => {
  assert.equal(liveCriteriaDecision(new Map()).run, true)
  assert.equal(
    liveCriteriaDecision(
      new Map([
        ['AC-1', 'test'],
        ['AC-2', null],
      ]),
    ).run,
    true,
  )

  const live = liveCriteriaDecision(
    new Map([
      ['AC-1', 'test'],
      ['AC-2', 'live'],
    ]),
  )

  assert.equal(live.run, true)
  assert.match(live.reason, /AC-2/u)

  const skipped = liveCriteriaDecision(
    new Map([
      ['AC-1', 'test'],
      ['AC-2', 'review'],
      ['AC-3', 'observe'],
    ]),
  )

  assert.equal(skipped.run, false)
  assert.match(skipped.reason, /1 test, 1 review, 1 observe/u)
})

test('a change that touches a user-facing surface runs QA without a live criterion', () => {
  const proofs = new Map([
    ['AC-1', 'test' as const],
    ['AC-2', 'review' as const],
  ])

  assert.equal(liveCriteriaDecision(proofs, ['src/engine.ts']).run, false)

  const surface = liveCriteriaDecision(proofs, [
    'src/engine.ts',
    'web/App.tsx',
    'web/theme.scss',
  ])

  assert.equal(surface.run, true)
  assert.match(
    surface.reason,
    /touches a user-facing surface: web\/App\.tsx, web\/theme\.scss$/u,
  )

  const many = liveCriteriaDecision(
    proofs,
    Array.from({ length: 7 }, (_, index) => `web/page-${index}.html`),
  )

  assert.match(many.reason, /web\/page-4\.html and 2 more$/u)
  assert.equal(isUserFacingPath('docs/Guide.MD'), false)
  assert.equal(isUserFacingPath('site/Index.HTML'), true)
})

test('declared change paths read the latest plan and implementation outputs', () => {
  const root = createTestTempDirectory('pan-declared-paths-')
  const write = (relative: string, data: unknown): string => {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
    writeFileSync(path.join(root, relative), JSON.stringify({ data }))

    return relative
  }
  const plan = write('outputs/plan-1.json', {
    engineering_plan: {
      files: [{ path: 'web/App.vue' }, { path: 'src/a.ts' }, { purpose: 'x' }],
    },
  })
  const oldImplement = write('outputs/implement-1.json', {
    implementation: { changed_files: ['web/stale.css'] },
  })
  const implement = write('outputs/implement-2.json', {
    implementation: { changed_files: ['src/a.ts', 'src/b.ts'] },
  })
  const failedRemediate = write('outputs/remediate-1.json', {
    implementation: { changed_files: ['web/failed.css'] },
  })

  const paths = runDeclaredChangePaths(root, {
    stage_history: [
      { stage: 'plan', outcome: 'success', output_path: plan },
      { stage: 'implement', outcome: 'success', output_path: oldImplement },
      { stage: 'implement', outcome: 'success', output_path: implement },
      { stage: 'remediate', outcome: 'failure', output_path: failedRemediate },
      { stage: 'verify', outcome: 'success', output_path: 'outputs/none.json' },
      {
        stage: 'remediate',
        outcome: 'success',
        output_path: 'outputs/gone.json',
      },
    ],
  })

  // Only the latest successful output of each stage counts, and a missing
  // output contributes nothing.
  assert.deepEqual(paths, ['web/App.vue', 'src/a.ts', 'src/b.ts'])
  assert.deepEqual(runDeclaredChangePaths(root, undefined), [])
})

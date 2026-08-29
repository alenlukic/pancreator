import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MACHINERY_TEST_PATTERNS,
  REVIEW_MACHINERY_PATTERNS,
  VERIFICATION_SUBSTRATE_PATTERNS,
  classifyReviewPaths,
  cliGovernanceBlocksChanged,
  conflictsByTier,
  diffPolicyTexts,
  reviewMachineryConflicts,
  reviewerMappingChanged,
  type ReviewClosure,
} from '../../src/lib/review-scope.js'

test('a target that leaves the squad alone reviews independently', () => {
  const conflicts = reviewMachineryConflicts([
    'src/lib/engine.ts',
    'tests/unit/workflow.test.ts',
    'library/skills/spotfix.md',
    'governance/policies/VERIFY-001.json',
  ])

  assert.deepEqual(conflicts, [])
})

test('a change to the lineup or a charter is a self-review conflict', () => {
  const conflicts = reviewMachineryConflicts([
    'src/lib/engine.ts',
    'library/skills/review-squad.md',
    'library/skills/review-squad-pancreator.md',
  ])

  assert.deepEqual(conflicts, [
    'library/skills/review-squad-pancreator.md',
    'library/skills/review-squad.md',
  ])
})

test('the coordinator, its policy, and both entry points are machinery', () => {
  const conflicts = reviewMachineryConflicts([
    'governance/policies/REVIEW-001.json',
    'governance/policies/SHEPHERD-001.json',
    'library/cursor/agents/shepherd-reviewer.md',
    'library/cursor/commands/pan-review.md',
    'library/cursor/commands/pan-shepherd.md',
    'library/personas/shepherd-reviewer.md',
    'library/skills/shepherd-pr.md',
  ])

  assert.equal(conflicts.length, 7)
})

test('a future lineup variant is covered without editing the pattern list', () => {
  const conflicts = reviewMachineryConflicts([
    'library/skills/review-squad-frontend.md',
  ])

  assert.deepEqual(conflicts, ['library/skills/review-squad-frontend.md'])
})

test('a near-miss path is not treated as machinery', () => {
  const conflicts = reviewMachineryConflicts([
    'library/skills/modern-code-review.md',
    'library/personas/reviewer.md',
    'library/cursor/agents/reviewer.md',
    'docs/review-notes.md',
  ])

  // The independent reviewer grades a conflict, so it is not machinery itself.
  assert.deepEqual(conflicts, [])
})

test('conflicts are deduplicated and sorted', () => {
  const conflicts = reviewMachineryConflicts([
    'library/skills/review-squad.md',
    'library/skills/review-squad.md',
    'governance/policies/REVIEW-001.json',
  ])

  assert.deepEqual(conflicts, [
    'governance/policies/REVIEW-001.json',
    'library/skills/review-squad.md',
  ])
})

test('every declared pattern points at a real machinery surface', () => {
  for (const pattern of [
    ...REVIEW_MACHINERY_PATTERNS,
    ...VERIFICATION_SUBSTRATE_PATTERNS,
  ]) {
    assert.match(
      pattern,
      /^(?:governance|library|src|tests|bin)\/|^CHANGELOG\.md$/u,
      `${pattern} must be a repository-relative harness path`,
    )
  }
})

const CLOSURE: ReviewClosure = {
  policies: {
    'REVIEW-001': 'governance/policies/REVIEW-001.json',
    'GLOBAL-002': 'governance/policies/GLOBAL-002.json',
    'ENG-001': 'governance/policies/ENG-001.json',
  },
  guidance: {
    'governance/handbooks/eng/engineering.md': 'ENG-001',
    'library/skills/review-squad.md': 'REVIEW-001',
  },
  persona_paths: [
    'library/personas/reviewer.md',
    'library/cursor/agents/reviewer.md',
    'library/personas/shepherd-reviewer.md',
    'library/cursor/agents/shepherd-reviewer.md',
  ],
  registry_paths: ['governance/registries/policy_lookup_table.json'],
}

test('a policy on the review card is a conduct conflict, not an instrument one', () => {
  const conflicts = classifyReviewPaths(
    ['governance/policies/GLOBAL-002.json', 'src/lib/engine.ts'],
    CLOSURE,
  )

  assert.deepEqual(conflicts, [
    {
      path: 'governance/policies/GLOBAL-002.json',
      tier: 'conduct',
      source: 'policy on the review card: GLOBAL-002',
    },
  ])
})

test('the mode policy stays instrument even though it is also on the card', () => {
  const [conflict] = classifyReviewPaths(
    ['governance/policies/REVIEW-001.json'],
    CLOSURE,
  )

  assert.equal(conflict.tier, 'instrument')
})

test('guidance a card policy delivers is conduct, and the lineup stays instrument', () => {
  const tiers = conflictsByTier(
    classifyReviewPaths(
      [
        'governance/handbooks/eng/engineering.md',
        'library/skills/review-squad.md',
      ],
      CLOSURE,
    ),
  )

  assert.deepEqual(
    tiers.conduct.map((item) => item.path),
    ['governance/handbooks/eng/engineering.md'],
  )
  assert.deepEqual(
    tiers.instrument.map((item) => item.path),
    ['library/skills/review-squad.md'],
  )
})

test('the reviewer persona and the lookup table are closure members', () => {
  const tiers = conflictsByTier(
    classifyReviewPaths(
      [
        'library/personas/reviewer.md',
        'governance/registries/policy_lookup_table.json',
      ],
      CLOSURE,
    ),
  )

  assert.equal(tiers.instrument.length, 1)
  assert.equal(tiers.conduct.length, 1)
})

test('verification substrate is its own tier and helpers match one lane deep', () => {
  const tiers = conflictsByTier(
    classifyReviewPaths(
      [
        'src/lib/validation.ts',
        'src/lib/validators/prototype-output.ts',
        'tests/helpers.ts',
        'tests/integration/delivery-helpers.ts',
        'tests/secondary/install-helpers.ts',
        'governance/registries/directive_exemptions.json',
        'CHANGELOG.md',
        'src/lib/engine.ts',
        'docs/operator-guide.md',
      ],
      CLOSURE,
    ),
  )

  assert.equal(tiers.substrate.length, 7)
  assert.equal(tiers.instrument.length, 0)
  assert.equal(tiers.conduct.length, 0)
})

test('an interior glob does not cross directories', () => {
  const [conflict] = classifyReviewPaths(
    ['tests/integration/nested/deep-helpers.ts'],
    CLOSURE,
  )

  assert.equal(conflict, undefined)
})

test('the standards delta names removed and added instructions', () => {
  const base = JSON.stringify({
    id: 'X-001',
    summary: 'old',
    instructions: ['Agents MUST keep A.', 'Agents MUST keep B.'],
  })
  const head = JSON.stringify({
    id: 'X-001',
    summary: 'new',
    instructions: ['Agents MUST keep A.', 'Agents MUST do C.'],
  })
  const delta = diffPolicyTexts('governance/policies/X-001.json', base, head)

  assert.ok(delta)
  assert.equal(delta.status, 'changed')
  assert.equal(delta.summary_changed, true)
  assert.deepEqual(delta.removed_instructions, ['Agents MUST keep B.'])
  assert.deepEqual(delta.added_instructions, ['Agents MUST do C.'])
})

test('an added or removed policy is reported as such, and no change is null', () => {
  const text = JSON.stringify({ id: 'Y-001', instructions: ['Agents MUST y.'] })

  assert.equal(diffPolicyTexts('p', text, text), null)
  assert.equal(diffPolicyTexts('p', null, text)?.status, 'added')
  assert.equal(diffPolicyTexts('p', text, null)?.status, 'removed')
  assert.deepEqual(diffPolicyTexts('p', null, text)?.added_instructions, [
    'Agents MUST y.',
  ])
})

test('only the reviewer and coordinator mappings count as a model-routing change', () => {
  const base = JSON.stringify({
    defaults: { reviewer: 'a', coder: 'c', 'shepherd-reviewer': 's' },
    configs: { balanced: { personas: { reviewer: 'a' } } },
  })
  const coderOnly = JSON.stringify({
    defaults: { reviewer: 'a', coder: 'c2', 'shepherd-reviewer': 's' },
    configs: { balanced: { personas: { reviewer: 'a' } } },
  })
  const reviewerMoved = JSON.stringify({
    defaults: { reviewer: 'a', coder: 'c', 'shepherd-reviewer': 's' },
    configs: { balanced: { personas: { reviewer: 'b' } } },
  })

  assert.equal(reviewerMappingChanged(base, coderOnly), false)
  assert.equal(reviewerMappingChanged(base, reviewerMoved), true)
  assert.equal(reviewerMappingChanged(base, base), false)
})

test('the check wrappers lint and install are verification substrate', () => {
  const tiers = conflictsByTier(
    classifyReviewPaths(['bin/lint', 'bin/install', 'bin/pan'], CLOSURE),
  )

  assert.deepEqual(
    tiers.substrate.map((item) => item.path),
    ['bin/install', 'bin/lint'],
  )
})

test('the tests of each machinery module are derived substrate', () => {
  assert.deepEqual(MACHINERY_TEST_PATTERNS, [
    'tests/*/review-scope*.test.ts',
    'tests/*/governance-card*.test.ts',
    'tests/*/policies*.test.ts',
    'tests/*/policy-guidance*.test.ts',
  ])

  const tiers = conflictsByTier(
    classifyReviewPaths(
      [
        'tests/unit/review-scope.test.ts',
        'tests/unit/review-scope-resolve.test.ts',
        'tests/unit/governance-card.test.ts',
        'tests/unit/workflow.test.ts',
      ],
      CLOSURE,
    ),
  )

  assert.deepEqual(
    tiers.substrate.map((item) => item.path),
    [
      'tests/unit/governance-card.test.ts',
      'tests/unit/review-scope-resolve.test.ts',
      'tests/unit/review-scope.test.ts',
    ],
  )
})

test('only a change inside the governance case of cli.ts is an entry-point change', () => {
  const before = [
    "    case 'validate': {",
    '      return 1',
    '    }',
    "    case 'governance': {",
    "      if (sub === 'card') {",
    '        return build()',
    '      }',
    '    }',
    "    case 'best-of-n': {",
    '      return 2',
    '    }',
  ].join('\n')
  const cardChanged = before.replace('return build()', 'return build(opts)')
  const otherChanged = before.replace('return 2', 'return 3')

  assert.equal(cliGovernanceBlocksChanged(before, cardChanged), true)
  assert.equal(cliGovernanceBlocksChanged(before, otherChanged), false)
  assert.equal(cliGovernanceBlocksChanged(before, before), false)
  // A null side means the file gained the case, which changes the entry point.
  assert.equal(cliGovernanceBlocksChanged(null, before), true)
})

test('a policy row with no instruction or summary change is not a standards delta', () => {
  const base = JSON.stringify({
    id: 'Z-001',
    summary: 'same',
    instructions: ['Agents MUST z.'],
  })
  const reformatted = JSON.stringify(
    { id: 'Z-001', summary: 'same', instructions: ['Agents MUST z.'] },
    null,
    2,
  )
  const retitled = JSON.stringify({
    id: 'Z-001',
    title: 'new title',
    summary: 'same',
    instructions: ['Agents MUST z.'],
  })

  assert.equal(diffPolicyTexts('p', base, reformatted), null)
  assert.equal(diffPolicyTexts('p', base, retitled), null)
})

test('reordering config keys is not a reviewer mapping change', () => {
  const base = JSON.stringify({
    defaults: { reviewer: 'a', 'shepherd-reviewer': 's' },
    configs: {
      balanced: { personas: { reviewer: 'a' } },
      fast: { personas: { reviewer: 'b' } },
    },
  })
  const reordered = JSON.stringify({
    defaults: { reviewer: 'a', 'shepherd-reviewer': 's' },
    configs: {
      fast: { personas: { reviewer: 'b' } },
      balanced: { personas: { reviewer: 'a' } },
    },
  })

  assert.equal(reviewerMappingChanged(base, reordered), false)
})

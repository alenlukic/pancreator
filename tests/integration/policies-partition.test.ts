import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { sharedFixture } from '../fixture-template.js'
import { resolvePolicies } from '../../src/lib/policies.js'
import { STANDALONE_MODES } from '../../src/lib/governance-card.js'
import { filterPolicyInstructionsForCard } from '../../src/lib/policy-instructions.js'
import { resolveRequirements } from '../../src/lib/requirements/resolve.js'

const CATEGORY_NOUN = /\bcategor(?:y|ies)\b/iu

const UNIVERSAL_QUANTIFIER = /\b(?:every|each)\b/iu

/**
 * The three things a repair instruction surface must say about the category
 * partition, each stated over sentence structure rather than wording. A
 * surface may reword any of them; it may not drop the universal quantifier
 * that binds the duty to the whole registry.
 */
const PARTITION_CLAUSES = [
  {
    id: 'assess_every_category',
    holds: (sentence: string): boolean =>
      UNIVERSAL_QUANTIFIER.test(sentence) &&
      CATEGORY_NOUN.test(sentence) &&
      /\b(?:judges?|assess(?:es)?|audits?)\b/iu.test(sentence),
  },
  {
    id: 'one_intake_per_category',
    holds: (sentence: string): boolean =>
      UNIVERSAL_QUANTIFIER.test(sentence) &&
      CATEGORY_NOUN.test(sentence) &&
      /\bintakes?\b/iu.test(sentence) &&
      /\bwrites?\b/iu.test(sentence),
  },
  {
    id: 'report_cleared_categories',
    holds: (sentence: string): boolean =>
      CATEGORY_NOUN.test(sentence) &&
      /\breports?\b/iu.test(sentence) &&
      (UNIVERSAL_QUANTIFIER.test(sentence) ||
        /\b(?:no|none)\b/iu.test(sentence)),
  },
]

/**
 * Partition clauses no single sentence of the surface states.
 *
 * Sentence scope carries the strength a verbatim pin used to carry: a surface
 * that scatters the same words across unrelated sentences states no
 * partition, which is how one shared pattern loose enough to fit all three
 * surfaces degenerated into /categor/i.
 */
function unstatedPartitionClauses(text: string): string[] {
  const sentences = text
    .split(/\n\s*\n|\n(?=[ \t]*(?:[-*+] |\d+\. |#{1,6} ))/u)
    .flatMap((block) =>
      block
        .replace(/\s+/gu, ' ')
        .trim()
        .split(/(?<=[a-z0-9)\]`'"])\.\s+/u),
    )

  return PARTITION_CLAUSES.filter(
    (clause) => !sentences.some((sentence) => clause.holds(sentence)),
  ).map((clause) => clause.id)
}

test('every repair instruction surface agrees on the category partition', () => {
  const root = sharedFixture()

  // The partition contract is spread across a policy, a persona, a projected
  // agent, and a command. A reverted singular phrase on any one of them makes
  // the harness technician collapse the partition back into one document, so
  // each surface is pinned here. Only the registry names the categories, so
  // no surface may carry a second copy of the list.
  const categories = (
    JSON.parse(
      readFileSync(
        path.join(root, 'governance/registries/harness_repair_categories.json'),
        'utf8',
      ),
    ) as { categories: Array<{ slug: string }> }
  ).categories

  assert.ok(categories.length > 0)

  const surfaces = [
    'library/personas/harness-technician.md',
    'library/cursor/agents/harness-technician.md',
    'library/cursor/commands/pan-repair.md',
  ].map((relative) => ({
    relative,
    text: readFileSync(path.join(root, relative), 'utf8'),
  }))

  for (const surface of surfaces) {
    assert.deepEqual(
      unstatedPartitionClauses(surface.text),
      [],
      `${surface.relative} must state the category partition`,
    )

    // Dropping the universal quantifier is what collapses the partition back
    // into one document, so the check has to fail on a surface that lost it.
    // The pin this replaced removed its own single match and then asserted
    // the removal, which a pattern occurring once can never contradict.
    const withoutQuantifier = unstatedPartitionClauses(
      surface.text.replace(/\b(?:every|each)\b/giu, 'the'),
    )

    for (const clause of ['assess_every_category', 'one_intake_per_category']) {
      assert.ok(
        withoutQuantifier.includes(clause),
        `${surface.relative} partition check must fail on ${clause} once the quantifier is gone`,
      )
    }

    assert.doesNotMatch(
      surface.text,
      /write only the declared intake under/u,
      `${surface.relative} must not fence writes to a single intake`,
    )
    assert.doesNotMatch(
      surface.text,
      /one intake by default/u,
      `${surface.relative} must not restore the one-intake default`,
    )

    // A copied list spells each slug out; a surface that reads the registry
    // names the pattern instead.
    const copied = categories
      .filter((category) => surface.text.includes(`\`${category.slug}\``))
      .map((category) => category.slug)

    assert.deepEqual(
      copied,
      [],
      `${surface.relative} must read the category list rather than copy it`,
    )

    // Both cost dimensions run unprompted; an audit that skips them files no
    // finding for correct but wasteful work.
    assert.match(
      surface.text,
      /efficiency\s+profile/u,
      `${surface.relative} must require the run efficiency profile`,
    )
    assert.match(
      surface.text,
      /spend --days 7 --json/u,
      `${surface.relative} must require the spend report`,
    )
  }

  const persona = surfaces[0]?.text ?? ''

  assert.match(persona, /MUST follow the\s+operator rather than the category/u)
  assert.match(persona, /\*\*Category:\*\* <display name>/u)

  const agent = surfaces[1]?.text ?? ''

  assert.match(agent, /harness_repair_categories\.json/u)

  const command = surfaces[2]?.text ?? ''

  assert.match(command, /once for each intake path/u)
  assert.match(command, /harness-repair-<UTC timestamp>-<category-slug>-/u)
  assert.doesNotMatch(command, /requested intake count/u)
})

test('ship, write-pr, and conform keep required STE checks', () => {
  const root = sharedFixture()
  const requiredSte = (
    persona: string,
    workflow: string,
    stage: string,
    invocationKind: 'workflow' | 'standalone',
  ): string[] =>
    resolveRequirements(root, {
      persona,
      workflow,
      stage,
      invocation_kind: invocationKind,
    })
      .validation_requirements.filter(
        (requirement) =>
          requirement.registry_id === 'SIMPLIFIED-ENGLISH-VALIDATE-001' &&
          requirement.enforcement === 'required',
      )
      .map((requirement) => requirement.requirement_id)
      .sort()

  assert.deepEqual(
    requiredSte('release-steward', 'delivery', 'ship', 'workflow'),
    ['workflow-pr-simplified-english-validate'],
  )
  assert.deepEqual(
    requiredSte('release-steward', 'standalone', 'write-pr', 'standalone'),
    ['standalone-pr-simplified-english-validate'],
  )
  assert.deepEqual(
    requiredSte('librarian', 'standalone', 'conform', 'standalone'),
    ['standalone-conform-simplified-english-validate'],
  )

  // STE-001 keeps the check advisory for every artifact except a final PR
  // description. The research document therefore resolves only the generic
  // advisory check, and exactly once, so `pan requirements run` can select it.
  assert.deepEqual(
    requiredSte('researcher', 'standalone', 'research', 'standalone'),
    [],
  )
  assert.deepEqual(
    resolveRequirements(root, {
      persona: 'researcher',
      workflow: 'standalone',
      stage: 'research',
      invocation_kind: 'standalone',
    })
      .validation_requirements.filter(
        (requirement) =>
          requirement.registry_id === 'SIMPLIFIED-ENGLISH-VALIDATE-001',
      )
      .map((requirement) => [
        requirement.requirement_id,
        requirement.enforcement,
      ]),
    [['simplified-english-validate', 'advisory']],
  )

  const planner = resolvePolicies(root, {
    persona: 'planner',
    workflow: 'planning',
    stage: 'plan',
  }).map((policy) => policy.id)

  assert.equal(planner.includes('STE-001'), false)
})

test('no conform policy forbids an edit the conform boundary requires', () => {
  const root = sharedFixture()
  const mode = STANDALONE_MODES.conform

  assert.ok(mode)

  const policies = resolvePolicies(root, {
    persona: mode.persona,
    workflow: mode.workflow,
    stage: mode.stage,
  })
  const rendered = policies.flatMap((policy) =>
    filterPolicyInstructionsForCard(policy.instructions, 'agent').map(
      (instruction) => `${policy.id}: ${instruction.text}`,
    ),
  )

  const boundary = mode.boundaries.join('\n')
  const editable = mode.boundaries.find((line) =>
    line.includes('MUST edit only'),
  )
  // The instruction surfaces `STE-001` names sit on their own boundary line.
  const repairable = mode.boundaries
    .filter(
      (line) =>
        line.includes('MUST edit only') || line.includes('MUST also repair'),
    )
    .join('\n')

  // One sentence carries the exclusion, and the exception that follows
  // `except` is the governed set rather than part of the exclusion.
  const exclusions = rendered
    .flatMap((instruction) => instruction.split(/(?<=\.)\s+/u))
    .filter((sentence) =>
      /outside (?:the|those|these) (?:writing )?rules|MUST NOT restyle/u.test(
        sentence,
      ),
    )

  assert.ok(editable, boundary)

  // Fail closed. The replaced guard skipped its own body when the exclusion
  // was reworded, and discarded every word after the first `except`, so it
  // passed against the base text it was written to reject.
  assert.ok(
    exclusions.length > 0,
    `no rendered conform instruction states an exclusion:\n${rendered.join('\n')}`,
  )

  // The boundary requires the librarian to repair these paths, so no rendered
  // instruction may place them outside the writing rules of this card.
  for (const required of [
    'docs/issues/',
    'runtime/pr-descriptions/',
    'governance/policies/',
    'governance/criteria/',
    'library/personas/',
    'library/skills/',
    'library/cursor/commands/',
    'library/cursor/rules/',
    'AGENTS.md',
  ]) {
    assert.ok(repairable.includes(required), `the boundary omits ${required}`)

    for (const sentence of exclusions) {
      const exceptAt = sentence.search(/\bexcept\b/u)
      const excluded = exceptAt === -1 ? sentence : sentence.slice(0, exceptAt)

      assert.ok(
        !excluded.includes(required),
        `${sentence} forbids restyling ${required}, which the conform boundary requires`,
      )
    }
  }

  // Absence is not the contract. The carve-out MUST be stated, so a revert to
  // an exclusion covering all of `docs/` fails here rather than passing.
  const hasCarveOut = (sentences: string[], required: string): boolean =>
    sentences.some((sentence) => {
      const exceptAt = sentence.search(/\bexcept\b/u)

      return exceptAt !== -1 && sentence.slice(exceptAt).includes(required)
    })

  for (const required of ['docs/issues/', 'governance/policies/']) {
    assert.ok(
      hasCarveOut(exclusions, required),
      `no rendered conform instruction carves ${required} out of its exclusion:\n${rendered.join('\n')}`,
    )
  }
  assert.equal(
    hasCarveOut(
      ['All documentation under docs/ is outside the writing rules.'],
      'docs/issues/',
    ),
    false,
    'the pre-change broad docs exclusion must fail the carve-out guard',
  )
  assert.equal(
    hasCarveOut(
      [
        'Source code, code comments, commit messages, README.md, and governance/ are also outside those rules.',
      ],
      'governance/policies/',
    ),
    false,
    'the pre-change broad governance exclusion must fail the policy carve-out guard',
  )
  // The pre-change sentence above carries no `except`, so it would fail for
  // any argument and demonstrates nothing about the carve-out itself. This
  // pair does: one sentence, one `except`, and the verdict turns only on
  // which path the clause names.
  assert.equal(
    hasCarveOut(
      [
        'Everything under governance/ is outside those rules, except governance/handbooks/.',
      ],
      'governance/policies/',
    ),
    false,
    'a carve-out naming another path must not satisfy the policy carve-out',
  )
  assert.equal(
    hasCarveOut(
      [
        'Everything under governance/ is outside those rules, except governance/handbooks/.',
      ],
      'governance/handbooks/',
    ),
    true,
    'the predicate reads the path the except clause actually names',
  )

  // The boundary reserves release metadata, so nothing on the card may hand it
  // to this persona. The replaced pin named the removed wording, so any other
  // wording that grants the same edit passed it.
  assert.ok(!editable.includes('CHANGELOG.md'), editable)
  assert.ok(
    mode.boundaries.some(
      (line) => line.includes('CHANGELOG.md') && line.includes('MUST NOT edit'),
    ),
    boundary,
  )
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

/**
 * Every surface that used to route the unit commit or the group merge to a
 * person. The harness owns both steps now, and a surface that says otherwise
 * stops a supervisor the policy already freed, so the list is asserted as a
 * whole rather than repaired one file at a time.
 */
const RECONCILED_SURFACES = [
  'AGENTS.md',
  'governance/policies/COHORT-001.json',
  'governance/policies/AWAY-001.json',
  'governance/policies/ACTION-001.json',
  'library/templates/embedded-AGENTS.md',
  'library/templates/detached-AGENTS.md',
  'library/cursor/rules/pancreator-embedded.mdc',
  'library/cursor/rules/pancreator-self-development.mdc',
  'library/personas/orchestrator.md',
  'library/cursor/commands/pan-cohort.md',
  'docs/operator-guide.md',
  'docs/runtime-protocol.md',
]

/**
 * The subset that has to state the new owner rather than merely drop the old
 * wording. `docs/runtime-protocol.md` is excluded: its reconciliation is the
 * away-authored waiver, and the cohort lifecycle is not its subject.
 */
const COHORT_OWNING_SURFACES = RECONCILED_SURFACES.filter(
  (surface) => surface !== 'docs/runtime-protocol.md',
)

/**
 * Short, stable phrases that only a retired stance produces. Each one is
 * narrow enough that the replacement wording cannot trip it, so the guard
 * fails on a reintroduced human step rather than on an ordinary rewrite.
 */
const RETIRED_PHRASES = [
  'cohort integrate` are operator-owned',
  'cohort integrate` is the one merge',
  'the one merge you ask for',
  'the one merge the operator asks for',
  'commit the chunk branch',
  'committing a chunk branch',
  'committed chunk branches',
  'dirty chunk worktree',
  'commit them yourself',
  'commit or stash the chunk',
]

/** Prohibitions the change must not have loosened while it freed the merge. */
const RETAINED_PROHIBITIONS = ['push', 'publication', 'deployment', 'branch']

function read(file: string): string {
  return readFileSync(path.join(process.cwd(), file), 'utf8')
}

/** A policy instruction is a bare string or an audience-scoped object. */
function instructions(policy: string): string[] {
  const parsed = JSON.parse(read(`governance/policies/${policy}.json`)) as {
    instructions: Array<string | { text: string }>
  }

  assert.ok(
    Array.isArray(parsed.instructions) && parsed.instructions.length > 0,
    `${policy} declares no instructions`,
  )

  return parsed.instructions.map((entry) =>
    typeof entry === 'string' ? entry : entry.text,
  )
}

test('no reconciled surface still routes a unit commit or a group merge to a person', () => {
  for (const surface of RECONCILED_SURFACES) {
    const body = read(surface).toLowerCase()

    assert.ok(body.length > 0, `${surface} is empty`)

    for (const phrase of RETIRED_PHRASES) {
      assert.ok(
        !body.includes(phrase.toLowerCase()),
        `${surface} still carries the retired phrase '${phrase}'`,
      )
    }
  }
})

test('every reconciled surface states that the harness owns the cohort integration', () => {
  // A sweep that only deletes wording leaves the reader with no rule at all.
  // Each surface has to say who owns the step instead.
  for (const surface of COHORT_OWNING_SURFACES) {
    const body = read(surface).toLowerCase()

    assert.match(
      body,
      /harness/u,
      `${surface} never names the harness as the owner of the integration`,
    )
    assert.ok(
      body.includes('cohort integrat') ||
        body.includes('integration') ||
        body.includes('merges the group') ||
        body.includes('merge proof'),
      `${surface} never describes the cohort integration`,
    )
  }
})

test('AWAY-001 prohibits only the actions the operator kept, and bars no commit or merge', () => {
  const away = instructions('AWAY-001')
  const prohibition = away.find((text) =>
    text.startsWith('Away mode MUST NOT run'),
  )

  assert.equal(
    prohibition,
    'Away mode MUST NOT run push, publication, deployment, or ' +
      'branch-deletion actions, and SHOULD NOT run gate-waiver actions.',
  )

  // No other clause may put a commit or a merge back on the prohibited list.
  for (const text of away) {
    if (!/MUST NOT/u.test(text)) {
      continue
    }

    assert.ok(
      !/MUST NOT[^.]*\b(commit|merge)\b/u.test(text),
      `AWAY-001 still bars away mode from a commit or a merge: ${text}`,
    )
  }
})

test('the freed merge did not loosen push, publication, deployment, or branch deletion', () => {
  for (const policy of ['AWAY-001', 'ACTION-001', 'COHORT-001']) {
    const body = instructions(policy).join('\n').toLowerCase()

    for (const prohibition of RETAINED_PROHIBITIONS) {
      assert.ok(
        body.includes(prohibition),
        `${policy} no longer mentions ${prohibition}`,
      )
    }

    assert.match(
      body,
      /operator-owned|must not/u,
      `${policy} states no prohibition at all`,
    )
  }

  const card = read('AGENTS.md')

  assert.match(
    card,
    /MUST NOT commit, push, merge, publish, deploy, rewrite history, delete branches, or destructively reset without explicit operator authorization/u,
  )
})

test('COHORT-001 still requires a stated operator reason to exclude one unit from a group', () => {
  const exclusion = instructions('COHORT-001').find(
    (text) => /exclusion of one unit/iu.test(text) && /operator/u.test(text),
  )

  assert.ok(
    exclusion,
    'COHORT-001 no longer governs excluding a unit from a group',
  )
  assert.match(exclusion, /reason/u)
})

test('WAIVER-001 lets away mode author a waiver only under its own authorship', () => {
  const authorship = instructions('WAIVER-001').find((text) =>
    /away mode MAY author a waiver/iu.test(text),
  )

  assert.ok(authorship, 'WAIVER-001 does not admit an away-authored waiver')
  assert.match(authorship, /guardrails/u)
  assert.match(authorship, /MUST record away authorship/u)
  assert.match(authorship, /MUST NOT record operator authorship/u)
})

test('COHORT-001 keeps the safety properties that never needed a person', () => {
  const cohort = instructions('COHORT-001').join('\n')

  // An unsucceeded unit, a dirty integration checkout, and a conflict each
  // still leave the merge proof unwritten. Automation changed who acts, not
  // what is safe to merge.
  assert.match(cohort, /unsuccessful unit run/iu)
  assert.match(cohort, /integration checkout holding uncommitted work/iu)
  assert.match(cohort, /conflicting merge/iu)
  assert.match(cohort, /leave the merge proof unwritten/iu)
})

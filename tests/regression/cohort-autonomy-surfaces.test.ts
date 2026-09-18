import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

/**
 * Every surface that used to route the unit commit or the group merge to a
 * person, and every surface that later carried the cohort-integration
 * carve-out from a blanket commit-and-merge prohibition. Commit and merge are
 * now agent-judgment actions everywhere, so a surface that reintroduces either
 * the human step or the carve-out stops an agent the policy already freed. The
 * list is asserted as a whole rather than repaired one file at a time.
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
 * The subset that still has to say the harness owns the cohort integration.
 * The invariant surfaces (`AGENTS.md`, `ACTION-001`, the templates, and the
 * rules) no longer need to mention it: once commit and merge are ordinary
 * agent actions, the integration is not an exception to anything.
 */
const COHORT_OWNING_SURFACES = [
  'governance/policies/COHORT-001.json',
  'library/personas/orchestrator.md',
  'library/cursor/commands/pan-cohort.md',
  'docs/operator-guide.md',
]

/**
 * The surfaces that state the operator-owned action list. Each one has to
 * carry the `pan-dev` landing rule, because that rule is what replaced the
 * prohibition rather than an extra clause beside it.
 */
const DEV_LANDING_SURFACES = [
  'AGENTS.md',
  'governance/policies/ACTION-001.json',
  'library/templates/embedded-AGENTS.md',
  'library/templates/detached-AGENTS.md',
  'library/cursor/rules/pancreator-embedded.mdc',
  'library/cursor/rules/pancreator-self-development.mdc',
]

/**
 * Short, stable phrases that only a retired stance produces. Each one is
 * narrow enough that the replacement wording cannot trip it, so the guard
 * fails on a reintroduced human step or carve-out rather than on an ordinary
 * rewrite.
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
  'cohort integration is the exception',
  'cohort integration is the one carve-out',
  'is the one carve-out',
  'only retries that advance, so any agent may run it',
  'must not commit, push, merge',
  'must not originate commit, push, merge',
  'must not run git commit',
]

/**
 * Prohibitions the change must not have loosened while it freed the merge.
 * `ACTION-001` names Git commands rather than release actions, so its list is
 * the command list; publication and deployment live on the away and cohort
 * policies.
 */
const RETAINED_PROHIBITIONS: Record<string, string[]> = {
  'AWAY-001': ['push', 'publication', 'deployment', 'branch'],
  'ACTION-001': ['push', 'branch deletion', 'history rewrite'],
  'COHORT-001': ['push', 'publication', 'deployment', 'branch'],
}

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

test('no reconciled surface still routes a unit commit or a group merge to a person, or carves the integration out of a prohibition', () => {
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

test('every cohort-owning surface states that the harness owns the cohort integration', () => {
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

test('ACTION-001 frees commit and local merge, keeps the remote and destructive prohibitions, and lands agent work on pan-dev', () => {
  const action = instructions('ACTION-001')
  const prohibition = action.find((text) =>
    text.startsWith('Agents MUST NOT run'),
  )

  assert.ok(prohibition, 'ACTION-001 no longer states a command prohibition')
  assert.ok(
    !/\bgit commit\b/u.test(prohibition),
    `ACTION-001 still prohibits git commit: ${prohibition}`,
  )
  assert.ok(
    !/\bgit merge\b/u.test(prohibition),
    `ACTION-001 still prohibits a local git merge: ${prohibition}`,
  )
  for (const kept of [
    'git push',
    'gh pr create',
    'gh pr merge',
    'branch deletion',
    'history rewrite',
    'destructive reset',
  ]) {
    assert.ok(
      prohibition.includes(kept),
      `ACTION-001 no longer prohibits ${kept}: ${prohibition}`,
    )
  }

  const landing = action.find((text) => /\bcommit and merge\b/iu.test(text))

  assert.ok(landing, 'ACTION-001 no longer says where agents commit and merge')
  assert.match(landing, /`pan-dev`/u)
  assert.match(landing, /MUST NOT merge into `main`/u)
  assert.match(landing, /operator promotes `pan-dev` to `main`/u)
})

test('the freed commit and merge did not loosen push, publication, deployment, or branch deletion', () => {
  for (const [policy, retained] of Object.entries(RETAINED_PROHIBITIONS)) {
    const body = instructions(policy).join('\n').toLowerCase()

    for (const prohibition of retained) {
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
    /MUST NOT push, publish, deploy, rewrite history, delete branches, or destructively reset without explicit operator authorization/u,
  )
  // `MUST NOT commit`, or a MUST NOT list that opens with commit, is the
  // retired stance. A rule that merely mentions a release commit is not.
  assert.doesNotMatch(
    card,
    /MUST NOT (?:\w+ )?commit\b/u,
    'AGENTS.md puts commit back on a MUST NOT list',
  )
})

test('every operator-owned action list surface states the pan-dev landing rule once and adds no branching clause', () => {
  for (const surface of DEV_LANDING_SURFACES) {
    const body = read(surface)

    assert.match(
      body,
      /commit and merge[^.\n]*`pan-dev`/iu,
      `${surface} never says agents commit and merge on pan-dev`,
    )
    assert.match(
      body,
      /operator promotes `pan-dev` to `main`/u,
      `${surface} never names the operator's pan-dev-to-main promotion`,
    )
    assert.equal(
      body.match(/operator promotes `pan-dev` to `main`/gu)?.length,
      1,
      `${surface} states the promotion rule more than once`,
    )
    assert.ok(
      !/trailer|path-scop/iu.test(body),
      `${surface} adds a branching rule beyond the pan-dev landing idea`,
    )
  }
})

test('mode policies pair operator-owned and agent-owned unit exclusion', () => {
  const regular = instructions('SINGLERUN-001').find(
    (text) => /exclusion of one unit/iu.test(text) && /operator/u.test(text),
  )
  const horizon = instructions('HORIZON-001').find((text) =>
    /integrating agent MAY exclude/iu.test(text),
  )

  assert.ok(regular, 'the regular mode lost operator-owned unit exclusion')
  assert.match(regular, /reason/u)
  assert.ok(horizon, 'the long-horizon mode lost agent-owned unit exclusion')
  assert.match(horizon, /recorded reason/iu)
  assert.match(horizon, /follow-up/iu)
  assert.match(horizon, /dependents/iu)
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

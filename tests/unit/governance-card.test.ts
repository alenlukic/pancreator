import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  STANDALONE_MODES,
  buildGovernanceCard,
} from '../../src/lib/governance-card.js'
import { createFixture } from '../helpers.js'

test('the pair card resolves coder governance without workflow structure', () => {
  const root = createFixture()
  const card = buildGovernanceCard(root, {
    mode: 'pair',
    outputPath: 'runtime/inbox/pair-card.md',
  })
  const ids = card.policies.map((policy) => policy.id)

  // Pair programming relaxes workflow structure, not code quality: the coder's
  // engineering and language governance must still be present.
  assert.ok(ids.includes('PAIR-001'))
  assert.ok(ids.includes('ENG-001'))
  assert.ok(ids.includes('OPERATOR-001'))
  assert.ok(ids.includes('ACTION-001'))

  // No workflow-stage artifact contract applies, so nothing should demand one.
  const agentRequirements = [
    ...card.requirements.automation_requirements,
    ...card.requirements.validation_requirements,
  ].filter((requirement) => requirement.executor !== 'harness')

  assert.deepEqual(agentRequirements, [])

  const written = readFileSync(path.join(root, card.path), 'utf8')

  assert.match(written, /# 🤝 Pair programming/u)
  assert.match(
    written,
    /\*\*PAIR-001 · Operator-directed pair programming\*\*/u,
  )
  assert.match(written, /## 🚧 Boundaries/u)
  assert.match(written, /no gate, no declared stage output, and no transition/u)
})

test('every standalone mode renders a card with its policies inlined', () => {
  const root = createFixture()

  for (const name of Object.keys(STANDALONE_MODES)) {
    const card = buildGovernanceCard(root, {
      mode: name,
      outputPath: `runtime/inbox/${name}-card.md`,
    })

    assert.ok(card.policies.length > 0, `${name} resolved no policies`)

    const written = readFileSync(path.join(root, card.path), 'utf8')

    for (const policy of card.policies) {
      assert.ok(
        written.includes(`**${policy.id} · ${policy.title}**`),
        `${name} card omits ${policy.id}`,
      )

      for (const instruction of policy.instructions) {
        assert.ok(
          written.includes(instruction),
          `${name} card omits an instruction of ${policy.id}`,
        )
      }
    }
  }
})

test('the best-of-N card flattens child supervision to stage workers', () => {
  const root = createFixture()
  const card = buildGovernanceCard(root, {
    mode: 'best-of-n',
    outputPath: 'runtime/inbox/best-of-n-card.md',
  })

  assert.match(
    card.markdown,
    /directly perform supervisor mechanics for every child run/u,
  )
  assert.match(
    card.markdown,
    /MUST NOT delegate a child run to another `pan-orchestrator`/u,
  )
  assert.match(
    card.markdown,
    /run-scoped worker agents with foreground, blocking calls/u,
  )
  assert.match(
    card.markdown,
    /terminal candidate failures without creating an operator gate/u,
  )
  assert.doesNotMatch(card.markdown, /operator's top-level agent/u)
})

test('the spotfix card references the spotfix procedure guidance', () => {
  const root = createFixture()
  const card = buildGovernanceCard(root, {
    mode: 'spotfix',
    outputPath: 'runtime/inbox/spotfix-card.md',
  })
  const spotfix = card.policies.find((policy) => policy.id === 'SPOT-001')

  assert.ok(spotfix)

  const guidance = (spotfix.guidance ?? [])[0]

  assert.ok(guidance, 'SPOT-001 must carry its procedure reference')
  assert.ok(guidance.reference)

  const written = readFileSync(path.join(root, card.path), 'utf8')

  // The card points at library/skills/spotfix.md and keeps the body out.
  assert.match(
    written,
    /### Guidance reference · `library\/skills\/spotfix\.md`/u,
  )
  assert.ok(written.includes(`Read when: ${guidance.reference.read_trigger}`))
  assert.ok(written.includes(`sha256:${guidance.reference.content_sha256}`))
  assert.ok(!written.includes(guidance.content))
})

test('the shepherd card resolves coder governance and references the procedure', () => {
  const root = createFixture()
  const card = buildGovernanceCard(root, {
    mode: 'shepherd',
    outputPath: 'runtime/inbox/shepherd-card.md',
  })
  const ids = card.policies.map((policy) => policy.id)

  // The shepherd implements accepted feedback, so the coder's engineering
  // governance must ride along with the loop procedure itself.
  assert.ok(ids.includes('SHEPHERD-001'))
  assert.ok(ids.includes('ENG-001'))
  assert.ok(ids.includes('ACTION-001'))

  const shepherd = card.policies.find((policy) => policy.id === 'SHEPHERD-001')

  assert.ok(shepherd)

  const guidance = (shepherd.guidance ?? [])[0]

  assert.ok(guidance, 'SHEPHERD-001 must carry its procedure reference')
  assert.ok(guidance.reference)

  const written = readFileSync(path.join(root, card.path), 'utf8')

  assert.match(
    written,
    /### Guidance reference · `library\/skills\/shepherd-pr\.md`/u,
  )
  assert.ok(written.includes(`Read when: ${guidance.reference.read_trigger}`))
  assert.ok(!written.includes(guidance.content))
  assert.match(written, /head branch/u)
})

test('the shared worktree option resolves or creates the card workspace', () => {
  const root = createFixture()
  const card = buildGovernanceCard(root, {
    mode: 'spotfix',
    outputPath: 'runtime/inbox/spotfix-worktree-card.md',
    worktreeName: 'fix-it',
  })

  assert.ok(card.worktree)
  assert.equal(card.worktree.name, 'fix-it')
  assert.equal(card.worktree.path, 'worktrees/operator/fix-it')

  const written = readFileSync(path.join(root, card.path), 'utf8')

  assert.match(written, /## 🌳 Workspace worktree/u)
  assert.ok(written.includes('`worktrees/operator/fix-it`'))
  assert.match(written, /Do not change the main checkout/u)

  // A second card with the same name reuses the recorded worktree.
  const again = buildGovernanceCard(root, {
    mode: 'pair',
    outputPath: 'runtime/inbox/pair-worktree-card.md',
    worktreeName: 'fix-it',
  })

  assert.equal(again.worktree?.path, card.worktree.path)

  // Without the option, no workspace section is rendered.
  const plain = buildGovernanceCard(root, {
    mode: 'pair',
    outputPath: 'runtime/inbox/pair-plain-card.md',
  })

  assert.equal(plain.worktree, undefined)
  assert.doesNotMatch(plain.markdown, /Workspace worktree/u)
})

test('an unknown mode lists the available modes', () => {
  const root = createFixture()

  assert.throws(
    () => buildGovernanceCard(root, { mode: 'nonsense' }),
    /Available: best-of-n, decomposition, investigation, pair, repair, review, shepherd, spotfix/u,
  )
})

test('a missing operator input is reported rather than silently omitted', () => {
  const root = createFixture()

  assert.throws(
    () =>
      buildGovernanceCard(root, {
        mode: 'pair',
        requestPath: 'runtime/inbox/does-not-exist.md',
      }),
    /Operator input does not exist/u,
  )
})

test('the review card resolves reviewer governance and references the squad', () => {
  const root = createFixture()
  const card = buildGovernanceCard(root, {
    mode: 'review',
    outputPath: 'runtime/inbox/review-card.md',
  })
  const ids = card.policies.map((policy) => policy.id)

  // A standalone review reads code, so the reviewer's engineering governance
  // rides along with the mode policy and its delegation authority.
  assert.ok(ids.includes('REVIEW-001'))
  assert.ok(ids.includes('DELEGATE-001'))
  assert.ok(ids.includes('ENG-001'))

  const review = card.policies.find((policy) => policy.id === 'REVIEW-001')

  assert.ok(review)

  const guidance = (review.guidance ?? [])[0]

  assert.ok(guidance, 'REVIEW-001 must carry its squad reference')
  assert.equal(guidance.source_path, 'library/skills/review-squad.md')
  assert.ok(guidance.reference)

  const written = readFileSync(path.join(root, card.path), 'utf8')

  // The card points at the squad skill and keeps the body out of the card.
  assert.match(
    written,
    /### Guidance reference · `library\/skills\/review-squad\.md`/u,
  )
  assert.ok(!written.includes(guidance.content))
})

test('the review mode is bound to no run and edits nothing', () => {
  const mode = STANDALONE_MODES.review

  assert.ok(mode)
  assert.equal(mode.workflow, 'standalone')
  assert.equal(mode.stage, 'review')
  assert.equal(mode.kind, 'review')
  assert.ok(
    mode.boundaries.some((boundary) => /MUST NOT edit/u.test(boundary)),
    'a review session must be barred from editing',
  )
  assert.ok(
    mode.boundaries.some((boundary) =>
      /MUST issue the dimension fan-out yourself/u.test(boundary),
    ),
    'the session keeps dimension agents on the mapped model by spawning them',
  )
  assert.ok(
    mode.boundaries.some((boundary) =>
      /MUST NOT join, rank, or grade findings yourself/u.test(boundary),
    ),
    'the coordinator alone owns the verdict',
  )
})

test('the review command routes through the card and the coordinator', () => {
  const command = readFileSync(
    path.join(process.cwd(), 'library/cursor/commands/pan-review.md'),
    'utf8',
  )

  // Without these three the command is prose: the card resolves governance,
  // the capture is what every dimension agent reads, and the coordinator is
  // the only thing the session is allowed to spawn.
  assert.match(command, /governance card --mode review/u)
  assert.match(command, /review-target\.diff/u)
  assert.match(command, /pan-shepherd-reviewer/u)
  assert.match(command, /REVIEW-001/u)
  // The command reviews any ref from any checkout, so it has to say how the
  // reviewing agents end up reading the tree the diff applies to.
  assert.match(command, /worktree create <name> --from <target-head>/u)
  // The squad must not grade the files that define how it grades.
  assert.match(command, /governance review-scope --target/u)
  assert.match(command, /pan-reviewer/u)
})

test('the review policy binds the workspace to the target head', () => {
  const root = createFixture()
  const card = buildGovernanceCard(root, {
    mode: 'review',
    outputPath: 'runtime/inbox/review-card.md',
  })
  const review = card.policies.find((policy) => policy.id === 'REVIEW-001')

  assert.ok(review)
  assert.ok(
    review.instructions.some(
      (instruction) =>
        /bind the review workspace to the target/u.test(instruction) &&
        /worktree/u.test(instruction),
    ),
    'a review must read code from the tree its capture applies to',
  )
})

test('the review policy refuses to let the squad grade its own instrument', () => {
  const root = createFixture()
  const card = buildGovernanceCard(root, {
    mode: 'review',
    outputPath: 'runtime/inbox/review-card.md',
  })
  const review = card.policies.find((policy) => policy.id === 'REVIEW-001')

  assert.ok(review)
  assert.ok(
    review.instructions.some(
      (instruction) =>
        /review-scope check/u.test(instruction) &&
        /independent reviewer/u.test(instruction),
    ),
    'a self-review conflict must route to a reviewer outside the squad',
  )
})

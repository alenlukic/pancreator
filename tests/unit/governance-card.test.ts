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

test('an unknown mode lists the available modes', () => {
  const root = createFixture()

  assert.throws(
    () => buildGovernanceCard(root, { mode: 'nonsense' }),
    /Available: decomposition, investigation, pair, repair, shepherd, spotfix/u,
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

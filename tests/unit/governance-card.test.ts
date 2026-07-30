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

test('the spotfix card unrolls the spotfix procedure guidance', () => {
  const root = createFixture()
  const card = buildGovernanceCard(root, {
    mode: 'spotfix',
    outputPath: 'runtime/inbox/spotfix-card.md',
  })
  const spotfix = card.policies.find((policy) => policy.id === 'SPOT-001')

  assert.ok(spotfix)
  assert.ok(
    (spotfix.guidance ?? []).length > 0,
    'SPOT-001 must carry its unrolled procedure',
  )

  const written = readFileSync(path.join(root, card.path), 'utf8')

  // The command no longer tells the agent to open library/skills/spotfix.md.
  assert.match(
    written,
    /### Unrolled guidance · `library\/skills\/spotfix\.md`/u,
  )
})

test('an unknown mode lists the available modes', () => {
  const root = createFixture()

  assert.throws(
    () => buildGovernanceCard(root, { mode: 'nonsense' }),
    /Available: decomposition, investigation, pair, repair, spotfix/u,
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

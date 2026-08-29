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

      // Guidance references render as a heading, a read trigger, and a digest;
      // the guidance body itself stays out of the card.
      for (const guidance of policy.guidance ?? []) {
        if (!guidance.reference) continue

        assert.ok(
          written.includes(
            `### Guidance reference · \`${guidance.source_path}\``,
          ),
          `${name} card omits the ${policy.id} guidance reference heading`,
        )
        assert.ok(
          written.includes(`Read when: ${guidance.reference.read_trigger}`),
          `${name} card omits the ${policy.id} read trigger`,
        )
        assert.ok(
          written.includes(`sha256:${guidance.reference.content_sha256}`),
          `${name} card omits the ${policy.id} guidance digest`,
        )
        assert.ok(
          !written.includes(guidance.content),
          `${name} card inlines the ${policy.id} guidance body`,
        )
      }
    }
  }

  // The remediation modes carry their procedure documents by reference.
  for (const [name, policyId, sourcePath] of [
    ['spotfix', 'SPOT-001', 'library/skills/spotfix.md'],
    ['shepherd', 'SHEPHERD-001', 'library/skills/shepherd-pr.md'],
  ]) {
    const card = buildGovernanceCard(root, {
      mode: name,
      outputPath: `runtime/inbox/${name}-procedure-card.md`,
    })
    const policy = card.policies.find((item) => item.id === policyId)

    assert.ok(policy, `${name} must resolve ${policyId}`)

    const guidance = (policy.guidance ?? [])[0]

    assert.ok(guidance, `${policyId} must carry its procedure reference`)
    assert.ok(guidance.reference)
    assert.equal(guidance.source_path, sourcePath)
    assert.ok(
      readFileSync(path.join(root, card.path), 'utf8').includes(
        `### Guidance reference · \`${sourcePath}\``,
      ),
    )
  }
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

  // An unknown mode lists the available modes.
  assert.throws(
    () => buildGovernanceCard(root, { mode: 'nonsense' }),
    /Available: best-of-n, decomposition, investigation, pair, repair, shepherd, spotfix/u,
  )
})

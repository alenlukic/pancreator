import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  STANDALONE_MODES,
  buildGovernanceCard,
} from '../../src/lib/governance-card.js'
import {
  buildReviewClosure,
  reviewMachineryConflicts,
} from '../../src/lib/review-scope.js'
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
    /Available: best-of-n, decomposition, investigation, pair, repair, review, shepherd, spotfix, unbound/u,
  )
})

// Rehomed from the governance branch at integration: these cases prove
// rules that branch adds and have no other home in the consolidated suite.

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

test('the review card renders base conduct for a card policy the target changes', () => {
  const root = createFixture()
  const policyPath = path.join(root, 'governance/policies/GLOBAL-002.json')
  const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as {
    instructions: string[]
  }
  const baseInstructionCount = policy.instructions.length

  policy.instructions.push(
    'Agents MUST record a fixture-only clause added by the reviewed change.',
  )
  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`)
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' })

  git(['add', 'governance/policies/GLOBAL-002.json'])
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'change'])

  const card = buildGovernanceCard(root, {
    mode: 'review',
    outputPath: 'runtime/inbox/review-card.md',
    baseRef: 'HEAD~1',
    targetRef: 'HEAD',
  })
  const written = readFileSync(path.join(root, card.path), 'utf8')

  // GLOBAL-002 is on the reviewer's card, so the session reviews the change
  // under the base text: the section renders base instructions and omits
  // the clause the change added.
  assert.match(written, /## 🧭 Conduct under the base revision/u)
  assert.match(written, /\*\*GLOBAL-002 · base text\*\*/u)

  const section =
    written.split('## 🧭 Conduct under the base revision')[1] ?? ''

  // The head text still renders under "Policies in force" — it is what the
  // session is reviewing — and it is marked as under review directly under its
  // heading, so a reader meets the marker before the first instruction.
  const inline = written.split('## 🧭 Conduct under the base revision')[0] ?? ''
  const globalBlock = inline.split('**GLOBAL-002 · ')[1] ?? ''

  assert.match(globalBlock.split('\n\n')[1] ?? '', /^> Under review\./u)
  assert.ok(section.length > 0)
  assert.ok(
    !section.includes('fixture-only clause added by the reviewed change'),
  )
  assert.ok(
    written.includes('fixture-only clause added by the reviewed change'),
  )
  const baseBullets = section
    .split('\n')
    .filter(
      (line) =>
        line.startsWith('- Agents MUST') ||
        line.startsWith('- Source-changing'),
    )

  assert.equal(baseBullets.length, baseInstructionCount)
})

test('--target without --base is refused before any side effect', () => {
  const root = createFixture()

  assert.throws(
    () =>
      buildGovernanceCard(root, {
        mode: 'review',
        targetRef: 'HEAD',
        worktreeName: 'never-created',
      }),
    /--target requires --base/u,
  )
  assert.equal(existsSync(path.join(root, 'worktrees')), false)
})

test('an instrument-only policy change renders no base conduct block', () => {
  const root = createFixture()
  const policyPath = path.join(root, 'governance/policies/REVIEW-001.json')
  const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as {
    instructions: string[]
  }

  policy.instructions.push('The session MUST record a fixture-only clause.')
  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`)
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' })

  git(['add', 'governance/policies/REVIEW-001.json'])
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'change'])

  const card = buildGovernanceCard(root, {
    mode: 'review',
    outputPath: 'runtime/inbox/review-card.md',
    baseRef: 'HEAD~1',
    targetRef: 'HEAD',
  })
  const written = readFileSync(path.join(root, card.path), 'utf8')

  // REVIEW-001 is instrument tier: excluded from the squad verdict and graded
  // by the independent reviewer. Binding conduct to its base text would hand
  // the session two protocols, so it is excluded, not rendered as conduct.
  assert.doesNotMatch(written, /\*\*REVIEW-001 · base text\*\*/u)
  assert.match(written, /No conduct conflict exists between base and head/u)
  assert.match(written, /governance\/policies\/REVIEW-001\.json/u)
})

test('a guidance-only conduct conflict names the base text command', () => {
  const root = createFixture()
  const closure = buildReviewClosure(root)
  const instrument = new Set(
    reviewMachineryConflicts(Object.keys(closure.guidance)),
  )
  const guidancePath = Object.keys(closure.guidance).find(
    (candidate) =>
      !instrument.has(candidate) && existsSync(path.join(root, candidate)),
  )

  assert.ok(
    guidancePath,
    'the reviewer card delivers at least one guidance file',
  )
  writeFileSync(
    path.join(root, guidancePath),
    `${readFileSync(path.join(root, guidancePath), 'utf8')}\nFixture-only guidance line.\n`,
  )
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' })

  git(['add', guidancePath])
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'change'])

  const card = buildGovernanceCard(root, {
    mode: 'review',
    outputPath: 'runtime/inbox/review-card.md',
    baseRef: 'HEAD~1',
    targetRef: 'HEAD',
  })
  const written = readFileSync(path.join(root, card.path), 'utf8')

  // The remedy the session performed must not go silent: the card names the
  // path and the command that yields its base text instead of denying that
  // any conduct rule changed.
  assert.doesNotMatch(written, /No conduct conflict exists/u)
  assert.match(written, /base text not inlined/u)
  assert.match(written, /git show [0-9a-f]{12}:/u)
  assert.ok(written.includes(guidancePath))
})

test('the projected coordinator agent carries the resolve and join shapes', () => {
  const agent = readFileSync(
    path.join(process.cwd(), 'library/cursor/agents/shepherd-reviewer.md'),
    'utf8',
  )

  // The agent file is the first normative text the coordinator reads. An
  // unconditional fan-out there reintroduces nested dimension spawns on the
  // platform default model, which REVIEW-001 moved to the session.
  assert.match(agent, /\*\*resolve\*\* mode/u)
  assert.match(agent, /\*\*join\*\* mode/u)
  assert.match(agent, /spawn nothing/u)
  assert.doesNotMatch(
    agent,
    /Then delegate one dimension agent per charter in one message, join/u,
  )
})

test('--base is refused outside the review mode', () => {
  const root = createFixture()

  assert.throws(
    () => buildGovernanceCard(root, { mode: 'pair', baseRef: 'HEAD' }),
    /--base applies to the review mode only/u,
  )
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { STANDALONE_MODES } from '../../src/lib/governance-card.js'
import { resolvePolicies } from '../../src/lib/policies.js'

const REPO_ROOT = process.cwd()

/**
 * The universal bootstrap an agent reads before it has any card. An agent that
 * followed only the orientation list here announced it had checked governance,
 * read `config.json`, the primer, and the repository-check profile, and never
 * ran `pan governance card`. No policy body reached it.
 */
const BOOTSTRAP_SURFACES = [
  'AGENTS.md',
  'library/cursor/rules/pancreator-self-development.mdc',
  'library/cursor/rules/pancreator-embedded.mdc',
] as const

function readSurface(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')
}

test('every bootstrap surface orders the governance card before orientation reading', () => {
  for (const surface of BOOTSTRAP_SURFACES) {
    const content = readSurface(surface)

    assert.ok(
      content.includes('governance card --mode unbound'),
      `${surface} MUST name the command that resolves an unbound agent's card`,
    )

    // Ordering is the contract. The orientation list is reachable and concrete,
    // so a card requirement stated after it is the one an agent skips.
    const cardAt = content.indexOf('governance card --mode unbound')
    const primerAt = content.indexOf('docs/target-repo-primer.md')

    assert.ok(primerAt !== -1, `${surface} MUST name the primer`)
    assert.ok(
      cardAt < primerAt,
      `${surface} MUST require the governance card before the primer`,
    )

    // Reading the orientation files is the specific substitution the agent
    // made. The surface must reject it by name rather than merely omit it.
    assert.match(
      content,
      /do not satisfy (?:that|this) step/u,
      `${surface} MUST deny that the orientation files satisfy the card step`,
    )
  }
})

test('every bootstrap surface binds chat output to COMMS-001 without a card', () => {
  for (const surface of BOOTSTRAP_SURFACES) {
    const content = readSurface(surface)

    assert.ok(
      content.includes('COMMS-001'),
      `${surface} MUST name the policy that governs operator chat output`,
    )
    assert.match(
      content,
      /before you resolve any card/u,
      `${surface} MUST bind COMMS-001 to a response written before any card`,
    )
  }
})

test('the unbound routing requirement is not conditioned on repository work', () => {
  const content = readSurface('AGENTS.md')

  // A chat-only request does no repository work, which is exactly the response
  // COMMS-001 governs. The old trigger excluded it.
  assert.ok(
    !content.includes('Before substantive repository work'),
    'the unbound trigger MUST NOT exempt a response that touches no repository file',
  )
  assert.ok(
    content.includes('Before its first substantive response'),
    'the unbound trigger MUST bind the first substantive response',
  )
})

test('the unbound mode resolves COMMS-001', () => {
  const mode = STANDALONE_MODES.unbound

  assert.ok(mode)

  const policies = resolvePolicies(REPO_ROOT, {
    persona: mode.persona,
    workflow: mode.workflow,
    stage: mode.stage,
  })

  assert.ok(
    policies.some((policy) => policy.id === 'COMMS-001'),
    'the unbound card MUST carry COMMS-001 once an agent resolves it',
  )
})

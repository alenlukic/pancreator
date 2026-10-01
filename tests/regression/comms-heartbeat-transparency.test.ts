import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { renderPolicyCursorRule } from '../../src/lib/cursor-content.js'
import { STANDALONE_MODES } from '../../src/lib/governance-card.js'
import { loadPolicyCatalog, resolvePolicies } from '../../src/lib/policies.js'
import { policyDeliveryPlan } from '../../src/lib/projection.js'
import type { Policy } from '../../src/lib/types.js'

const REPO_ROOT = process.cwd()

const BOOTSTRAP_SURFACES = [
  'AGENTS.md',
  'library/cursor/rules/pancreator-self-development.mdc',
  'library/cursor/rules/pancreator-embedded.mdc',
] as const

const HEARTBEAT_CONTEXTS = [
  { persona: 'coder', workflow: 'delivery', stage: 'implement' },
  { persona: 'orchestrator', workflow: 'delivery', stage: 'implement' },
  {
    persona: STANDALONE_MODES.unbound.persona,
    workflow: STANDALONE_MODES.unbound.workflow,
    stage: STANDALONE_MODES.unbound.stage,
  },
  { persona: 'librarian', workflow: 'standalone', stage: 'build-docs' },
] as const

function texts(policy: Policy | undefined): string[] {
  assert.ok(policy, 'policy MUST exist')
  return policy.instructions.map((instruction) => instruction.text)
}

function hasAll(haystacks: string[], ...needles: string[]): boolean {
  return needles.every((needle) =>
    haystacks.some((text) => text.includes(needle)),
  )
}

test('COMMS-001 states visible answers, same-turn tool updates, result order, and no tool-only turns', () => {
  const catalog = loadPolicyCatalog(REPO_ROOT)
  const comms = texts(catalog.get('COMMS-001'))

  assert.ok(
    hasAll(comms, 'visible operator-facing chat', 'operator question'),
    'answers MUST land in visible operator-facing chat',
  )
  assert.ok(
    hasAll(comms, 'Thinking block'),
    'a Thinking block MUST NOT satisfy a response duty',
  )
  assert.ok(
    hasAll(comms, 'same turn', 'update of one line'),
    'a tool-invoking turn MUST carry a one-line visible update',
  )
  assert.ok(
    hasAll(comms, 'MUST NOT consist of only tool calls or shell commands'),
    'tool-only and shell-only turns MUST be forbidden',
  )
  assert.ok(
    hasAll(comms, 'significant result', 'before the next tool call'),
    'a significant result MUST precede the next tool call',
  )
  assert.ok(
    hasAll(
      comms,
      'supervisor, workflow worker, standalone agent, and subagent',
    ),
    'the visible-chat rules MUST bind every agent role',
  )
})

test('the projected chat rule and Cursor pointer carry the heartbeat instructions', () => {
  const catalog = loadPolicyCatalog(REPO_ROOT)
  const policy = catalog.get('COMMS-001')

  assert.ok(policy)
  const rendered = renderPolicyCursorRule(policy)

  assert.match(rendered, /visible operator-facing chat/u)
  assert.match(rendered, /Thinking block/u)
  assert.match(rendered, /update of one line/u)
  assert.match(rendered, /before the next tool call/u)
  assert.match(
    rendered,
    /MUST NOT consist of only tool calls or shell commands/u,
  )

  const manifest = JSON.parse(
    readFileSync(
      path.join(
        REPO_ROOT,
        'governance',
        'registries',
        'projection_manifest.json',
      ),
      'utf8',
    ),
  ) as {
    projections: Array<{
      id: string
      source: string
      target: string
      installation_modes: string[]
    }>
  }
  const entry = manifest.projections.find(
    (item) => item.id === 'cursor-comms-policy-rule',
  )

  assert.ok(entry, 'COMMS-001 MUST stay in the projection manifest')
  assert.equal(entry.source, 'governance/policies/COMMS-001.json')
  assert.equal(entry.target, '.cursor/rules/pan-chat-output.mdc')
  assert.deepEqual(entry.installation_modes, ['self_development', 'embedded'])

  const delivery = policyDeliveryPlan(REPO_ROOT, [policy], {
    executor: 'cursor',
    mode: 'self_development',
  })

  assert.equal(delivery['COMMS-001']?.mode, 'pointer')
  assert.equal(
    delivery['COMMS-001'] &&
      'target' in delivery['COMMS-001'] &&
      delivery['COMMS-001'].target,
    '.cursor/rules/pan-chat-output.mdc',
  )
})

test('worker, supervisor, standalone, and unbound resolution deliver the heartbeat instructions', () => {
  for (const context of HEARTBEAT_CONTEXTS) {
    const resolved = resolvePolicies(REPO_ROOT, context)
    const comms = resolved.find((policy) => policy.id === 'COMMS-001')

    assert.ok(comms, `${context.persona} MUST receive COMMS-001`)
    assert.ok(
      hasAll(texts(comms), 'Thinking block', 'update of one line'),
      `${context.persona} MUST receive the heartbeat instructions`,
    )
  }
})

test('bootstrap surfaces reject hidden reasoning as a COMMS-001 answer', () => {
  for (const surface of BOOTSTRAP_SURFACES) {
    const content = readFileSync(path.join(REPO_ROOT, surface), 'utf8')

    assert.match(
      content,
      /Hidden reasoning, a Thinking block, and raw tool output/u,
      `${surface} MUST deny hidden channels for COMMS-001`,
    )
  }
})

test('long-running observation keeps the pan watch cadence and still requires visible chat', () => {
  const catalog = loadPolicyCatalog(REPO_ROOT)
  const comms = texts(catalog.get('COMMS-001'))
  const delegate = texts(catalog.get('DELEGATE-001'))

  assert.ok(
    hasAll(comms, 'pan watch', 'DELEGATE-001'),
    'COMMS-001 MUST keep pan watch as the observation cadence',
  )
  assert.ok(
    hasAll(delegate, 'The cadence is 60 seconds, fixed, and universal'),
    'DELEGATE-001 MUST retain the 60-second pan watch cadence',
  )
})

test('existing COMMS-001 brevity and outcome-first rules remain intact', () => {
  const comms = texts(loadPolicyCatalog(REPO_ROOT).get('COMMS-001'))

  assert.ok(hasAll(comms, 'MUST hold at most 250 words'))
  assert.ok(hasAll(comms, 'state the outcome first'))
  assert.ok(hasAll(comms, 'When a task reaches a terminal state'))
})

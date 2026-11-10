import assert from 'node:assert/strict'
import { cpSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  canonicalReminder,
  type CanonicalReminderOptions,
} from '../../src/lib/governance/prompt-context/canonical.js'
import {
  principlesReminder,
  renderTurnReminder,
} from '../../src/lib/governance/prompt-context/reminders.js'
import { readText, sha256, writeJsonAtomic } from '../../src/lib/io.js'
import { loadPolicyCatalog } from '../../src/lib/policies.js'
import { createTestTempDirectory } from '../temp.js'

const OPTIONS: CanonicalReminderOptions = {
  host: 'vscode',
  provider: 'openai',
  session: 'canonical-session',
  role: 'pair',
}

function fixture(): string {
  const root = createTestTempDirectory('canonical-reminder-')

  for (const name of ['AGENTS.md', 'config.json', 'governance', 'library']) {
    cpSync(path.join(process.cwd(), name), path.join(root, name), {
      recursive: true,
    })
  }

  return root
}

test('happy_path: canonical reads preserve complete reminder bytes without delivery state', () => {
  const root = fixture()
  const reminder = canonicalReminder(root, OPTIONS)
  const expected = `${renderTurnReminder(root, 'pair').content}\n\n${principlesReminder(root)}`

  assert.equal(reminder.content, expected)
  assert.match(reminder.deferred_content, /BROWSER-001/u)
  assert.equal(
    reminder.content_sha256,
    sha256({
      content: reminder.content,
      deferred_content: reminder.deferred_content,
    }),
  )
  assert.deepEqual(canonicalReminder(root, OPTIONS), reminder)
  assert.deepEqual(
    canonicalReminder(root, {
      ...OPTIONS,
      expectedIdentity: reminder.identity,
    }),
    reminder,
  )
  assert.equal(existsSync(path.join(root, 'runtime')), false)
})

test('hidden_edge_case: identities isolate sessions, roles, workspaces, and contracts', () => {
  const root = fixture()
  const initial = canonicalReminder(root, OPTIONS)

  for (const options of [
    { ...OPTIONS, session: 'child-session' },
    { ...OPTIONS, role: 'unbound' },
  ]) {
    assert.notEqual(canonicalReminder(root, options).identity, initial.identity)
  }

  assert.notEqual(
    canonicalReminder(fixture(), OPTIONS).identity,
    initial.identity,
  )

  writeFileSync(path.join(root, 'pair-card.md'), 'Pair contract one\n')
  const options = { ...OPTIONS, card: 'pair-card.md' }
  const contracted = canonicalReminder(root, options)
  writeFileSync(path.join(root, 'pair-card.md'), 'Pair contract two\n')
  assert.notEqual(
    canonicalReminder(root, options).identity,
    contracted.identity,
  )
})

test('probable_edge_case: principles and deferred policy edits invalidate the identity', () => {
  const root = fixture()
  const initial = canonicalReminder(root, OPTIONS)
  const cardPath = path.join(root, 'AGENTS.md')

  writeFileSync(
    cardPath,
    readText(cardPath).replace(
      "Correctly accomplish the operator's actual objective.",
      "Correctly accomplish the operator's actual objective. Preserve evidence.",
    ),
  )
  const principlesChanged = canonicalReminder(root, OPTIONS)
  assert.notEqual(principlesChanged.content, initial.content)
  assert.notEqual(principlesChanged.identity, initial.identity)

  const policy = loadPolicyCatalog(root).get('BROWSER-001')
  assert.ok(policy)
  const instruction = policy.instructions.find(
    (entry) => entry.load !== undefined,
  )
  assert.ok(instruction)
  instruction.text += ' Preserve the canonical reminder identity.'
  writeJsonAtomic(
    path.join(root, 'governance/policies/BROWSER-001.json'),
    policy,
  )

  const policyChanged = canonicalReminder(root, OPTIONS)
  assert.equal(policyChanged.content, principlesChanged.content)
  assert.notEqual(
    policyChanged.deferred_content,
    principlesChanged.deferred_content,
  )
  assert.notEqual(policyChanged.identity, principlesChanged.identity)

  const eagerPolicy = loadPolicyCatalog(root).get('ENG-001')
  assert.ok(eagerPolicy)
  eagerPolicy.instructions[0].text += ' Preserve this contract identity.'
  writeJsonAtomic(
    path.join(root, 'governance/policies/ENG-001.json'),
    eagerPolicy,
  )
  const eagerChanged = canonicalReminder(root, OPTIONS)
  assert.equal(eagerChanged.content_sha256, policyChanged.content_sha256)
  assert.notEqual(eagerChanged.policy_sha256, policyChanged.policy_sha256)
  assert.notEqual(eagerChanged.identity, policyChanged.identity)
  assert.throws(
    () =>
      canonicalReminder(root, {
        ...OPTIONS,
        expectedIdentity: initial.identity,
      }),
    { code: 'STALE_CANONICAL_REMINDER' },
  )
})

test('critical_unhappy_path: invalid scope and escaped or unavailable contracts fail visibly', () => {
  const root = fixture()

  for (const options of [
    { ...OPTIONS, host: 'cursor' },
    { ...OPTIONS, provider: 'anthropic' },
    { ...OPTIONS, session: '  ' },
    { ...OPTIONS, role: 'none' },
    { ...OPTIONS, role: 'worker' },
    { ...OPTIONS, invocation: 'invocation.json' },
  ]) {
    assert.throws(() => canonicalReminder(root, options), {
      code: 'INVALID_CANONICAL_REMINDER',
    })
  }

  assert.throws(() =>
    canonicalReminder(root, { ...OPTIONS, card: '../AGENTS.md' }),
  )
  assert.throws(() =>
    canonicalReminder(root, { ...OPTIONS, card: 'missing-card.md' }),
  )
  writeJsonAtomic(path.join(root, 'invocation.json'), { schema_version: 1 })
  assert.throws(
    () =>
      canonicalReminder(root, {
        ...OPTIONS,
        role: 'worker',
        invocation: 'invocation.json',
      }),
    { code: 'INVALID_CANONICAL_REMINDER' },
  )

  const policyPath = path.join(root, 'governance/policies/COMMS-001.json')
  const policy = loadPolicyCatalog(root).get('COMMS-001')
  assert.ok(policy)
  policy.instructions[0].text += ' Changed policy.'
  writeJsonAtomic(policyPath, policy)
  assert.throws(() => canonicalReminder(root, OPTIONS), /stale/u)
})

test('hidden_edge_case: workers use pinned policies and capabilities, independently of live run state', () => {
  const root = fixture()
  const policies = loadPolicyCatalog(root)
  const browser = policies.get('BROWSER-001')
  assert.ok(browser)
  browser.instructions.push(
    {
      text: 'canonical-shell-sentinel',
      audience: ['agent'],
      load: 'tool:shell',
      capabilities: { shell: true },
    },
    {
      text: 'canonical-delegating-sentinel',
      audience: ['agent'],
      load: 'tool:delegation',
      capabilities: { delegation: true },
    },
    {
      text: 'canonical-supervisor-sentinel',
      audience: ['supervisor'],
      load: 'tool:shell',
    },
  )
  const invocation = {
    schema_version: 1,
    context_contract_version: 1,
    invocation_id: 'worker-one',
    run_id: 'run-one',
    stage: { persona: 'coder' },
    output: { path: 'output.json' },
    capabilities: { shell: true, delegation: false },
    policies: [policies.get('DELEGATE-001'), policies.get('BROWSER-001')],
  }
  const invocationPath = path.join(root, 'invocation.json')
  writeJsonAtomic(invocationPath, invocation)
  const options = { ...OPTIONS, role: 'worker', invocation: 'invocation.json' }
  const worker = canonicalReminder(root, options)

  assert.equal(worker.scope.invocation, 'worker-one')
  assert.equal(worker.scope.persona, 'coder')
  assert.match(worker.content, /Initial worker reminder/u)
  assert.doesNotMatch(worker.content, /Role: pair/u)
  assert.match(worker.deferred_content, /canonical-shell-sentinel/u)
  assert.doesNotMatch(worker.deferred_content, /canonical-delegating-sentinel/u)
  assert.doesNotMatch(worker.deferred_content, /canonical-supervisor-sentinel/u)

  writeJsonAtomic(
    path.join(root, 'runtime/logs/turn-reminders/conversations.json'),
    {
      schema_version: 1,
      conversations: { 'canonical-session': { role: 'regular-supervisor' } },
    },
  )
  const policy = policies.get('BROWSER-001')
  assert.ok(policy)
  policy.instructions[0].text += ' Live change outside the invocation.'
  writeJsonAtomic(
    path.join(root, 'governance/policies/BROWSER-001.json'),
    policy,
  )
  assert.deepEqual(canonicalReminder(root, options), worker)

  writeJsonAtomic(invocationPath, {
    ...invocation,
    invocation_id: 'worker-two',
  })
  assert.notEqual(canonicalReminder(root, options).identity, worker.identity)
})

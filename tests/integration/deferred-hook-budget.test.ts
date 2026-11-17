import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { recordDelegatedWorker } from '../../src/lib/engine/delegated-workers.js'
import { missingDeferredDelivery } from '../../src/lib/engine/deferred-delivery-evidence.js'
import { deliveryScope } from '../../src/lib/governance/prompt-context/deferred.js'
import { loadTurnReminderRegistry } from '../../src/lib/governance/prompt-context/registry.js'
import {
  readClauseFired,
  readClauseReceipts,
} from '../../src/lib/policy-clause.js'
import { deferredClauseGroups } from '../../src/lib/policy-deferred.js'
import { loadPolicyCatalog } from '../../src/lib/policies.js'
import { readJson, writeJsonAtomic } from '../../src/lib/io.js'
import type { Policy } from '../../src/lib/types.js'
import { createFixture } from '../fixture-template.js'
import { checkpoint } from './delivery-helpers.js'

const CLI_ROOT = process.cwd()
const LONG = `Agents MUST preserve the complete fixture. ${'界🙂 normative text. '.repeat(700)}END-OF-CLAUSE.`

function installEntryPoints(root: string) {
  for (const name of [
    'pan',
    'run-built',
    'pan-run',
    'pan-hook-governance-reminder',
    'pan-hook-deferred-clause',
    'pan-hook-adapter',
    'pan-hook-shell-monitor',
  ]) {
    copyFileSync(path.join(CLI_ROOT, 'bin', name), path.join(root, 'bin', name))
  }
  if (!existsSync(path.join(root, 'dist')))
    symlinkSync(path.join(CLI_ROOT, 'dist'), path.join(root, 'dist'), 'dir')
}

function invoke(
  root: string,
  executable: string,
  args: string[],
  payload?: unknown,
  env: NodeJS.ProcessEnv = {},
) {
  const result = spawnSync(executable, args, {
    cwd: root,
    input: payload === undefined ? undefined : JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      PANCREATOR_ROOT: root,
      PANCREATOR_BUILD_READY: '1',
      CURSOR_CONVERSATION_ID: '',
      PAN_HOST_SESSION_ID: '',
      ...env,
    },
  })
  assert.equal(
    result.status,
    0,
    result.stderr || result.error?.message || 'command failed',
  )
  return result.stdout
}

function hook(
  root: string,
  host: 'cursor' | 'vscode',
  event: string,
  id: string,
  tool: string,
  input: unknown = {},
) {
  const script =
    event === 'preToolUse'
      ? 'pan-hook-deferred-clause'
      : 'pan-hook-governance-reminder'
  const payload = {
    conversation_id: id,
    session_id: id,
    hook_event_name: event,
    tool_name: tool,
    tool_input: input,
    cwd: root,
  }
  const raw =
    host === 'cursor'
      ? invoke(root, path.join(root, 'bin', script), [], payload)
      : invoke(
          root,
          path.join(root, 'bin/pan-hook-adapter'),
          [event, script],
          payload,
        )
  return raw.trim()
    ? (JSON.parse(raw) as {
        permission?: string
        permissionDecision?: string
        agent_message?: string
        permissionDecisionReason?: string
        additional_context?: string
        additionalContext?: string
      })
    : null
}

function commandFrom(text: string, policyId: string): string {
  const line = text
    .split('\n')
    .find((part) => part.includes('governance clause --policy ' + policyId))
  assert.ok(line, text)
  assert.ok(line.startsWith('`') && line.endsWith('`'))
  return line.slice(1, -1)
}

function executePull(root: string, command: string, worker?: string) {
  // Real pan-run and pan entrypoints; the fixture points at the already-built CLI.
  return invoke(
    root,
    'bash',
    ['-c', command],
    undefined,
    worker ? { CURSOR_CONVERSATION_ID: worker } : {},
  )
}

for (const host of ['cursor', 'vscode'] as const) {
  test(`${host}: oversized deferred bodies use bounded pull fallback and no hook receipt`, () => {
    const root = createFixture()
    installEntryPoints(root)
    const file = path.join(root, 'governance/policies/BROWSER-001.json')
    const policy = readJson(file) as Policy
    policy.instructions.push({
      text: LONG,
      audience: ['agent'],
      load: 'tool:browser',
    })
    writeJsonAtomic(file, policy)
    const group = deferredClauseGroups(
      loadPolicyCatalog(root).get('BROWSER-001')!,
      'supervisor',
      {
        shell: true,
        delegation: true,
      },
    ).find((entry) => entry.trigger === 'tool:browser')!
    const budget = loadTurnReminderRegistry(root).byte_budget
    assert.ok(Buffer.byteLength(LONG) > budget)
    const id = 'budget-' + host
    const pre = () => hook(root, host, 'preToolUse', id, 'new_page')
    const denied = pre()
    assert.equal(denied?.permission ?? denied?.permissionDecision, 'deny')
    const message =
      denied?.agent_message ?? denied?.permissionDecisionReason ?? ''
    assert.ok(Buffer.byteLength(message) <= budget)
    assert.doesNotMatch(message, /END-OF-CLAUSE/u)
    assert.deepEqual(readClauseReceipts(root, id), [])
    assert.ok(
      readClauseFired(root, id).some((entry) => entry.sha256 === group.sha256),
    )
    const stillDenied = pre()
    assert.equal(
      stillDenied?.permission ?? stillDenied?.permissionDecision,
      'deny',
    )

    const post = hook(root, host, 'postToolUse', id, 'new_page')
    const context = post?.additional_context ?? post?.additionalContext ?? ''
    assert.ok(Buffer.byteLength(context) <= budget)
    assert.match(context, /Remember the operating principles/u)
    assert.doesNotMatch(context, /END-OF-CLAUSE/u)
    const command = commandFrom(context, 'BROWSER-001')
    assert.equal(command, commandFrom(message, 'BROWSER-001'))
    assert.deepEqual(readClauseReceipts(root, id), [])

    const output = executePull(root, command)
    assert.ok(
      output.includes(LONG),
      'pan-run must expose the complete clause rather than a truncated line',
    )
    assert.doesNotMatch(output, /\[truncated; original=/u)
    assert.ok(
      readClauseReceipts(root, 'session').some(
        (receipt) =>
          receipt.route === 'pull' && receipt.sha256 === group.sha256,
      ),
    )
    const retry = pre()
    assert.equal(
      retry?.permission ?? retry?.permissionDecision ?? 'allow',
      'allow',
    )
    const repeated = hook(root, host, 'postToolUse', id, 'new_page')
    assert.doesNotMatch(
      repeated?.additional_context ?? repeated?.additionalContext ?? '',
      /# Deferred policy clauses/u,
    )
  })
}

test('registered worker can retrieve an oversized shell clause without weakening the guard or sharing receipts', () => {
  const { root, state, invocation } = checkpoint('one-shot@implement-prepared')
  assert.ok(invocation)
  installEntryPoints(root)
  const file = path.join(
    root,
    'governance/registries/turn_reminder_profiles.json',
  )
  const registry = loadTurnReminderRegistry(root)
  registry.byte_budget = 1450
  writeJsonAtomic(file, registry)
  const id = 'budget-shell-worker'
  recordDelegatedWorker(root, state.run_id, {
    invocationId: invocation.invocation_id,
    handle: id,
    launchMode: 'background',
  })
  const delivery = deliveryScope(root, id)
  const shell = (command: string) =>
    hook(root, 'cursor', 'preToolUse', id, 'Shell', { command })
  const denied = shell('node --version')
  assert.equal(denied?.permission, 'deny')
  const message = denied?.agent_message ?? ''
  assert.ok(Buffer.byteLength(message) <= registry.byte_budget)
  const command = commandFrom(message, 'DELEGATE-001')
  assert.ok(command.includes(`--invocation '${invocation.invocation_id}'`))
  assert.ok(command.includes(`--worker '${id}'`))
  const missing = missingDeferredDelivery(root, invocation)
  const expected = missing.find(
    (entry) =>
      entry.policy_id === 'DELEGATE-001' && entry.trigger === 'tool:shell',
  )
  assert.ok(expected, JSON.stringify(missing))
  assert.equal(
    readClauseReceipts(root, delivery.scope).some(
      (entry) => entry.sha256 === expected.sha256,
    ),
    false,
  )
  assert.equal(shell('node --version')?.permission, 'deny')
  const chained = shell(`${command}; node --version`)
  assert.equal(chained?.permission, 'deny')
  assert.equal(shell(command.replace(id, 'another-worker'))?.permission, 'deny')
  assert.equal(
    shell(command)?.permission,
    'allow',
    'pull must not deadlock on its own shell clause',
  )
  // The separate shell-monitor guard must also accept the advertised command.
  const monitor = invoke(
    root,
    path.join(root, 'bin/pan-hook-shell-monitor'),
    [],
    { command },
  )
  assert.equal(JSON.parse(monitor).permission, 'allow', monitor)
  const output = executePull(root, command, id)
  const policy = delivery.policies.find(
    (entry) => entry.id === expected.policy_id,
  )!
  const group = deferredClauseGroups(
    policy,
    'agent',
    delivery.capabilities,
  ).find((entry) => entry.trigger === expected.trigger)!
  for (const text of group.texts) assert.ok(output.includes(text), text)
  assert.ok(
    readClauseReceipts(root, delivery.scope).some(
      (receipt) => receipt.route === 'pull' && receipt.sha256 === group.sha256,
    ),
  )
  assert.deepEqual(readClauseReceipts(root, invocation.invocation_id), [])
  // The first response can also defer the smaller BROWSER shell group when
  // the two complete commands consume the budget. A retry may deliver it;
  // if a separate obligation still exists, it must not silently allow.
  const afterPull = shell('node --version')
  if (afterPull?.permission === 'deny') {
    assert.match(afterPull.agent_message ?? '', /BROWSER-001/u)
    assert.equal(shell('node --version')?.permission, 'allow')
  } else {
    assert.equal(afterPull?.permission, 'allow')
  }
  assert.deepEqual(missingDeferredDelivery(root, invocation), [])
})

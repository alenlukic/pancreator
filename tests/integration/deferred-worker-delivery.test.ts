import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  handlePostToolUse,
  handlePreToolUse,
  handleSubagentStart,
  handleSubagentStop,
} from '../../src/lib/agent-index/hooks.js'
import { getRunState } from '../../src/lib/engine.js'
import { recordDelegatedWorker } from '../../src/lib/engine/delegated-workers.js'
import { missingDeferredDelivery } from '../../src/lib/engine/deferred-delivery-evidence.js'
import {
  deliveryScope,
  preToolDecision,
} from '../../src/lib/governance/prompt-context/deferred.js'
import {
  readClauseFired,
  readClauseReceipts,
  recordClauseReceipt,
  recordClauseFired,
  resolveDeferredClause,
} from '../../src/lib/policy-clause.js'
import type { Invocation } from '../../src/lib/types.js'
import { submitAsSupervisor } from '../run-helpers.js'
import { checkpoint, submitCurrentStage } from './delivery-helpers.js'

function register(
  root: string,
  invocation: Invocation,
  id: string,
  role?: string,
) {
  const worker = invocation.evidence_workers?.find(
    (entry) => entry.role === role,
  )
  const brief =
    worker?.brief_path ??
    `runtime/logs/workflows/${invocation.run_id}/agent/invocations/${invocation.invocation_id}.md`
  handleSubagentStart(root, {
    event: 'subagentStart',
    subagent_id: id,
    conversation_id: 'supervisor',
    task: `Read ${brief}`,
    subagent_type: worker?.agent ?? `pan-${invocation.stage.persona}`,
    tool_call_id: `call-${id}`,
  })
}

function stop(root: string, id: string) {
  handleSubagentStop(root, {
    event: 'subagentStop',
    subagent_id: id,
    conversation_id: id,
    status: 'completed',
  })
}

function pullArgs(
  invocation: Invocation,
  entry: ReturnType<typeof missingDeferredDelivery>[number],
) {
  return [
    path.join(process.cwd(), 'dist/src/cli.js'),
    'governance',
    'clause',
    '--policy',
    entry.policy_id,
    '--trigger',
    entry.trigger,
    '--invocation',
    invocation.invocation_id,
    '--json',
  ]
}

function recover(
  root: string,
  invocation: Invocation,
  workerId: string,
  fromWorker = false,
) {
  for (const entry of missingDeferredDelivery(root, invocation)) {
    assert.equal(entry.worker_id, workerId)
    const args = pullArgs(invocation, entry)
    if (!fromWorker) args.push('--worker', workerId)
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PANCREATOR_ROOT: root,
        CURSOR_CONVERSATION_ID: fromWorker ? workerId : '',
        PAN_HOST_SESSION_ID: '',
      },
    })
    assert.equal(result.status, 0, result.stderr)
    const receipt = JSON.parse(result.stdout) as {
      scope: string
      sha256: string
      text: string
    }
    assert.equal(receipt.sha256, entry.sha256)
    assert.equal(receipt.scope, entry.scope)
    assert.ok(receipt.text.includes(entry.policy_id))
  }
  assert.deepEqual(missingDeferredDelivery(root, invocation), [])
}

const isUndelivered = (error: unknown) => {
  assert.equal((error as { code: string }).code, 'DEFERRED_CLAUSE_UNDELIVERED')
  return true
}

test('submit derives shell obligations even without delivery or tool hooks, then recovers with worker-scoped pulls', () => {
  const {
    root,
    state: run,
    invocation,
  } = checkpoint('one-shot@implement-prepared')
  assert.ok(invocation)
  const id = 'shell-worker'
  copyFileSync(
    path.join(process.cwd(), 'bin/pan-run'),
    path.join(root, 'bin/pan-run'),
  )
  if (!existsSync(path.join(root, 'dist')))
    symlinkSync(
      path.join(process.cwd(), 'dist'),
      path.join(root, 'dist'),
      'dir',
    )
  execFileSync(path.join(root, 'bin/pan-run'), ['--', 'node', '--version'], {
    cwd: root,
    env: { ...process.env, PANCREATOR_ROOT: root, CURSOR_CONVERSATION_ID: id },
  })
  // Only the supervisor's actual launch record identifies this worker.
  // The worker already ran before the supervisor received its handle.
  recordDelegatedWorker(root, run.run_id, {
    invocationId: invocation.invocation_id,
    handle: id,
    launchMode: 'background',
  })
  const scope = deliveryScope(root, id).scope
  assert.notEqual(scope, invocation.invocation_id)
  assert.deepEqual(readClauseFired(root, scope), [])
  assert.deepEqual(readClauseReceipts(root, scope), [])
  const missing = missingDeferredDelivery(root, invocation)
  assert.ok(
    missing.some(
      (entry) =>
        entry.policy_id === 'DELEGATE-001' && entry.trigger === 'tool:shell',
    ),
  )
  assert.throws(() => submitCurrentStage(root, run.run_id), isUndelivered)
  assert.equal(getRunState(root, run.run_id).current_stage, 'implement')
  recover(root, invocation, id, true)
  assert.equal(
    submitAsSupervisor(root, run.run_id, invocation.output.path).state
      .current_stage,
    'ship',
  )
})

test('parallel source workers are scoped by actual brief, alias and attempt; sibling receipts cannot release the join', () => {
  const {
    root,
    state: run,
    invocation,
  } = checkpoint('standard@implement-prepared')
  assert.ok(invocation)
  const a = 'implementer'
  const b = 'test-author'
  // Register via the brief the supervisor actually launches, before recording the handle.
  register(root, invocation, a, 'implement')
  register(root, invocation, b, 'test-author')
  const first = deliveryScope(root, a)
  const second = deliveryScope(root, b)
  assert.notEqual(first.scope, second.scope)
  assert.equal(first.capabilities.shell, false)
  assert.equal(second.capabilities.shell, false)
  assert.equal(deliveryScope(root, 'call-implementer').scope, first.scope)
  for (const [id, role] of [
    [a, 'implement'],
    [b, 'test-author'],
  ] as const) {
    recordDelegatedWorker(root, run.run_id, {
      invocationId: invocation.invocation_id,
      handle: id,
      role,
      launchMode: 'background',
    })
  }
  const file = path.join(root, 'src/example.ts')
  const context = { classes: [], events: [], paths: ['src/example.ts'] }
  assert.equal(
    preToolDecision(root, a, context, new Date(), first).permission,
    'deny',
  )
  assert.equal(
    preToolDecision(root, a, context, new Date(), first).permission,
    'allow',
  )
  const tool = {
    conversation_id: b,
    tool_name: 'Read',
    tool_use_id: 'read-b',
    tool_input: { file_path: file },
  }
  handlePreToolUse(root, { ...tool, event: 'preToolUse' })
  handlePostToolUse(root, { ...tool, event: 'postToolUse' })
  stop(root, a)
  stop(root, b)
  const missing = missingDeferredDelivery(root, invocation)
  assert.ok(missing.some((entry) => entry.policy_id === 'TS-001'))
  assert.ok(missing.every((entry) => entry.worker_id === b))
  // Even exact bytes in a shared stage receipt do not establish delivery to b.
  for (const entry of missing) {
    assert.ok(entry.sha256)
    recordClauseFired(root, invocation.invocation_id, {
      ...entry,
      sha256: entry.sha256,
    })
    recordClauseReceipt(
      root,
      invocation.invocation_id,
      { ...entry, sha256: entry.sha256 },
      'pull',
    )
  }
  assert.throws(
    () =>
      resolveDeferredClause(root, {
        policyId: 'TS-001',
        trigger: 'path:**/*.{ts,tsx}',
        invocationId: invocation.invocation_id,
      }),
    /--worker/u,
  )
  const sibling = spawnSync(
    process.execPath,
    [...pullArgs(invocation, missing[0]!), '--worker', b],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PANCREATOR_ROOT: root,
        CURSOR_CONVERSATION_ID: a,
        PAN_HOST_SESSION_ID: '',
      },
    },
  )
  assert.notEqual(sibling.status, 0)
  assert.match(sibling.stderr, /cannot retrieve a sibling/u)
  assert.throws(() => submitCurrentStage(root, run.run_id), isUndelivered)
  assert.equal(getRunState(root, run.run_id).current_stage, 'implement')
  recover(root, invocation, b)
  assert.equal(
    submitAsSupervisor(root, run.run_id, invocation.output.path).state
      .current_stage,
    'verify',
  )
})

test('a new attempt is not covered by a prior worker receipt and an independent watch failure fires recovery', () => {
  const { root, invocation } = checkpoint('one-shot@implement-prepared', {
    key: 'worker-event-delivery',
    fixture: (fixtureRoot) => {
      const file = path.join(
        fixtureRoot,
        'governance/policies/BROWSER-001.json',
      )
      const policy = JSON.parse(readFileSync(file, 'utf8')) as {
        instructions: unknown[]
      }
      for (const load of ['event:tool_failure', 'event:stall'])
        policy.instructions.push({
          text: `Fixture clause for ${load}.`,
          audience: ['agent'],
          load,
        })
      writeFileSync(file, JSON.stringify(policy, null, 2) + '\n')
    },
  })
  assert.ok(invocation)
  register(root, invocation, 'first-worker')
  register(root, invocation, 'retry-worker')
  const first = deliveryScope(root, 'first-worker')
  const retry = deliveryScope(root, 'retry-worker')
  assert.notEqual(first.scope, retry.scope)
  assert.equal(
    preToolDecision(
      root,
      'first-worker',
      { classes: ['shell'], events: [], paths: [] },
      new Date(),
      first,
    ).permission,
    'deny',
  )
  const tool = {
    conversation_id: 'retry-worker',
    tool_name: 'Shell',
    tool_use_id: 'watch',
    tool_input: { command: './bin/pan watch run --json' },
  }
  handlePostToolUse(root, {
    ...tool,
    event: 'postToolUseFailure',
    tool_output: { state: 'stalled' },
  })
  const missing = missingDeferredDelivery(root, invocation)
  assert.ok(missing.some((entry) => entry.trigger === 'tool:shell'))
  assert.ok(missing.some((entry) => entry.trigger === 'event:stall'))
  assert.ok(missing.some((entry) => entry.trigger === 'event:tool_failure'))
  assert.ok(missing.every((entry) => entry.worker_id === 'retry-worker'))
  assert.deepEqual(readClauseFired(root, retry.scope), [])
  recover(root, invocation, 'retry-worker')
})

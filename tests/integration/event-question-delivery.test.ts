import assert from 'node:assert/strict'
import test from 'node:test'

import { pauseRun } from '../../src/lib/engine.js'
import {
  deliverDeferredClauses,
  firedContext,
  preToolDecision,
} from '../../src/lib/governance/prompt-context/deferred.js'
import {
  readClauseReceipts,
  recordClauseReceipt,
  resolveDeferredClause,
} from '../../src/lib/policy-clause.js'
import { renderPolicyBlocks } from '../../src/lib/policy-guidance.js'
import { loadPolicyCatalog } from '../../src/lib/policies.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import {
  checkpoint,
  failingVerify,
  submitStageOutput,
} from './delivery-helpers.js'

const shellCall = {
  hookEvent: 'postToolUse',
  toolName: 'Shell',
  toolInput: { command: 'pan status' },
  prompt: '',
}

test('a same-reason pause fires gate_failure and delivers the SINGLERUN-001 pause body', () => {
  const { root, runId, workflow } = checkpoint(
    'delivery@verify-failed-once-remediated',
  )
  const repeated = submitStageOutput(
    root,
    runId,
    stageBySlug(workflow, 'verify'),
    'failure',
    ['verify.acceptance_met'],
    (output) => {
      output.data.verify = failingVerify('VF-JIT-2')
    },
  )
  assert.equal(repeated.state.status, 'paused')
  assert.equal(repeated.state.same_reason_failures?.verify?.repeat_count, 2)

  const resumePrompt = {
    hookEvent: 'beforeSubmitPrompt',
    toolName: null,
    toolInput: {},
    prompt: `/pan-resume ${runId}`,
  }
  const fired = firedContext(root, resumePrompt)

  assert.ok(fired.events.includes('gate_failure'))
  assert.ok(fired.events.includes('pause'))

  const delivered = deliverDeferredClauses(root, 'gate-conv', fired)

  assert.ok(delivered)
  assert.match(delivered, /SINGLERUN-001/u)
  assert.match(
    delivered,
    /MUST pause ordinary runs after the same stage fails twice/u,
  )
  assert.doesNotMatch(delivered, /exclusion of one unit from a group/u)
  assert.equal(deliverDeferredClauses(root, 'gate-conv', fired), null)
})

test('an operator pause after one failure does not fire gate_failure', () => {
  const { root, runId, state } = checkpoint('delivery@verify-failed-once')

  assert.equal(state.same_reason_failures?.verify?.repeat_count, 1)
  assert.equal(
    firedContext(root, shellCall).events.includes('gate_failure'),
    false,
  )

  pauseRun(root, runId, 'operator edits the workspace')

  const fired = firedContext(root, shellCall)

  assert.ok(fired.events.includes('pause'))
  assert.equal(fired.events.includes('gate_failure'), false)
  assert.doesNotMatch(
    deliverDeferredClauses(root, 'manual-pause-conv', fired) ?? '',
    /SINGLERUN-001/u,
  )
})

test('AskQuestion denies once, delivers the ASK-001 fallback, and allows the retry', () => {
  const { root } = checkpoint('delivery@created')
  const fired = firedContext(root, {
    hookEvent: 'preToolUse',
    toolName: 'AskQuestion',
    toolInput: {},
    prompt: '',
  })

  assert.deepEqual(fired.classes, ['question'])

  const decision = preToolDecision(root, 'ask-conv', fired)

  assert.equal(decision.permission, 'deny')
  assert.ok(decision.agent_message)
  assert.match(decision.agent_message, /ASK-001/u)
  assert.match(decision.agent_message, /host question tool is unavailable/u)
  assert.doesNotMatch(
    decision.agent_message,
    /MUST NOT proceed on an assumed answer/u,
  )
  assert.deepEqual(
    readClauseReceipts(root, 'ask-conv').map(
      ({ policy_id, trigger, route }) => ({ policy_id, trigger, route }),
    ),
    [{ policy_id: 'ASK-001', trigger: 'tool:question', route: 'hook' }],
  )
  assert.deepEqual(preToolDecision(root, 'ask-conv', fired), {
    permission: 'allow',
  })
  assert.equal(deliverDeferredClauses(root, 'ask-conv', fired), null)
})

test('a missing question tool has an eager pull instruction and needs no tool hook', () => {
  const { root } = checkpoint('delivery@created')
  const ask = loadPolicyCatalog(root).get('ASK-001')
  assert.ok(ask)
  const card = renderPolicyBlocks([ask], 3, 'agent').join('\n')

  assert.match(
    card,
    /read the deferred `tool:question` clause before asking in chat/u,
  )
  assert.match(
    card,
    /governance clause --policy ASK-001 --trigger tool:question/u,
  )
  assert.doesNotMatch(card, /MUST NOT call a host question tool/u)
  assert.deepEqual(readClauseReceipts(root, undefined), [])

  const resolved = resolveDeferredClause(root, {
    policyId: 'ASK-001',
    trigger: 'tool:question',
  })
  assert.match(resolved.text, /MUST NOT call a host question tool/u)
  // The index command has no invocation argument in a host conversation,
  // so its receipt is written to the shared session scope.
  recordClauseReceipt(root, undefined, resolved.group, 'pull')

  // If the host later offers the tool, the existing pull receipt avoids
  // another delivery and the first call is allowed.
  const fired = firedContext(root, {
    hookEvent: 'preToolUse',
    toolName: 'cursor/ask_question',
    toolInput: {},
    prompt: '',
  })
  assert.deepEqual(preToolDecision(root, 'fallback-conv', fired), {
    permission: 'allow',
  })
  assert.equal(readClauseReceipts(root, undefined).length, 1)
  assert.deepEqual(readClauseReceipts(root, 'fallback-conv'), [])
})

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  policyDeliveryPlan,
  projectionTargetPath,
  workerCardHost,
} from '../../src/lib/projection.js'
import { renderInvocationMarkdown } from '../../src/lib/render.js'
import { validateInvocationMarkdown } from '../../src/lib/validation.js'
import { createFixture } from '../fixture-template.js'
import { baseInvocation } from '../unit/render-helpers.js'

const COMMS_VSCODE = '.github/instructions/pan-chat-output.instructions.md'

test('a VS Code worker card points only at projected VS Code instructions', () => {
  const root = createFixture()
  const invocation = baseInvocation(root, 'delivery', 'remediate')
  const plan = () =>
    policyDeliveryPlan(root, invocation.policies, {
      executor: 'cursor',
      mode: 'self_development',
      host: 'vscode',
    })

  assert.ok(
    Object.values(plan()).every((entry) => entry.mode === 'inline'),
    'no VS Code file is projected yet, so every policy stays inline',
  )

  const target = projectionTargetPath(root, COMMS_VSCODE)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, 'projected\n')

  const delivery = plan()
  const comms = delivery['COMMS-001']

  assert.equal(comms?.mode, 'pointer')
  assert.equal(comms?.mode === 'pointer' && comms.target, COMMS_VSCODE)
  assert.equal(comms?.mode === 'pointer' && comms.host, 'vscode')
  assert.equal(delivery['DELEGATE-001']?.mode, 'inline')

  const pointed = { ...invocation, policy_delivery: delivery }
  const markdown = renderInvocationMarkdown(pointed)

  assert.ok(markdown.includes(`\`${COMMS_VSCODE}\``))
  assert.equal(validateInvocationMarkdown(pointed, markdown).passed, true)
})

test('a Cursor pointer records its host and an unknown host inlines', () => {
  const root = createFixture()
  const invocation = baseInvocation(root, 'delivery', 'remediate')
  const cursor = policyDeliveryPlan(root, invocation.policies, {
    executor: 'cursor',
    mode: 'self_development',
    host: 'cursor',
  })['COMMS-001']

  assert.equal(cursor?.mode === 'pointer' && cursor.host, 'cursor')
  assert.ok(
    Object.values(
      policyDeliveryPlan(root, invocation.policies, {
        executor: 'cursor',
        mode: 'self_development',
        host: null,
      }),
    ).every((entry) => entry.mode === 'inline'),
  )
})

test('the worker card host follows PAN_HOST, a Cursor id, then one enabled host', () => {
  const root = createFixture()

  assert.equal(workerCardHost(root, { PAN_HOST: 'vscode' }), 'vscode')
  assert.equal(workerCardHost(root, { PAN_HOST: 'copilot-cli' }), null)
  assert.equal(
    workerCardHost(root, { PAN_HOST: '', CURSOR_CONVERSATION_ID: 'c-1' }),
    'cursor',
  )
  assert.equal(workerCardHost(root, {}), 'cursor')
})

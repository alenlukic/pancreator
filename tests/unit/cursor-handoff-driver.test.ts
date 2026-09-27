/**
 * Tests for AC-3, AC-4, AC-5, AC-6, AC-7, AC-9: driver step sequence,
 * error codes, dry-run, result shape, focus-changed guard, and self-check.
 *
 * All tests use a fake bridge that injects controlled snapshots and results.
 * No helper binary is built or spawned.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import type { Bridge } from '../../src/lib/cursor-handoff/driver.js'
import {
  runHandoffDriver,
  selfCheck,
  type StepRecord,
} from '../../src/lib/cursor-handoff/driver.js'
import type { SnapNode } from '../../src/lib/cursor-handoff/selectors.js'
import {
  EFFORT,
  MODEL,
  PROMPT,
  makeStatefulBridge,
  type FakeBridgeOpts,
} from '../fixtures/cursor-handoff/fake-bridge.js'

// ---------------------------------------------------------------------------
// AC-3: Driver presses Send exactly once, after all checks
// ---------------------------------------------------------------------------

test('AC-3: driver presses Send exactly once after prompt and label verification', async () => {
  const { bridge, pressLog, setValueLog, focusInsertLog } = makeStatefulBridge()
  let preSendCallbackCalled = false
  let labelAtCallback: string | undefined

  const result = await runHandoffDriver({
    bridge,
    prompt: PROMPT,
    model: MODEL,
    effort: EFFORT,
    preSendCallback: (context) => {
      preSendCallbackCalled = true
      labelAtCallback = context.verifiedLabel
      return Promise.resolve({ ok: true })
    },
    deadlineMs: 30_000,
  })

  assert.equal(
    result.status,
    'sent',
    `Expected sent but got: ${result.status} (${result.code ?? ''}) - ${result.error ?? ''}`,
  )
  assert.ok(pressLog.includes('new-send'), 'Send button must be pressed')
  assert.equal(
    pressLog.filter((id) => id === 'new-send').length,
    1,
    'Send pressed exactly once',
  )
  assert.ok(preSendCallbackCalled, 'Pre-send callback must be called')
  assert.equal(
    labelAtCallback,
    `${MODEL} ${EFFORT}`,
    'The pre-Send callback receives the verified picker label',
  )
  assert.deepEqual(
    setValueLog,
    [{ id: 'new-composer', value: PROMPT }],
    'The prompt is written through AXValue first',
  )
  assert.equal(
    focusInsertLog.length,
    0,
    'The fallback write is not used when AXValue holds the exact prompt',
  )
})

test('AC-3: driver falls back to focus_insert when AXValue leaves the composer empty', async () => {
  const { bridge, pressLog, setValueLog, focusInsertLog } = makeStatefulBridge({
    ignoreSetValue: true,
  })

  const result = await runHandoffDriver({
    bridge,
    prompt: PROMPT,
    model: MODEL,
    effort: EFFORT,
  })

  assert.equal(
    result.status,
    'sent',
    `${result.code ?? ''} ${result.error ?? ''}`,
  )
  assert.equal(setValueLog.length, 1)
  assert.deepEqual(focusInsertLog, [{ id: 'new-composer', value: PROMPT }])
  assert.equal(pressLog.filter((id) => id === 'new-send').length, 1)
})

test('C-2: a pre-Send refusal aborts with its own code and never presses Send', async () => {
  const { bridge, pressLog } = makeStatefulBridge()

  const result = await runHandoffDriver({
    bridge,
    prompt: PROMPT,
    model: MODEL,
    effort: EFFORT,
    preSendCallback: () =>
      Promise.resolve({
        ok: false,
        code: 'HANDOFF_ALREADY_PENDING',
        message: 'Run already has a pending handoff.',
      }),
  })

  assert.equal(result.status, 'aborted')
  assert.equal(result.code, 'HANDOFF_ALREADY_PENDING')
  assert.equal(pressLog.filter((id) => id === 'new-send').length, 0)
})

test('AC-3: the prompt check is exact, so surrounding whitespace is rejected', async () => {
  const { bridge, pressLog } = makeStatefulBridge({
    transform: (nodes) =>
      nodes.map((n) =>
        n.id === 'new-composer' && n.value === PROMPT
          ? { ...n, value: `${PROMPT}\n` }
          : n,
      ),
  })

  const result = await runHandoffDriver({
    bridge,
    prompt: PROMPT,
    model: MODEL,
    effort: EFFORT,
  })

  assert.equal(result.code, 'HANDOFF_PROMPT_REJECTED')
  assert.equal(pressLog.includes('new-send'), false)
})

test('AC-3: a reordered snapshot keeps the old empty composer out of the selection', async () => {
  const { bridge, setValueLog, pressLog } = makeStatefulBridge({
    transform: (nodes, { phase }) =>
      phase === 0
        ? nodes
        : [...nodes]
            .reverse()
            .map((n) => (n.id === 'old-composer' ? { ...n, value: '' } : n)),
  })

  const result = await runHandoffDriver({
    bridge,
    prompt: PROMPT,
    model: MODEL,
    effort: EFFORT,
  })

  assert.equal(
    result.status,
    'sent',
    `${result.code ?? ''} ${result.error ?? ''}`,
  )
  assert.deepEqual(
    setValueLog.map((entry) => entry.id),
    ['new-composer'],
    'Only the composer absent from the first snapshot is written',
  )
  assert.equal(pressLog.includes('old-send'), false)
})

test('AC-3: driver re-resolves composer and picker after each menu close', async () => {
  const { bridge, pressLog } = makeStatefulBridge()

  const result = await runHandoffDriver({
    bridge,
    prompt: PROMPT,
    model: MODEL,
    effort: EFFORT,
    deadlineMs: 30_000,
  })

  assert.equal(
    result.status,
    'sent',
    `Got ${result.status}: ${result.error ?? ''} (${result.code ?? ''})`,
  )
  // The driver opens the picker twice (for model and effort) and closes it each time
  assert.ok(
    pressLog.filter((id) => id === 'new-picker').length >= 2,
    'Picker must be opened at least twice (model and effort)',
  )
})

// ---------------------------------------------------------------------------
// AC-4: Every failed check produces its own distinct code, no Send pressed
// ---------------------------------------------------------------------------

test('AC-4: HANDOFF_PRESS_FAILED on New Chat aborts before Send', async () => {
  const { bridge, pressLog } = makeStatefulBridge({
    pressError: {
      id: 'btn-new',
      code: 'HANDOFF_PRESS_FAILED',
      message: 'AXPress failed',
    },
  })

  const result = await runHandoffDriver({
    bridge,
    prompt: PROMPT,
    model: MODEL,
    effort: EFFORT,
    deadlineMs: 30_000,
  })

  assert.equal(result.status, 'aborted')
  assert.equal(result.code, 'HANDOFF_PRESS_FAILED')
  assert.ok(!pressLog.includes('new-send'))
})

const without =
  (ids: string[], fromPhase = 0): FakeBridgeOpts['transform'] =>
  (nodes, { phase }) =>
    phase >= fromPhase ? nodes.filter((n) => !ids.includes(n.id)) : nodes

const withExtra =
  (extra: SnapNode, fromPhase = 0): FakeBridgeOpts['transform'] =>
  (nodes, { phase }) =>
    phase >= fromPhase ? [...nodes, extra] : nodes

/**
 * One row per UI failure code the driver emits. Each row breaks exactly one
 * check and asserts that code, with Send never pressed.
 */
const UI_FAILURE_ROWS: Array<{
  code: string
  opts: FakeBridgeOpts
  deadlineMs?: number
}> = [
  {
    code: 'HANDOFF_ACCESSIBILITY_DENIED',
    opts: { preflight: { accessibility_trusted: false } },
  },
  {
    code: 'HANDOFF_CURSOR_NOT_RUNNING',
    opts: { preflight: { cursor_pid: null } },
  },
  {
    code: 'HANDOFF_AGENTS_WINDOW_MISSING',
    opts: { preflight: { agents_window_present: false } },
  },
  {
    code: 'HANDOFF_HELPER_PROTOCOL',
    opts: { snapshotError: new Error('helper exited') },
  },
  {
    code: 'HANDOFF_UI_BUSY',
    opts: {
      transform: withExtra({ id: 'sheet', parent_id: 'win', role: 'AXSheet' }),
    },
  },
  {
    code: 'HANDOFF_NEW_CHAT_MISSING',
    opts: { transform: without(['btn-new']) },
  },
  {
    code: 'HANDOFF_COMPOSER_TIMEOUT',
    opts: { transform: without(['new-composer'], 1) },
  },
  {
    code: 'HANDOFF_COMPOSER_AMBIGUOUS',
    opts: {
      transform: withExtra(
        {
          id: 'extra-composer',
          parent_id: 'grp-new',
          role: 'AXTextArea',
          title: 'Prompt Editor',
          value: '',
        },
        1,
      ),
    },
  },
  {
    code: 'HANDOFF_PROMPT_REJECTED',
    opts: { ignoreSetValue: true, ignoreFocusInsert: true },
  },
  {
    code: 'HANDOFF_ELEMENT_STALE',
    opts: { transform: without(['new-composer'], 2) },
  },
  {
    code: 'HANDOFF_PICKER_MISSING',
    opts: { transform: without(['new-picker', 'old-picker'], 1) },
  },
  {
    code: 'HANDOFF_PICKER_AMBIGUOUS',
    opts: {
      transform: withExtra(
        {
          id: 'extra-picker',
          parent_id: 'grp-new',
          role: 'AXPopUpButton',
          title: 'GPT Low',
        },
        1,
      ),
    },
  },
  {
    code: 'HANDOFF_MENU_ITEM_MISSING',
    opts: { transform: without(['item-model', 'opt-model'], 3) },
  },
  {
    code: 'HANDOFF_OPTION_MISSING',
    opts: { transform: without(['opt-model'], 3) },
  },
  {
    code: 'HANDOFF_PROMPT_LOST',
    opts: {
      transform: (nodes, { effortSelected }) =>
        effortSelected
          ? nodes.map((n) =>
              n.id === 'new-composer' ? { ...n, value: '' } : n,
            )
          : nodes,
    },
  },
  {
    code: 'HANDOFF_PICKER_MISMATCH',
    opts: {
      transform: (nodes) =>
        nodes.map((n) =>
          n.id === 'new-picker' ? { ...n, title: `${MODEL} Low` } : n,
        ),
    },
  },
  {
    code: 'HANDOFF_SEND_MISSING',
    opts: { transform: without(['new-send', 'old-send'], 1) },
  },
  {
    code: 'HANDOFF_PRESS_FAILED',
    opts: {
      pressError: {
        id: 'new-send',
        code: 'HANDOFF_PRESS_FAILED',
        message: 'AXPress returned -25200',
      },
    },
  },
  // AC-7: a frontmost change before Send aborts without pressing it.
  { code: 'HANDOFF_FOCUS_CHANGED', opts: { frontmostAfter: 11111 } },
  {
    code: 'HANDOFF_TIMEOUT',
    opts: { preflightDelayMs: 20 },
    deadlineMs: 5,
  },
]

for (const row of UI_FAILURE_ROWS) {
  test(`AC-4: ${row.code} aborts with its own code and no Send press`, async () => {
    const { bridge, pressLog } = makeStatefulBridge(row.opts)

    const result = await runHandoffDriver({
      bridge,
      prompt: PROMPT,
      model: MODEL,
      effort: EFFORT,
      composerTimeoutMs: 50,
      ...(row.deadlineMs !== undefined ? { deadlineMs: row.deadlineMs } : {}),
    })

    assert.equal(result.status, 'aborted')
    assert.equal(result.code, row.code, result.error ?? '')
    assert.equal(
      pressLog.filter((id) => id === 'new-send').length,
      0,
      'Send must not be pressed',
    )
  })
}

// ---------------------------------------------------------------------------
// AC-5: Dry-run returns 'drafted', does not press Send
// ---------------------------------------------------------------------------

test('AC-5: dry-run returns status drafted and no Send pressed', async () => {
  const { bridge, pressLog } = makeStatefulBridge()

  const result = await runHandoffDriver({
    bridge,
    prompt: PROMPT,
    model: MODEL,
    effort: EFFORT,
    dryRun: true,
    deadlineMs: 30_000,
  })

  assert.equal(
    result.status,
    'drafted',
    `Got ${result.status}: ${result.error ?? ''} (${result.code ?? ''})`,
  )
  assert.ok(
    !pressLog.includes('new-send'),
    'Send must not be pressed in dry-run',
  )
})

test('AC-5: dry-run records steps through the Send lookup', async () => {
  const { bridge } = makeStatefulBridge()

  const result = await runHandoffDriver({
    bridge,
    prompt: PROMPT,
    model: MODEL,
    effort: EFFORT,
    dryRun: true,
    deadlineMs: 30_000,
  })

  const stepNames = result.steps.map((s: StepRecord) => s.name)
  assert.ok(
    stepNames.includes('find_send'),
    'dry-run must include find_send step',
  )
  assert.ok(
    !stepNames.includes('press_send'),
    'dry-run must not include press_send step',
  )
})

// ---------------------------------------------------------------------------
// AC-6: Result shape
// ---------------------------------------------------------------------------

test('AC-6: result carries non-negative elapsed_ms per step', async () => {
  const { bridge } = makeStatefulBridge()

  const result = await runHandoffDriver({
    bridge,
    prompt: PROMPT,
    model: MODEL,
    effort: EFFORT,
    deadlineMs: 30_000,
  })

  for (const s of result.steps) {
    assert.ok(s.elapsed_ms >= 0, `${s.name} elapsed_ms must be >= 0`)
  }
})

test('AC-6: result carries non-negative total_elapsed_ms', async () => {
  const { bridge } = makeStatefulBridge()

  const result = await runHandoffDriver({
    bridge,
    prompt: PROMPT,
    model: MODEL,
    effort: EFFORT,
    deadlineMs: 30_000,
  })

  assert.ok(
    typeof result.total_elapsed_ms === 'number' && result.total_elapsed_ms >= 0,
  )
})

test('AC-6: result frontmost.changed is false when pid unchanged', async () => {
  const { bridge } = makeStatefulBridge()

  const result = await runHandoffDriver({
    bridge,
    prompt: PROMPT,
    model: MODEL,
    effort: EFFORT,
    deadlineMs: 30_000,
  })

  assert.equal(result.frontmost.changed, false)
})

test('AC-6: result carries verified_label equal to expected label', async () => {
  const { bridge } = makeStatefulBridge()

  const result = await runHandoffDriver({
    bridge,
    prompt: PROMPT,
    model: MODEL,
    effort: EFFORT,
    deadlineMs: 30_000,
  })

  assert.equal(result.expected_label, `${MODEL} ${EFFORT}`)
  assert.equal(result.verified_label, `${MODEL} ${EFFORT}`)
})

// ---------------------------------------------------------------------------
// AC-9: Self-check makes no bridge press, setValue, or focus_insert call
// ---------------------------------------------------------------------------

test('AC-9: selfCheck with missing New Chat yields HANDOFF_NEW_CHAT_MISSING code', async () => {
  // Build a bridge whose snapshot lacks the New Chat button
  const noNewChatBridge: Bridge = {
    async preflight() {
      return {
        accessibility_trusted: true,
        cursor_pid: 12345,
        agents_window_present: true,
        frontmost_pid: 99999,
      }
    },
    async snapshot() {
      return {
        nodes: [
          { id: 'win', role: 'AXWindow', title: 'Cursor Agents' },
          // No New Chat button
          {
            id: 'composer',
            parent_id: 'win',
            role: 'AXTextArea',
            title: 'Prompt Editor',
            value: '',
          },
        ],
      }
    },
    async press() {},
    async setValue() {},
    async focusInsert() {},
    async frontmost() {
      return 99999
    },
  }

  const result = await selfCheck(noNewChatBridge)

  assert.ok(
    result.codes.some((c) => c.code === 'HANDOFF_NEW_CHAT_MISSING'),
    'should report HANDOFF_NEW_CHAT_MISSING',
  )
})

test('AC-9: selfCheck on a complete tree reports no failure and lists the unchecked menu items', async () => {
  const { bridge, pressLog, setValueLog, focusInsertLog } = makeStatefulBridge()

  const result = await selfCheck(bridge)

  assert.equal(result.ok, true, JSON.stringify(result.codes))
  assert.deepEqual(result.codes, [])
  assert.deepEqual(result.unchecked, ['model_menu_item', 'effort_menu_item'])
  assert.equal(pressLog.length + setValueLog.length + focusInsertLog.length, 0)
})

test('AC-9: selfCheck with two pickers in the composer scope reports HANDOFF_PICKER_AMBIGUOUS', async () => {
  const { bridge } = makeStatefulBridge({
    transform: (nodes) => [
      ...nodes,
      {
        id: 'second-picker',
        parent_id: 'grp-old',
        role: 'AXPopUpButton',
        title: 'GPT Low',
      },
    ],
  })

  const result = await selfCheck(bridge)

  assert.deepEqual(
    result.codes.map((c) => c.code),
    ['HANDOFF_PICKER_AMBIGUOUS'],
  )
})

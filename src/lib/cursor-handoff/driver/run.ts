/**
 * The bridge self-check and `runHandoffDriver`, which runs the step sequence
 * and turns a deadline or a failed check into an `aborted` result.
 */

import {
  isBusy,
  findNewChat,
  findComposers,
  findPickerInAncestorScope,
  PICKER_ANCESTOR_LIMIT,
  missingPickerCode,
  findSend,
} from '../selectors.js'
import {
  DeadlineExceeded,
  abortedResult,
  step,
  type Bridge,
  type BridgePreflight,
  type BridgeSnapshot,
  type DriverOptions,
  type DriverProgress,
  type HandoffResult,
  type StepRecord,
} from './bridge.js'
import { driveSequence } from './sequence.js'

// ---------------------------------------------------------------------------
// Self-check mode
// ---------------------------------------------------------------------------

export interface SelfCheckResult {
  ok: boolean
  steps: StepRecord[]
  codes: Array<{ control: string; code: string }>
  /** Controls the self-check cannot locate without acting. */
  unchecked: string[]
  presses: number
}

/** Locating these menu items requires opening the picker, which is an action. */
const SELF_CHECK_UNCHECKED = ['model_menu_item', 'effort_menu_item']

/**
 * Locate all controls without pressing or writing anything. Reports a distinct
 * code for each control it cannot find. Does not open the model picker menu
 * (cannot find Model/Effort items without opening it, so marks them as
 * unchecked).
 */
export async function selfCheck(bridge: Bridge): Promise<SelfCheckResult> {
  const steps: StepRecord[] = []
  const codes: Array<{ control: string; code: string }> = []
  const presses = 0
  const unchecked = [...SELF_CHECK_UNCHECKED]
  const result = (): SelfCheckResult => ({
    ok: codes.length === 0 && steps.every((s) => s.ok),
    steps,
    codes,
    unchecked,
    presses,
  })

  const preflightStart = Date.now()
  let preflight: BridgePreflight
  try {
    preflight = await bridge.preflight()
    steps.push(step('preflight', preflightStart, true))
  } catch (err) {
    const e = err as { code?: string; message?: string }
    steps.push(step('preflight', preflightStart, false, e.message, e.code))
    codes.push({
      control: 'helper',
      code: e.code ?? 'HANDOFF_HELPER_PROTOCOL',
    })
    return result()
  }

  if (!preflight.accessibility_trusted) {
    codes.push({
      control: 'accessibility',
      code: 'HANDOFF_ACCESSIBILITY_DENIED',
    })
  }

  if (preflight.cursor_pid === null) {
    codes.push({ control: 'cursor', code: 'HANDOFF_CURSOR_NOT_RUNNING' })
    return result()
  }

  if (!preflight.agents_window_present) {
    codes.push({
      control: 'agents_window',
      code: 'HANDOFF_AGENTS_WINDOW_MISSING',
    })
    return result()
  }

  const snapshotStart = Date.now()
  let snapshot: BridgeSnapshot
  try {
    snapshot = await bridge.snapshot()
    steps.push(step('snapshot', snapshotStart, true))
  } catch (err) {
    const e = err as { code?: string; message?: string }
    steps.push(step('snapshot', snapshotStart, false, e.message, e.code))
    codes.push({
      control: 'snapshot',
      code: e.code ?? 'HANDOFF_HELPER_PROTOCOL',
    })
    return result()
  }

  const nodes = snapshot.nodes

  if (isBusy(nodes)) {
    codes.push({ control: 'busy', code: 'HANDOFF_UI_BUSY' })
  }

  if (!findNewChat(nodes)) {
    codes.push({ control: 'new_chat', code: 'HANDOFF_NEW_CHAT_MISSING' })
  } else {
    steps.push(step('find_new_chat', snapshotStart, true))
  }

  // The current chat's composer stands in for the one New Chat would open.
  const composerNode = findComposers(nodes)[0]
  if (!composerNode) {
    codes.push({ control: 'composer', code: 'HANDOFF_COMPOSER_TIMEOUT' })
    return result()
  }
  steps.push(step('find_composer', snapshotStart, true))

  const pickerResult = findPickerInAncestorScope(
    nodes,
    composerNode.id,
    PICKER_ANCESTOR_LIMIT,
  )
  if (!pickerResult) {
    codes.push({
      control: 'picker',
      code: missingPickerCode(nodes, composerNode.id, PICKER_ANCESTOR_LIMIT),
    })
    return result()
  }
  steps.push(step('find_picker', snapshotStart, true))

  if (!findSend(pickerResult.scope)) {
    codes.push({ control: 'send', code: 'HANDOFF_SEND_MISSING' })
  } else {
    steps.push(step('find_send', snapshotStart, true))
  }

  return result()
}

/**
 * Run the full handoff step sequence. Returns a result describing every step,
 * the verified label, and whether Send was pressed. Every failed check,
 * including the whole-sequence deadline, returns an `aborted` result with its
 * code rather than throwing.
 */
export async function runHandoffDriver(
  options: DriverOptions,
): Promise<HandoffResult> {
  const progress: DriverProgress = {
    seqStart: Date.now(),
    steps: [],
    frontmostBefore: null,
    frontmostAfter: null,
  }

  try {
    return await driveSequence(options, progress)
  } catch (error) {
    if (error instanceof DeadlineExceeded) {
      progress.steps.push(
        step(
          'deadline',
          progress.seqStart,
          false,
          error.message,
          'HANDOFF_TIMEOUT',
        ),
      )
      return abortedResult(options, progress, 'HANDOFF_TIMEOUT', error.message)
    }

    throw error
  }
}

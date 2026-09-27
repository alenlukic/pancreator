/**
 * The step sequence behind an injected bridge interface. The bridge handles
 * all Accessibility API calls; this module owns sequence, timing, error codes,
 * frontmost sampling, and the 30-second deadline.
 *
 * The driver never activates an application, opens a URL, posts key events,
 * or calls AppleScript.
 */

import type { SnapNode } from './selectors.js'
import {
  findComposers,
  findMenuItems,
  findNewChat,
  findPickerInAncestorScope,
  findSend,
  isBusy,
  missingPickerCode,
  pickerLabel,
  PICKER_ANCESTOR_LIMIT,
  descendantsOf,
  childrenOf,
} from './selectors.js'

// ---------------------------------------------------------------------------
// Bridge interface (injected — fake in tests, real helper in production)
// ---------------------------------------------------------------------------

export interface BridgePreflight {
  accessibility_trusted: boolean
  cursor_pid: number | null
  agents_window_present: boolean
  frontmost_pid: number | null
}

export interface BridgeSnapshot {
  nodes: SnapNode[]
}

export interface Bridge {
  /** Platform + accessibility + cursor pid + agents window + frontmost. */
  preflight(): Promise<BridgePreflight>
  /** Breadth-first tree of the Cursor Agents window. */
  snapshot(): Promise<BridgeSnapshot>
  /** AXPress an element by id. */
  press(id: string): Promise<void>
  /** AXValue write on an element by id. */
  setValue(id: string, value: string): Promise<void>
  /** AXFocused + AXValue (AXSelectedText fallback) on an element by id. */
  focusInsert(id: string, value: string): Promise<void>
  /** Read the frontmost application pid live. */
  frontmost(): Promise<number | null>
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type HandoffStatus = 'sent' | 'drafted' | 'aborted'

export interface StepRecord {
  name: string
  elapsed_ms: number
  ok: boolean
  error?: string
  code?: string
}

export interface HandoffResult {
  status: HandoffStatus
  prompt: string
  model: string
  effort: string
  expected_label: string
  verified_label: string | null
  steps: StepRecord[]
  total_elapsed_ms: number
  frontmost: {
    before: number | null
    after: number | null
    changed: boolean
  }
  error?: string
  code?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Total sequence deadline in milliseconds. */
const DEADLINE_MS = 30_000

/** How long to wait for a new empty composer after pressing New Chat. */
const COMPOSER_TIMEOUT_MS = 6_000

/** Poll interval when waiting for a new composer. */
const COMPOSER_POLL_MS = 200

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function elapsed(start: number): number {
  return Date.now() - start
}

function step(
  name: string,
  startMs: number,
  ok: boolean,
  error?: string,
  code?: string,
): StepRecord {
  return {
    name,
    elapsed_ms: elapsed(startMs),
    ok,
    ...(error ? { error } : {}),
    ...(code ? { code } : {}),
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Driver options
// ---------------------------------------------------------------------------

/** State the driver has verified when it reaches the pre-Send callback. */
export interface PreSendContext {
  /** Picker label read after the last menu closed; equals `<model> <effort>`. */
  verifiedLabel: string
}

/** A refusal names the code the driver aborts with; Send is never pressed. */
export type PreSendOutcome =
  | { ok: true }
  | { ok: false; code: string; message: string }

export interface DriverOptions {
  bridge: Bridge
  prompt: string
  model: string
  effort: string
  /** Known composer ids before New Chat — to distinguish the new one. */
  knownComposerIds?: Set<string>
  /** Runs immediately before Send; a refusal aborts with its own code. */
  preSendCallback?: (context: PreSendContext) => Promise<PreSendOutcome>
  /** When true, do every step except Send. */
  dryRun?: boolean
  deadlineMs?: number
  /** How long to wait for the new empty composer after New Chat. */
  composerTimeoutMs?: number
}

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

// ---------------------------------------------------------------------------
// Main driver
// ---------------------------------------------------------------------------

/** Thrown by the deadline check; the driver returns it as `HANDOFF_TIMEOUT`. */
class DeadlineExceeded extends Error {}

/** State the step sequence accumulates, readable after an early exit. */
interface DriverProgress {
  seqStart: number
  steps: StepRecord[]
  frontmostBefore: number | null
  frontmostAfter: number | null
}

function abortedResult(
  options: DriverOptions,
  progress: DriverProgress,
  code: string,
  message: string,
): HandoffResult {
  const { frontmostBefore, frontmostAfter } = progress

  return {
    status: 'aborted',
    prompt: options.prompt,
    model: options.model,
    effort: options.effort,
    expected_label: `${options.model} ${options.effort}`,
    verified_label: null,
    steps: progress.steps,
    total_elapsed_ms: elapsed(progress.seqStart),
    frontmost: {
      before: frontmostBefore,
      after: frontmostAfter,
      changed:
        frontmostBefore !== null &&
        frontmostAfter !== null &&
        frontmostBefore !== frontmostAfter,
    },
    error: message,
    code,
  }
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

async function driveSequence(
  options: DriverOptions,
  progress: DriverProgress,
): Promise<HandoffResult> {
  const {
    bridge,
    prompt,
    model,
    effort,
    knownComposerIds = new Set<string>(),
    preSendCallback,
    dryRun = false,
    deadlineMs = DEADLINE_MS,
    composerTimeoutMs = COMPOSER_TIMEOUT_MS,
  } = options

  const expectedLabel = `${model} ${effort}`
  const { seqStart, steps } = progress

  function checkDeadline(): void {
    if (Date.now() - seqStart > deadlineMs) {
      throw new DeadlineExceeded(
        `The handoff sequence exceeded its ${deadlineMs} ms deadline.`,
      )
    }
  }

  function abort(code: string, message: string): HandoffResult {
    return abortedResult(options, progress, code, message)
  }

  // 1. Preflight
  {
    const s = Date.now()
    let preflight: BridgePreflight
    try {
      preflight = await bridge.preflight()
    } catch (err) {
      const e = err as { code?: string; message?: string }
      steps.push(step('preflight', s, false, e.message, e.code))
      return abort(
        e.code ?? 'HANDOFF_HELPER_PROTOCOL',
        e.message ?? 'Preflight failed',
      )
    }
    steps.push(step('preflight', s, true))
    progress.frontmostBefore = preflight.frontmost_pid

    if (!preflight.accessibility_trusted) {
      steps.push(
        step(
          'accessibility_check',
          s,
          false,
          'Accessibility not trusted',
          'HANDOFF_ACCESSIBILITY_DENIED',
        ),
      )
      return abort(
        'HANDOFF_ACCESSIBILITY_DENIED',
        'The process lacks the Accessibility permission.',
      )
    }
    if (preflight.cursor_pid === null) {
      steps.push(
        step(
          'cursor_check',
          s,
          false,
          'No Cursor process',
          'HANDOFF_CURSOR_NOT_RUNNING',
        ),
      )
      return abort('HANDOFF_CURSOR_NOT_RUNNING', 'No Cursor process found.')
    }
    if (!preflight.agents_window_present) {
      steps.push(
        step(
          'agents_window_check',
          s,
          false,
          'No Agents window',
          'HANDOFF_AGENTS_WINDOW_MISSING',
        ),
      )
      return abort(
        'HANDOFF_AGENTS_WINDOW_MISSING',
        'No window titled Cursor Agents.',
      )
    }
  }

  checkDeadline()

  // 2. Initial snapshot — busy check + record known composers
  let nodes: SnapNode[]
  {
    const s = Date.now()
    let snapshot: BridgeSnapshot
    try {
      snapshot = await bridge.snapshot()
    } catch (err) {
      const e = err as { code?: string; message?: string }
      steps.push(step('initial_snapshot', s, false, e.message, e.code))
      return abort(
        e.code ?? 'HANDOFF_HELPER_PROTOCOL',
        e.message ?? 'Snapshot failed',
      )
    }
    nodes = snapshot.nodes
    steps.push(step('initial_snapshot', s, true))

    if (isBusy(nodes)) {
      steps.push(step('busy_check', s, false, 'UI busy', 'HANDOFF_UI_BUSY'))
      return abort(
        'HANDOFF_UI_BUSY',
        'A menu, sheet, or dialog is open in the Agents window.',
      )
    }

    // Record existing composer ids so we can identify the new one
    for (const c of findComposers(nodes)) {
      knownComposerIds.add(c.id)
    }
  }

  checkDeadline()

  // 3. Find New Chat button
  const newChat = findNewChat(nodes)
  if (!newChat) {
    steps.push(
      step(
        'find_new_chat',
        seqStart,
        false,
        'No New Chat button',
        'HANDOFF_NEW_CHAT_MISSING',
      ),
    )
    return abort('HANDOFF_NEW_CHAT_MISSING', 'No New Chat button found.')
  }
  steps.push(step('find_new_chat', seqStart, true))

  checkDeadline()

  // 4. Press New Chat
  {
    const s = Date.now()
    try {
      await bridge.press(newChat.id)
      steps.push(step('press_new_chat', s, true))
    } catch (err) {
      const e = err as { code?: string; message?: string }
      steps.push(step('press_new_chat', s, false, e.message, e.code))
      return abort(
        e.code ?? 'HANDOFF_PRESS_FAILED',
        e.message ?? 'Failed to press New Chat',
      )
    }
  }

  checkDeadline()

  // 5. Wait for a new empty composer
  let composer: SnapNode | null = null
  {
    const s = Date.now()
    const deadline = s + composerTimeoutMs

    while (Date.now() < deadline) {
      checkDeadline()
      let fresh: BridgeSnapshot
      try {
        fresh = await bridge.snapshot()
      } catch {
        await sleep(COMPOSER_POLL_MS)
        continue
      }
      nodes = fresh.nodes

      const allComposers = findComposers(nodes)
      const newComposers = allComposers.filter(
        (c) => !knownComposerIds.has(c.id) && (c.value ?? '').length === 0,
      )

      if (newComposers.length === 1) {
        composer = newComposers[0] as SnapNode
        break
      }

      if (newComposers.length > 1) {
        steps.push(
          step(
            'find_new_composer',
            s,
            false,
            'More than one new empty composer',
            'HANDOFF_COMPOSER_AMBIGUOUS',
          ),
        )
        return abort(
          'HANDOFF_COMPOSER_AMBIGUOUS',
          'More than one new empty composer appeared.',
        )
      }

      await sleep(COMPOSER_POLL_MS)
    }

    if (!composer) {
      steps.push(
        step(
          'find_new_composer',
          s,
          false,
          'No new empty composer within timeout',
          'HANDOFF_COMPOSER_TIMEOUT',
        ),
      )
      return abort(
        'HANDOFF_COMPOSER_TIMEOUT',
        'No new empty composer appeared within 6 seconds.',
      )
    }

    steps.push(step('find_new_composer', s, true))
  }

  checkDeadline()

  // 6-7. Write the prompt through AXValue, verify it exactly, and fall back to
  // AXFocused plus AXSelectedText only when the composer does not hold it.
  {
    const writers: Array<{
      name: 'set_value' | 'focus_insert'
      write: (id: string, value: string) => Promise<void>
    }> = [
      { name: 'set_value', write: (id, v) => bridge.setValue(id, v) },
      { name: 'focus_insert', write: (id, v) => bridge.focusInsert(id, v) },
    ]
    let held = false

    for (const writer of writers) {
      checkDeadline()
      const s = Date.now()

      try {
        await writer.write(composer.id, prompt)
        steps.push(step(`write_prompt_${writer.name}`, s, true))
      } catch (err) {
        const e = err as { code?: string; message?: string }
        steps.push(
          step(`write_prompt_${writer.name}`, s, false, e.message, e.code),
        )

        if (e.code === 'HANDOFF_ELEMENT_STALE') {
          return abort(
            'HANDOFF_ELEMENT_STALE',
            e.message ?? 'The composer no longer resolves.',
          )
        }

        continue
      }

      const verifyStart = Date.now()
      let fresh: BridgeSnapshot
      try {
        fresh = await bridge.snapshot()
      } catch (err) {
        const e = err as { code?: string; message?: string }
        steps.push(step('verify_prompt', verifyStart, false, e.message, e.code))
        return abort(
          e.code ?? 'HANDOFF_HELPER_PROTOCOL',
          e.message ?? 'Snapshot failed',
        )
      }
      nodes = fresh.nodes

      const reComposers = findComposers(nodes).filter(
        (c) => !knownComposerIds.has(c.id),
      )
      if (reComposers.length !== 1) {
        steps.push(
          step(
            'verify_prompt',
            verifyStart,
            false,
            'Cannot re-resolve composer after write',
            'HANDOFF_ELEMENT_STALE',
          ),
        )
        return abort(
          'HANDOFF_ELEMENT_STALE',
          'Composer could not be re-resolved after prompt write.',
        )
      }
      composer = reComposers[0] as SnapNode

      if ((composer.value ?? '') === prompt) {
        steps.push(step('verify_prompt', verifyStart, true))
        held = true
        break
      }

      steps.push(
        step(
          'verify_prompt',
          verifyStart,
          false,
          `Composer does not hold the exact prompt after ${writer.name}`,
        ),
      )
    }

    if (!held) {
      steps.push(
        step(
          'verify_prompt',
          Date.now(),
          false,
          'Prompt not held by composer after both write methods',
          'HANDOFF_PROMPT_REJECTED',
        ),
      )
      return abort(
        'HANDOFF_PROMPT_REJECTED',
        'The composer does not hold the exact prompt after both write methods.',
      )
    }
  }

  checkDeadline()

  // 8. Find the picker in composer ancestor scope
  let pickerResult: { picker: SnapNode; scope: SnapNode[] } | undefined
  {
    const s = Date.now()
    pickerResult = findPickerInAncestorScope(
      nodes,
      composer.id,
      PICKER_ANCESTOR_LIMIT,
    )

    if (!pickerResult) {
      const code = missingPickerCode(nodes, composer.id, PICKER_ANCESTOR_LIMIT)
      steps.push(
        step('find_picker', s, false, `Picker not found (${code})`, code),
      )
      return abort(
        code,
        code === 'HANDOFF_PICKER_AMBIGUOUS'
          ? 'More than one model picker in the composer scope.'
          : 'No model picker found in the composer scope.',
      )
    }
    steps.push(step('find_picker', s, true))
  }

  checkDeadline()

  // 9. Select Model menu item
  {
    const s = Date.now()

    // Open picker by pressing it
    try {
      await bridge.press(pickerResult.picker.id)
      steps.push(step('open_picker', s, true))
    } catch (err) {
      const e = err as { code?: string; message?: string }
      steps.push(step('open_picker', s, false, e.message, e.code))
      return abort(
        e.code ?? 'HANDOFF_PRESS_FAILED',
        e.message ?? 'Failed to open picker',
      )
    }

    checkDeadline()

    // Re-snapshot to find menu items
    const snap2Start = Date.now()
    let fresh2: BridgeSnapshot
    try {
      fresh2 = await bridge.snapshot()
    } catch (err) {
      const e = err as { code?: string; message?: string }
      steps.push(
        step(
          'snapshot_after_picker_open',
          snap2Start,
          false,
          e.message,
          e.code,
        ),
      )
      return abort(
        e.code ?? 'HANDOFF_HELPER_PROTOCOL',
        e.message ?? 'Snapshot failed',
      )
    }
    nodes = fresh2.nodes
    steps.push(step('snapshot_after_picker_open', snap2Start, true))

    // Re-resolve picker scope
    const reComposers2 = findComposers(nodes).filter(
      (n) => !knownComposerIds.has(n.id),
    )
    if (reComposers2.length !== 1) {
      steps.push(
        step(
          'find_model_item',
          s,
          false,
          'Cannot re-resolve composer after picker open',
          'HANDOFF_ELEMENT_STALE',
        ),
      )
      return abort(
        'HANDOFF_ELEMENT_STALE',
        'Composer could not be re-resolved.',
      )
    }
    composer = reComposers2[0] as SnapNode

    const rePicker = findPickerInAncestorScope(
      nodes,
      composer.id,
      PICKER_ANCESTOR_LIMIT,
    )
    if (!rePicker) {
      steps.push(
        step(
          'find_model_item',
          s,
          false,
          'Picker not found after open',
          'HANDOFF_PICKER_MISSING',
        ),
      )
      return abort('HANDOFF_PICKER_MISSING', 'Picker not found after open.')
    }
    pickerResult = rePicker

    const menuItems = findMenuItems(nodes, pickerResult.scope)

    if (!menuItems.model) {
      steps.push(
        step(
          'find_model_item',
          s,
          false,
          'No Model menu item',
          'HANDOFF_MENU_ITEM_MISSING',
        ),
      )
      return abort('HANDOFF_MENU_ITEM_MISSING', 'No Model menu item found.')
    }
    steps.push(step('find_model_item', s, true))

    // Find the model option
    const optionStart = Date.now()
    const modelOptions = collectMenuOptions(
      nodes,
      pickerResult.scope,
      menuItems.model,
    )
    const modelOption = modelOptions.find(
      (n) => n.title === model || n.description === model,
    )

    if (!modelOption) {
      steps.push(
        step(
          'find_model_option',
          optionStart,
          false,
          `Model option "${model}" not found`,
          'HANDOFF_OPTION_MISSING',
        ),
      )
      return abort(
        'HANDOFF_OPTION_MISSING',
        `The requested model "${model}" is not offered.`,
      )
    }
    steps.push(step('find_model_option', optionStart, true))

    // Press the model option
    const pressOptionStart = Date.now()
    try {
      await bridge.press(modelOption.id)
      steps.push(step('select_model_option', pressOptionStart, true))
    } catch (err) {
      const e = err as { code?: string; message?: string }
      steps.push(
        step('select_model_option', pressOptionStart, false, e.message, e.code),
      )
      return abort(
        e.code ?? 'HANDOFF_PRESS_FAILED',
        e.message ?? 'Failed to select model option',
      )
    }
  }

  checkDeadline()

  // 10. Re-resolve after model selection, then select Effort
  {
    const s = Date.now()
    let fresh3: BridgeSnapshot
    try {
      fresh3 = await bridge.snapshot()
    } catch (err) {
      const e = err as { code?: string; message?: string }
      steps.push(step('snapshot_after_model', s, false, e.message, e.code))
      return abort(
        e.code ?? 'HANDOFF_HELPER_PROTOCOL',
        e.message ?? 'Snapshot failed',
      )
    }
    nodes = fresh3.nodes
    steps.push(step('snapshot_after_model', s, true))

    const reComposers3 = findComposers(nodes).filter(
      (n) => !knownComposerIds.has(n.id),
    )
    if (reComposers3.length !== 1) {
      steps.push(
        step(
          'find_effort_picker',
          s,
          false,
          'Cannot re-resolve composer after model',
          'HANDOFF_ELEMENT_STALE',
        ),
      )
      return abort(
        'HANDOFF_ELEMENT_STALE',
        'Composer could not be re-resolved after model selection.',
      )
    }
    composer = reComposers3[0] as SnapNode

    const rePicker3 = findPickerInAncestorScope(
      nodes,
      composer.id,
      PICKER_ANCESTOR_LIMIT,
    )
    if (!rePicker3) {
      steps.push(
        step(
          'find_effort_picker',
          s,
          false,
          'Picker not found after model',
          'HANDOFF_PICKER_MISSING',
        ),
      )
      return abort(
        'HANDOFF_PICKER_MISSING',
        'Picker not found after model selection.',
      )
    }
    pickerResult = rePicker3

    // Open picker again for effort
    const openEffortStart = Date.now()
    try {
      await bridge.press(pickerResult.picker.id)
      steps.push(step('open_picker_for_effort', openEffortStart, true))
    } catch (err) {
      const e = err as { code?: string; message?: string }
      steps.push(
        step(
          'open_picker_for_effort',
          openEffortStart,
          false,
          e.message,
          e.code,
        ),
      )
      return abort(
        e.code ?? 'HANDOFF_PRESS_FAILED',
        e.message ?? 'Failed to open picker for effort',
      )
    }

    checkDeadline()

    // Snapshot for effort items
    const snap4Start = Date.now()
    let fresh4: BridgeSnapshot
    try {
      fresh4 = await bridge.snapshot()
    } catch (err) {
      const e = err as { code?: string; message?: string }
      steps.push(
        step(
          'snapshot_after_effort_open',
          snap4Start,
          false,
          e.message,
          e.code,
        ),
      )
      return abort(
        e.code ?? 'HANDOFF_HELPER_PROTOCOL',
        e.message ?? 'Snapshot failed',
      )
    }
    nodes = fresh4.nodes
    steps.push(step('snapshot_after_effort_open', snap4Start, true))

    const reComposers4 = findComposers(nodes).filter(
      (n) => !knownComposerIds.has(n.id),
    )
    if (reComposers4.length !== 1) {
      steps.push(
        step(
          'find_effort_item',
          s,
          false,
          'Cannot re-resolve composer for effort',
          'HANDOFF_ELEMENT_STALE',
        ),
      )
      return abort(
        'HANDOFF_ELEMENT_STALE',
        'Composer could not be re-resolved for effort selection.',
      )
    }
    composer = reComposers4[0] as SnapNode

    const rePicker4 = findPickerInAncestorScope(
      nodes,
      composer.id,
      PICKER_ANCESTOR_LIMIT,
    )
    if (!rePicker4) {
      steps.push(
        step(
          'find_effort_item',
          s,
          false,
          'Picker not found for effort',
          'HANDOFF_PICKER_MISSING',
        ),
      )
      return abort(
        'HANDOFF_PICKER_MISSING',
        'Picker not found for effort selection.',
      )
    }
    pickerResult = rePicker4

    const menuItems2 = findMenuItems(nodes, pickerResult.scope)

    if (!menuItems2.effort) {
      steps.push(
        step(
          'find_effort_item',
          s,
          false,
          'No Effort menu item',
          'HANDOFF_MENU_ITEM_MISSING',
        ),
      )
      return abort('HANDOFF_MENU_ITEM_MISSING', 'No Effort menu item found.')
    }
    steps.push(step('find_effort_item', s, true))

    const effortOptions = collectMenuOptions(
      nodes,
      pickerResult.scope,
      menuItems2.effort,
    )
    const effortOption = effortOptions.find(
      (n) => n.title === effort || n.description === effort,
    )

    if (!effortOption) {
      steps.push(
        step(
          'find_effort_option',
          s,
          false,
          `Effort option "${effort}" not found`,
          'HANDOFF_OPTION_MISSING',
        ),
      )
      return abort(
        'HANDOFF_OPTION_MISSING',
        `The requested effort "${effort}" is not offered.`,
      )
    }
    steps.push(step('find_effort_option', s, true))

    const pressEffortStart = Date.now()
    try {
      await bridge.press(effortOption.id)
      steps.push(step('select_effort_option', pressEffortStart, true))
    } catch (err) {
      const e = err as { code?: string; message?: string }
      steps.push(
        step(
          'select_effort_option',
          pressEffortStart,
          false,
          e.message,
          e.code,
        ),
      )
      return abort(
        e.code ?? 'HANDOFF_PRESS_FAILED',
        e.message ?? 'Failed to select effort option',
      )
    }
  }

  checkDeadline()

  // 11. Re-resolve composer and picker, verify label and prompt
  let verifiedLabel: string | null = null
  let sendNode: SnapNode | null = null
  {
    const s = Date.now()
    let fresh5: BridgeSnapshot
    try {
      fresh5 = await bridge.snapshot()
    } catch (err) {
      const e = err as { code?: string; message?: string }
      steps.push(step('snapshot_after_effort', s, false, e.message, e.code))
      return abort(
        e.code ?? 'HANDOFF_HELPER_PROTOCOL',
        e.message ?? 'Snapshot failed',
      )
    }
    nodes = fresh5.nodes
    steps.push(step('snapshot_after_effort', s, true))

    // Re-resolve composer
    const reComposers5 = findComposers(nodes).filter(
      (n) => !knownComposerIds.has(n.id),
    )
    if (reComposers5.length !== 1) {
      steps.push(
        step(
          'verify_final_state',
          s,
          false,
          'Cannot re-resolve composer for final check',
          'HANDOFF_ELEMENT_STALE',
        ),
      )
      return abort(
        'HANDOFF_ELEMENT_STALE',
        'Composer could not be re-resolved for final check.',
      )
    }
    composer = reComposers5[0] as SnapNode

    // Verify prompt still held
    if ((composer.value ?? '') !== prompt) {
      steps.push(
        step(
          'verify_prompt_held',
          s,
          false,
          'Prompt no longer held by composer',
          'HANDOFF_PROMPT_LOST',
        ),
      )
      return abort(
        'HANDOFF_PROMPT_LOST',
        'The re-resolved composer no longer holds the exact prompt.',
      )
    }
    steps.push(step('verify_prompt_held', s, true))

    // Re-resolve picker and verify label
    const rePicker5 = findPickerInAncestorScope(
      nodes,
      composer.id,
      PICKER_ANCESTOR_LIMIT,
    )
    if (!rePicker5) {
      steps.push(
        step(
          'verify_picker_label',
          s,
          false,
          'Picker not found for label check',
          'HANDOFF_PICKER_MISSING',
        ),
      )
      return abort(
        'HANDOFF_PICKER_MISSING',
        'Picker not found for label verification.',
      )
    }
    pickerResult = rePicker5

    verifiedLabel = pickerLabel(nodes, pickerResult.picker.id) ?? null

    if (verifiedLabel !== expectedLabel) {
      steps.push(
        step(
          'verify_picker_label',
          s,
          false,
          `Picker label is "${String(verifiedLabel)}", expected "${expectedLabel}"`,
          'HANDOFF_PICKER_MISMATCH',
        ),
      )
      return abort(
        'HANDOFF_PICKER_MISMATCH',
        `The picker label "${String(verifiedLabel)}" does not match "${expectedLabel}".`,
      )
    }
    steps.push(step('verify_picker_label', s, true))

    // Find Send button
    sendNode = findSend(pickerResult.scope) ?? null
    if (!sendNode) {
      steps.push(
        step(
          'find_send',
          s,
          false,
          'No Send message button',
          'HANDOFF_SEND_MISSING',
        ),
      )
      return abort('HANDOFF_SEND_MISSING', 'No Send message button found.')
    }
    steps.push(step('find_send', s, true))
  }

  checkDeadline()

  // 12. Check frontmost before Send
  {
    const s = Date.now()
    let currentFrontmost: number | null
    try {
      currentFrontmost = await bridge.frontmost()
    } catch {
      currentFrontmost = progress.frontmostBefore
    }

    if (
      progress.frontmostBefore !== null &&
      currentFrontmost !== null &&
      currentFrontmost !== progress.frontmostBefore
    ) {
      steps.push(
        step(
          'frontmost_check',
          s,
          false,
          'Frontmost application changed before Send',
          'HANDOFF_FOCUS_CHANGED',
        ),
      )
      progress.frontmostAfter = currentFrontmost
      return abort(
        'HANDOFF_FOCUS_CHANGED',
        'The frontmost application changed before Send.',
      )
    }
    steps.push(step('frontmost_check', s, true))
  }

  checkDeadline()

  // 13. Pre-send callback (used by run layer to write the `sending` record)
  if (preSendCallback) {
    const s = Date.now()
    const outcome = await preSendCallback({
      verifiedLabel: verifiedLabel ?? expectedLabel,
    })
    if (!outcome.ok) {
      steps.push(step('pre_send', s, false, outcome.message, outcome.code))
      return abort(outcome.code, outcome.message)
    }
    steps.push(step('pre_send', s, true))
  }

  // Dry-run: stop here without pressing Send
  if (dryRun) {
    progress.frontmostAfter = progress.frontmostBefore
    return {
      status: 'drafted',
      prompt,
      model,
      effort,
      expected_label: expectedLabel,
      verified_label: verifiedLabel,
      steps,
      total_elapsed_ms: elapsed(seqStart),
      frontmost: {
        before: progress.frontmostBefore,
        after: progress.frontmostAfter,
        changed: false,
      },
    }
  }

  // 14. Press Send
  {
    const s = Date.now()
    try {
      await bridge.press(sendNode!.id)
      steps.push(step('press_send', s, true))
    } catch (err) {
      const e = err as { code?: string; message?: string }
      steps.push(step('press_send', s, false, e.message, e.code))
      return abort(
        e.code ?? 'HANDOFF_PRESS_FAILED',
        e.message ?? 'Failed to press Send',
      )
    }
  }

  // 15. Sample frontmost after Send
  {
    try {
      progress.frontmostAfter = await bridge.frontmost()
    } catch {
      progress.frontmostAfter = progress.frontmostBefore
    }
  }

  return {
    status: 'sent',
    prompt,
    model,
    effort,
    expected_label: expectedLabel,
    verified_label: verifiedLabel,
    steps,
    total_elapsed_ms: elapsed(seqStart),
    frontmost: {
      before: progress.frontmostBefore,
      after: progress.frontmostAfter,
      changed:
        progress.frontmostBefore !== null &&
        progress.frontmostAfter !== null &&
        progress.frontmostBefore !== progress.frontmostAfter,
    },
  }
}

// ---------------------------------------------------------------------------
// Internal: collect menu options that live under a menu item (the options for
// that category, e.g. the model names under the "Model" menu item).
// ---------------------------------------------------------------------------

function collectMenuOptions(
  nodes: SnapNode[],
  scope: SnapNode[],
  menuItem: SnapNode,
): SnapNode[] {
  const scopeIds = new Set(scope.map((n) => n.id))
  const inScope = nodes.filter((n) => scopeIds.has(n.id))

  // Primary: options are the AXMenuItem children of this menu item.
  const directChildren = childrenOf(inScope, menuItem.id).filter(
    (n) => n.role === 'AXMenuItem',
  )
  if (directChildren.length > 0) return directChildren

  // Fallback: options might be siblings of this menu item when the structure
  // is flat (all options at the same level as the Model/Effort items).
  // In that case the menu item's parent contains all options.
  const parent = inScope.find((n) => n.id === menuItem.parent_id)
  if (parent) {
    const siblings = childrenOf(inScope, parent.id).filter(
      (n) => n.role === 'AXMenuItem' && n.id !== menuItem.id,
    )
    if (siblings.length > 0) return siblings
  }

  // Last resort: any AXMenuItem descendants in scope that are not the
  // menuItem itself or one of the top-level Model/Effort items.
  return descendantsOf(inScope, scope[0]?.id ?? menuItem.id).filter(
    (n) => n.role === 'AXMenuItem' && n.id !== menuItem.id,
  )
}

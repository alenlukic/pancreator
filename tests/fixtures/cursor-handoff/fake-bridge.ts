/**
 * A stateful fake of the helper bridge for driver tests. Its snapshots follow
 * the driver's actions through four phases:
 *
 * 0 → before New Chat: the old chat's composer, picker, and Send button
 * 1 → after New Chat: a new empty composer beside the old one
 * 2 → after a prompt write or a closed menu: the new composer holds the value
 * 3 → picker open: Model and Effort menu items with their options
 *
 * Element ids stay equal across snapshots, as the helper guarantees for equal
 * elements within one process. `transform` lets a test reshape any snapshot.
 */

import type {
  Bridge,
  BridgePreflight,
  BridgeSnapshot,
} from '../../../src/lib/cursor-handoff/driver.js'
import type { SnapNode } from '../../../src/lib/cursor-handoff/selectors.js'

export const MODEL = 'Claude Opus 5.5'
export const EFFORT = 'High'
export const PROMPT = '/pan-resume test-run-1'

export function buildInitialNodes(): SnapNode[] {
  return [
    { id: 'win', role: 'AXWindow', title: 'Cursor Agents' },
    { id: 'btn-new', parent_id: 'win', role: 'AXButton', title: 'New Chat' },
    { id: 'grp-old', parent_id: 'win', role: 'AXGroup' },
    {
      id: 'old-composer',
      parent_id: 'grp-old',
      role: 'AXTextArea',
      title: 'Prompt Editor',
      value: '',
    },
    {
      id: 'old-picker',
      parent_id: 'grp-old',
      role: 'AXPopUpButton',
      title: 'claude sonnet Low',
    },
    {
      id: 'old-send',
      parent_id: 'grp-old',
      role: 'AXButton',
      title: 'Send message',
    },
  ]
}

export function buildAfterNewChatNodes(composerValue = ''): SnapNode[] {
  return [
    { id: 'win', role: 'AXWindow', title: 'Cursor Agents' },
    { id: 'btn-new', parent_id: 'win', role: 'AXButton', title: 'New Chat' },
    { id: 'grp-old', parent_id: 'win', role: 'AXGroup' },
    {
      id: 'old-composer',
      parent_id: 'grp-old',
      role: 'AXTextArea',
      title: 'Prompt Editor',
      value: 'previous chat content',
    },
    { id: 'grp-new', parent_id: 'win', role: 'AXGroup' },
    {
      id: 'new-composer',
      parent_id: 'grp-new',
      role: 'AXTextArea',
      title: 'Prompt Editor',
      value: composerValue,
    },
    {
      id: 'new-picker',
      parent_id: 'grp-new',
      role: 'AXPopUpButton',
      title: `${MODEL} ${EFFORT}`,
    },
    {
      id: 'new-send',
      parent_id: 'grp-new',
      role: 'AXButton',
      title: 'Send message',
    },
  ]
}

export function buildPickerOpenNodes(composerValue: string): SnapNode[] {
  return [
    ...buildAfterNewChatNodes(composerValue),
    { id: 'new-menu', parent_id: 'grp-new', role: 'AXMenu' },
    {
      id: 'item-model',
      parent_id: 'new-menu',
      role: 'AXMenuItem',
      title: 'Model',
    },
    {
      id: 'item-effort',
      parent_id: 'new-menu',
      role: 'AXMenuItem',
      title: 'Effort',
    },
    {
      id: 'opt-model',
      parent_id: 'item-model',
      role: 'AXMenuItem',
      title: MODEL,
    },
    {
      id: 'opt-effort',
      parent_id: 'item-effort',
      role: 'AXMenuItem',
      title: EFFORT,
    },
  ]
}

export interface SnapshotContext {
  phase: number
  /** True once the effort option has been pressed. */
  effortSelected: boolean
}

export interface FakeBridgeOpts {
  preflight?: Partial<BridgePreflight>
  /** A press on this id throws with the given code instead of acting. */
  pressError?: { id: string; code: string; message: string }
  /** frontmost() returns this pid instead of the preflight one. */
  frontmostAfter?: number
  /** Reshape a snapshot before the driver sees it. */
  transform?: (nodes: SnapNode[], context: SnapshotContext) => SnapNode[]
  /** Leave the composer unchanged on set_value, as Electron sometimes does. */
  ignoreSetValue?: boolean
  /** Leave the composer unchanged on focus_insert. */
  ignoreFocusInsert?: boolean
  /** Throw from snapshot() with this error. */
  snapshotError?: Error
  /** Delay every preflight() call by this many milliseconds. */
  preflightDelayMs?: number
  /** Runs before each press is recorded, for observing state at Send. */
  onPress?: (id: string) => void
}

export interface FakeBridge {
  bridge: Bridge
  pressLog: string[]
  setValueLog: Array<{ id: string; value: string }>
  focusInsertLog: Array<{ id: string; value: string }>
}

export function makeStatefulBridge(opts: FakeBridgeOpts = {}): FakeBridge {
  let phase = 0
  let effortSelected = false
  let composerValue = ''
  const pressLog: string[] = []
  const setValueLog: Array<{ id: string; value: string }> = []
  const focusInsertLog: Array<{ id: string; value: string }> = []

  const preflight: BridgePreflight = {
    accessibility_trusted: true,
    cursor_pid: 12345,
    agents_window_present: true,
    frontmost_pid: 99999,
    ...opts.preflight,
  }

  const phaseNodes = (): SnapNode[] => {
    if (phase === 0) return buildInitialNodes()
    if (phase === 1) return buildAfterNewChatNodes('')
    if (phase === 2) return buildAfterNewChatNodes(composerValue)
    return buildPickerOpenNodes(composerValue)
  }

  const bridge: Bridge = {
    async preflight(): Promise<BridgePreflight> {
      if (opts.preflightDelayMs !== undefined) {
        await new Promise((resolve) =>
          setTimeout(resolve, opts.preflightDelayMs),
        )
      }
      return preflight
    },

    async snapshot(): Promise<BridgeSnapshot> {
      if (opts.snapshotError) throw opts.snapshotError
      const nodes = phaseNodes()
      return {
        nodes: opts.transform
          ? opts.transform(nodes, { phase, effortSelected })
          : nodes,
      }
    },

    async press(id: string): Promise<void> {
      if (opts.pressError && opts.pressError.id === id) {
        throw Object.assign(new Error(opts.pressError.message), {
          code: opts.pressError.code,
        })
      }
      opts.onPress?.(id)
      pressLog.push(id)
      if (id === 'btn-new') {
        phase = 1
      } else if (id === 'new-picker') {
        phase = 3
      } else if (id === 'opt-model' || id === 'opt-effort') {
        effortSelected = effortSelected || id === 'opt-effort'
        phase = 2
      }
    },

    async setValue(id: string, value: string): Promise<void> {
      setValueLog.push({ id, value })
      if (id === 'new-composer' && !opts.ignoreSetValue) {
        composerValue = value
      }
      if (id === 'new-composer') phase = 2
    },

    async focusInsert(id: string, value: string): Promise<void> {
      focusInsertLog.push({ id, value })
      if (id === 'new-composer' && !opts.ignoreFocusInsert) {
        composerValue = value
      }
      if (id === 'new-composer') phase = 2
    },

    async frontmost(): Promise<number | null> {
      return opts.frontmostAfter ?? preflight.frontmost_pid
    },
  }

  return { bridge, pressLog, setValueLog, focusInsertLog }
}

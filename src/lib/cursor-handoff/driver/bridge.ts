/**
 * The injected bridge interface, the handoff result and driver option shapes,
 * the sequence timing constants and deadline, and the step and menu helpers
 * the driver shares.
 */

import type { SnapNode } from '../selectors.js'
import { childrenOf, descendantsOf } from '../selectors.js'

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
export const DEADLINE_MS = 30_000

/** How long to wait for a new empty composer after pressing New Chat. */
export const COMPOSER_TIMEOUT_MS = 6_000

/** Poll interval when waiting for a new composer. */
export const COMPOSER_POLL_MS = 200

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export function elapsed(start: number): number {
  return Date.now() - start
}

export function step(
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

export function sleep(ms: number): Promise<void> {
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
// Driver state and aborted results
// ---------------------------------------------------------------------------

/** Thrown by the deadline check; the driver returns it as `HANDOFF_TIMEOUT`. */
export class DeadlineExceeded extends Error {}

/** State the step sequence accumulates, readable after an early exit. */
export interface DriverProgress {
  seqStart: number
  steps: StepRecord[]
  frontmostBefore: number | null
  frontmostAfter: number | null
}

export function abortedResult(
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

// ---------------------------------------------------------------------------
// Internal: collect menu options that live under a menu item (the options for
// that category, e.g. the model names under the "Model" menu item).
// ---------------------------------------------------------------------------

export function collectMenuOptions(
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

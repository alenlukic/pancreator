/**
 * Thin entry point for the COMMS-001 visible-chat Cursor hook.
 *
 * Imported by `bin/pan-hook-visible-chat`. Imports only
 * `src/lib/governance/visible-chat`, the agent-index store, and `src/lib/io`,
 * for fast hook startup. Reads the hook payload from stdin and writes one JSON
 * response to stdout. Fails open.
 */
import { readFileSync } from 'node:fs'

import {
  resolveVisibleChatHook,
  type VisibleChatEvent,
} from './lib/governance/visible-chat.js'
import { findProjectRoot } from './lib/io.js'

const EVENTS: readonly VisibleChatEvent[] = [
  'postToolUse',
  'postToolUseFailure',
  'stop',
]

const event = process.argv[2]
let response = {}

if (EVENTS.includes(event as VisibleChatEvent)) {
  try {
    let root: string | null = null

    try {
      root = findProjectRoot()
    } catch {
      root = null
    }

    response = resolveVisibleChatHook(
      event as VisibleChatEvent,
      readFileSync(0, 'utf8'),
      root,
    )
  } catch {
    response = {}
  }
}

process.stdout.write(`${JSON.stringify(response)}\n`)

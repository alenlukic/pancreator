/**
 * Thin entry point for the COMMS-001 visible-chat Cursor hook.
 *
 * Imported by `bin/pan-hook-visible-chat`. Imports only
 * `src/lib/governance/visible-chat`, for fast hook startup. Reads the hook
 * payload from stdin and writes one JSON response to stdout. Fails open.
 */
import { readFileSync } from 'node:fs'

import {
  resolveVisibleChatHook,
  type VisibleChatEvent,
} from './lib/governance/visible-chat.js'

const EVENTS: readonly VisibleChatEvent[] = [
  'postToolUse',
  'postToolUseFailure',
  'stop',
]

const event = process.argv[2]
let response = {}

if (EVENTS.includes(event as VisibleChatEvent)) {
  try {
    response = resolveVisibleChatHook(
      event as VisibleChatEvent,
      readFileSync(0, 'utf8'),
    )
  } catch {
    response = {}
  }
}

process.stdout.write(`${JSON.stringify(response)}\n`)

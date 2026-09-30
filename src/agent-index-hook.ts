/**
 * Thin entry point for the agent-index Cursor hook.
 *
 * Imported by `bin/pan-hook-agent-index`. Imports only the hook handlers and
 * store of `src/lib/agent-index/`, and `src/lib/io`, for fast hook startup.
 *
 * Reads the Cursor hook payload from stdin and writes the event-appropriate
 * JSON response to stdout. Fails open on any error (C-002).
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import {
  handlePostToolUse,
  handlePreToolUse,
  handleSubagentStart,
  handleSubagentStop,
} from './lib/agent-index/hooks.js'
import {
  AGENTS_DIR,
  type HookPayload,
  type PostToolUsePayload,
  type PreToolUsePayload,
  type SubagentStartPayload,
  type SubagentStopPayload,
} from './lib/agent-index/store.js'
import { findProjectRoot } from './lib/io.js'

type EventName =
  | 'preToolUse'
  | 'postToolUse'
  | 'postToolUseFailure'
  | 'subagentStart'
  | 'subagentStop'

const PERMISSION_ALLOW = '{"permission":"allow"}'
const EMPTY_RESPONSE = '{}'

function eventDefaultResponse(event: EventName): string {
  // preToolUse and subagentStart return allow; all others return {}
  return event === 'preToolUse' || event === 'subagentStart'
    ? PERMISSION_ALLOW
    : EMPTY_RESPONSE
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Payload fields whose values the identity probe needs to compare. */
const PROBE_ID_FIELD = /(^|_)(id|ids|path)$/u

/**
 * While `runtime/logs/agents/probe.enabled` exists, append each payload's
 * field names, `tool_input` field names, and identifier or path values, so the
 * subagent identity probe sees fields the index does not read. No other value
 * is written.
 */
function captureProbe(
  root: string,
  event: EventName,
  payload: Record<string, unknown>,
): void {
  const directory = path.join(root, AGENTS_DIR)

  if (!existsSync(path.join(directory, 'probe.enabled'))) {
    return
  }

  const toolInput = isRecord(payload.tool_input) ? payload.tool_input : null
  const ids = Object.fromEntries(
    Object.entries(payload).filter(
      ([key, value]) => PROBE_ID_FIELD.test(key) && typeof value === 'string',
    ),
  )

  appendFileSync(
    path.join(directory, 'probe-payloads.jsonl'),
    JSON.stringify({
      recorded_at: new Date().toISOString(),
      event,
      fields: Object.keys(payload).sort(),
      tool_input_fields: toolInput ? Object.keys(toolInput).sort() : null,
      ids,
    }) + '\n',
  )
}

function run(event: EventName, payloadText: string): void {
  const defaultResponse = eventDefaultResponse(event)

  try {
    const payload = JSON.parse(payloadText) as unknown

    if (!isRecord(payload)) {
      process.stdout.write(defaultResponse + '\n')
      return
    }

    const root = findProjectRoot()

    try {
      captureProbe(root, event, payload)
    } catch {
      // The probe never blocks the index update.
    }

    const hookPayload = { ...payload, event } as HookPayload

    switch (event) {
      case 'preToolUse':
        handlePreToolUse(root, hookPayload as PreToolUsePayload)
        break
      case 'postToolUse':
      case 'postToolUseFailure':
        handlePostToolUse(root, hookPayload as PostToolUsePayload)
        break
      case 'subagentStart':
        handleSubagentStart(root, hookPayload as SubagentStartPayload)
        break
      case 'subagentStop':
        handleSubagentStop(root, hookPayload as SubagentStopPayload)
        break
    }
  } catch {
    // Fail open: any error just produces the default response (C-002)
  }

  process.stdout.write(defaultResponse + '\n')
}

const event = process.argv[2] as EventName | undefined
const validEvents: EventName[] = [
  'preToolUse',
  'postToolUse',
  'postToolUseFailure',
  'subagentStart',
  'subagentStop',
]

if (!event || !validEvents.includes(event)) {
  process.stderr.write(
    `agent-index-hook: unknown event '${event ?? '(none)'}'\n`,
  )
  process.stdout.write(EMPTY_RESPONSE + '\n')
  process.exit(0)
}

const payloadText = readFileSync(0, 'utf8').trim()

run(event, payloadText)
